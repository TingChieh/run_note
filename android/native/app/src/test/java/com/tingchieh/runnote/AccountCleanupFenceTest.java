package com.tingchieh.runnote;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * Round 14: account cleanup is fenced by account, claim revision/token and the live session's
 * generation inside one critical section, and GPS teardown (`onDiscard`) runs only for the session
 * that is actually removed.
 */
public class AccountCleanupFenceTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private LocationRecordingPolicy.RecordingStore store;
    private LocationRecordingPolicy.RecordingSessionCoordinator coordinator;
    private final AtomicInteger teardowns = new AtomicInteger();
    private final Runnable onDiscard = teardowns::incrementAndGet;

    private void newStore(String name) throws Exception {
        File dir = tmp.newFolder(name);
        store = new LocationRecordingPolicy.RecordingStore(dir);
        coordinator = new LocationRecordingPolicy.RecordingSessionCoordinator(store);
    }

    private static LocationRecordingPolicy.RecordedPoint point(double lat, long t) {
        return new LocationRecordingPolicy.RecordedPoint(lat, 121.47, 10.0, 5.0, t, 0);
    }

    private void startLive(String sessionId, String accountId, long claimRevision, String claimToken) {
        if (claimRevision > 0L) {
            assertTrue(coordinator.syncAccountClaim(accountId, claimRevision, claimToken));
        }
        LocationRecordingPolicy.StartResult started = coordinator.startSession(
            sessionId,
            accountId,
            "14141414-1414-4141-8141-" + String.format("%012d", Math.abs(sessionId.hashCode())),
            "第十四轮",
            false,
            1_700_000_000_000L,
            claimRevision,
            claimToken
        );
        assertNull(started.errorCode);
        assertNotNull(coordinator.recordLocationPoint(point(31.2300, 1_700_000_001_000L)));
    }

    private void assertSessionKept(String sessionId) {
        assertNotNull(coordinator.currentSession());
        assertEquals(sessionId, coordinator.currentSession().sessionId);
        assertEquals(sessionId, store.loadSession().sessionId);
        assertEquals(1, store.loadPoints(0).size());
    }

    private void assertFence(String accountId, Long revision, String token, long epoch) {
        LocationRecordingPolicy.ClaimFence fence = coordinator.currentClaimFence();
        assertNotNull(fence);
        assertEquals(accountId, fence.authorizedAccountId);
        assertEquals(revision, fence.authorizedClaimRevision);
        assertEquals(token, fence.authorizedClaimToken);
        assertEquals(epoch, fence.claimEpoch);
    }

    @Test
    public void oldLogoutRacingNewSameAccountGenerationIsNoOpAndRound13AckStillWorks() throws Exception {
        newStore("logout_same_account");
        assertTrue(coordinator.syncAccountClaim("user-a", 1L, "tok-a-1"));
        assertTrue(coordinator.revokeAccountClaim("user-a", 1L));
        startLive("sess-a-gen2", "user-a", 2L, "tok-a-2");

        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1", "user-a", onDiscard));
        assertFalse(coordinator.clearIfAccountMismatch("user-a", 1L, "tok-a-1", null, onDiscard));
        assertEquals(0, teardowns.get());
        assertSessionKept("sess-a-gen2");
        assertFence("user-a", 2L, "tok-a-2", 2L);

        // Round 13 owner stop/ack fence is unchanged by the rejected cleanups.
        LocationRecordingPolicy.StopResult stopped = coordinator.finalizeAndFreezeForOwner(
            "user-a", "sess-a-gen2", 2L, "tok-a-2", 1_700_000_010_000L, null);
        assertNull(stopped.errorCode);
        assertFalse(coordinator.acknowledgeHandoff("sess-a-gen2", "user-a", 1L, "tok-a-1"));
        assertTrue(coordinator.acknowledgeHandoff("sess-a-gen2", "user-a", 2L, "tok-a-2"));
        assertNull(store.loadSession());
    }

    @Test
    public void oldAccountCleanupRacingOtherAccountsLiveSessionIsNoOp() throws Exception {
        newStore("old_account_vs_new_live");
        assertTrue(coordinator.syncAccountClaim("user-a", 1L, "tok-a-1"));
        assertTrue(coordinator.revokeAccountClaim("user-a", 1L));
        startLive("sess-b-live", "user-b", 2L, "tok-b-2");

        assertFalse(coordinator.clearIfAccountMismatch("user-a", 1L, "tok-a-1", null, onDiscard));
        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1", "user-a", onDiscard));
        // A sign-out for user-a that (wrongly) carries user-b's current revision is still not user-b's.
        assertFalse(coordinator.clearIfAccountMismatch(null, 2L, "tok-b-2", "user-a", onDiscard));
        assertEquals(0, teardowns.get());
        assertSessionKept("sess-b-live");
        assertFence("user-b", 2L, "tok-b-2", 2L);
    }

    @Test
    public void crossAccountCleanupCannotTransferTheCurrentClaimToAnotherAccount() throws Exception {
        newStore("cross_account_transfer");
        startLive("sess-b-live", "user-b", 2L, "tok-b-2");

        // Before Round 14, keep=user-a with user-b's revision discarded B's session and re-pinned the
        // fence to user-a at revision 2.
        assertFalse(coordinator.clearIfAccountMismatch("user-a", 2L, "tok-b-2", null, onDiscard));
        assertFalse(coordinator.clearIfAccountMismatch("user-a", 2L, null, null, onDiscard));
        assertEquals(0, teardowns.get());
        assertSessionKept("sess-b-live");
        assertFence("user-b", 2L, "tok-b-2", 2L);

        // A newer claim for user-a (Web revoked B and claimed A at 3) does take over.
        assertTrue(coordinator.clearIfAccountMismatch("user-a", 3L, "tok-a-3", null, onDiscard));
        assertEquals(1, teardowns.get());
        assertNull(store.loadSession());
        assertFence("user-a", 3L, "tok-a-3", 3L);
    }

    @Test
    public void sameAccountGenerationChangeRejectsOldRevisionAndWrongToken() throws Exception {
        newStore("same_account_generation");
        startLive("sess-a-gen2", "user-a", 2L, "tok-a-2");
        // A different account's orphaned cleanup would need the current token for revision 2.
        assertFalse(coordinator.clearIfAccountMismatch("user-b", 2L, "tok-a-2", null, onDiscard));
        assertFalse(coordinator.clearIfAccountMismatch("user-a", 2L, "tok-forged", null, onDiscard));
        assertFalse(coordinator.clearIfAccountMismatch(null, 2L, "tok-forged", "user-a", onDiscard));
        assertFalse(coordinator.clearIfAccountMismatch(null, 2L, null, "user-a", onDiscard));
        assertEquals(0, teardowns.get());
        assertSessionKept("sess-a-gen2");
        assertFence("user-a", 2L, "tok-a-2", 2L);

        // Matching keep cleanup for the same account keeps its session and the fence.
        assertFalse(coordinator.clearIfAccountMismatch("user-a", 2L, "tok-a-2", null, onDiscard));
        assertSessionKept("sess-a-gen2");
        assertFence("user-a", 2L, "tok-a-2", 2L);
    }

    @Test
    public void legacySessionWithoutRevisionIsProtectedByTheFenceThatAuthorizesItsAccount() throws Exception {
        newStore("legacy_session_generation");
        assertTrue(coordinator.syncAccountClaim("user-a", 4L, "tok-a-4"));
        startLive("sess-a-legacy", "user-a", 0L, null);
        assertNull(coordinator.currentSession().claimRevision);

        assertFalse(coordinator.clearIfAccountMismatch(null, 3L, null, "user-a", onDiscard));
        assertFalse(coordinator.clearIfAccountMismatch("user-b", 3L, null, null, onDiscard));
        assertEquals(0, teardowns.get());
        assertSessionKept("sess-a-legacy");
    }

    @Test
    public void lostFenceFileStillProtectsASessionStartedUnderANewerRevision() throws Exception {
        File dir = tmp.newFolder("lost_fence_file");
        store = new LocationRecordingPolicy.RecordingStore(dir);
        coordinator = new LocationRecordingPolicy.RecordingSessionCoordinator(store);
        startLive("sess-a-gen2", "user-a", 2L, "tok-a-2");
        assertTrue(new File(dir, "claim_fence.json").delete());
        assertNull(coordinator.currentClaimFence());

        assertFalse(coordinator.clearIfAccountMismatch("user-b", 1L, "tok-b-1", null, onDiscard));
        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, null, "user-a", onDiscard));
        assertFalse(coordinator.clearIfAccountMismatch(null, null, null, null, onDiscard));
        assertEquals(0, teardowns.get());
        assertSessionKept("sess-a-gen2");
    }

    @Test
    public void currentLogoutDiscardsOnlyTheDepartingAccountsSessionWhenRevokeReachedNativeFirst() throws Exception {
        newStore("logout_current_revoked_first");
        startLive("sess-a-live", "user-a", 1L, "tok-a-1");
        assertTrue(coordinator.revokeAccountClaim("user-a", 1L));

        assertTrue(coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1", "user-a", onDiscard));
        assertEquals(1, teardowns.get());
        assertNull(coordinator.currentSession());
        assertNull(store.loadSession());
        assertTrue(store.loadPoints(0).isEmpty());
        assertFence(null, null, null, 1L);

        // Duplicate delivery is a harmless no-op, and the next generation can still start.
        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1", "user-a", onDiscard));
        assertEquals(1, teardowns.get());
        startLive("sess-a-gen2", "user-a", 2L, "tok-a-2");
        assertSessionKept("sess-a-gen2");
    }

    @Test
    public void revokeFailureStillLetsTheMatchingLogoutCleanupButNotAForgedOne() throws Exception {
        newStore("revoke_failure");
        startLive("sess-a-live", "user-a", 1L, "tok-a-1");
        // The bridge revoke never arrived: the fence still authorizes user-a at revision 1.
        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, "tok-wrong", "user-a", onDiscard));
        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1", "user-b", onDiscard));
        assertEquals(0, teardowns.get());
        assertSessionKept("sess-a-live");

        assertTrue(coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1", "user-a", onDiscard));
        assertEquals(1, teardowns.get());
        assertNull(store.loadSession());
        assertFence(null, null, null, 1L);
    }

    @Test
    public void logoutForAnotherAccountLeavesAnOrphanedSessionOfTheOriginalOwner() throws Exception {
        newStore("logout_scoped_to_departing");
        startLive("sess-b-old", "user-b", 1L, "tok-b-1");
        // Native missed B's revoke; the Web layer has since claimed user-a at 2 and A signs out.
        assertFalse(coordinator.clearIfAccountMismatch(null, 2L, "tok-a-2", "user-a", onDiscard));
        assertEquals(0, teardowns.get());
        assertSessionKept("sess-b-old");
        assertFence(null, null, null, 2L);
    }

    @Test
    public void pinFailureLetsTheNewerClaimRemoveTheOrphanAndPinsTheFence() throws Exception {
        newStore("pin_failure");
        startLive("sess-b-orphan", "user-b", 1L, "tok-b-1");
        // syncAccountClaim(user-a, 2) failed on the bridge; the sign-in cleanup carries the claim.
        assertTrue(coordinator.clearIfAccountMismatch("user-a", 2L, "tok-a-2", null, onDiscard));
        assertEquals(1, teardowns.get());
        assertNull(store.loadSession());
        assertFence("user-a", 2L, "tok-a-2", 2L);

        // The orphan's own late cleanup can no longer re-pin user-b.
        assertFalse(coordinator.clearIfAccountMismatch("user-b", 1L, "tok-b-1", null, onDiscard));
        assertFence("user-a", 2L, "tok-a-2", 2L);
        startLive("sess-a-live", "user-a", 2L, "tok-a-2");
        assertSessionKept("sess-a-live");
    }

    @Test
    public void cleanupAfterClaimLossIsNoOpAgainstTheNewOwnerAndAckStillMatchesNewClaim() throws Exception {
        newStore("claim_loss");
        assertTrue(coordinator.syncAccountClaim("user-a", 1L, "tok-a-1"));
        // Another tab re-claimed (revision 2) and started recording; this page lost claim 1.
        startLive("sess-a-other-tab", "user-a", 2L, "tok-a-2");

        assertFalse(coordinator.clearIfAccountMismatch("user-a", 1L, "tok-a-1", null, onDiscard));
        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1", "user-a", onDiscard));
        assertFalse(coordinator.clearIfAccountMismatch(null, null, null, "user-a", onDiscard));
        assertEquals(0, teardowns.get());
        assertSessionKept("sess-a-other-tab");
        assertFence("user-a", 2L, "tok-a-2", 2L);
        LocationRecordingPolicy.StopResult staleStop = coordinator.finalizeAndFreezeForOwner(
            "user-a", "sess-a-other-tab", 1L, "tok-a-1", 1_700_000_010_000L, null);
        assertEquals("STALE_CLAIM", staleStop.errorCode);
    }

    @Test
    public void storeWithoutClaimHistoryKeepsLegacyUnscopedCleanup() throws Exception {
        newStore("legacy_unscoped");
        startLive("sess-legacy-b", "user-b", 0L, null);
        assertFalse(coordinator.clearIfAccountMismatch("user-b", null, null, null, onDiscard));
        assertTrue(coordinator.clearIfAccountMismatch("user-a", null, null, null, onDiscard));
        assertEquals(1, teardowns.get());
        assertNull(store.loadSession());
        assertNull(coordinator.currentClaimFence());
    }

    @Test
    public void concurrentStaleLogoutAndNewGenerationStartNeverLoseTheNewSession() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int i = 0; i < 40; i++) {
                newStore("race_" + i);
                teardowns.set(0);
                startLive("sess-a-gen1", "user-a", 1L, "tok-a-1");
                LocationRecordingPolicy.StopResult stopped = coordinator.finalizeAndFreezeForOwner(
                    "user-a", "sess-a-gen1", 1L, "tok-a-1", 1_700_000_005_000L, null);
                assertNull(stopped.errorCode);
                assertTrue(coordinator.acknowledgeHandoff("sess-a-gen1", "user-a", 1L, "tok-a-1"));
                assertTrue(coordinator.revokeAccountClaim("user-a", 1L));

                CyclicBarrier barrier = new CyclicBarrier(2);
                List<Future<Boolean>> results = new ArrayList<>();
                results.add(pool.submit(() -> {
                    barrier.await(5, TimeUnit.SECONDS);
                    return coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1", "user-a", onDiscard);
                }));
                results.add(pool.submit(() -> {
                    barrier.await(5, TimeUnit.SECONDS);
                    assertTrue(coordinator.syncAccountClaim("user-a", 2L, "tok-a-2"));
                    LocationRecordingPolicy.StartResult started = coordinator.startSession(
                        "sess-a-gen2", "user-a", "22222222-1414-4222-8222-222222222222", "",
                        false, 1_700_000_006_000L, 2L, "tok-a-2");
                    assertNull(started.errorCode);
                    return true;
                }));
                assertFalse(results.get(0).get(5, TimeUnit.SECONDS));
                assertTrue(results.get(1).get(5, TimeUnit.SECONDS));
                assertEquals(0, teardowns.get());
                assertEquals("sess-a-gen2", store.loadSession().sessionId);
                assertEquals("recording", coordinator.currentSession().status);
            }
        } finally {
            pool.shutdownNow();
        }
    }
}
