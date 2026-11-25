package com.tingchieh.runnote;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * Round 14 regression: a delayed account cleanup issued for claim generation 1 reaches native after
 * generation 2 started a live recording. Uses only the pre-Round-14 coordinator API so the same file
 * runs against 51a04fc, where every case below discards the newer session.
 */
public class StaleAccountCleanupRegressionTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static LocationRecordingPolicy.RecordedPoint point(double lat, long t) {
        return new LocationRecordingPolicy.RecordedPoint(lat, 121.47, 10.0, 5.0, t, 0);
    }

    private static void startLive(
        LocationRecordingPolicy.RecordingSessionCoordinator coordinator,
        String sessionId,
        String accountId,
        long claimRevision,
        String claimToken
    ) {
        assertTrue(coordinator.syncAccountClaim(accountId, claimRevision, claimToken));
        LocationRecordingPolicy.StartResult started = coordinator.startSession(
            sessionId,
            accountId,
            "14141414-1414-4141-8141-" + String.format("%012d", claimRevision),
            "第十四轮",
            false,
            1_700_000_000_000L,
            claimRevision,
            claimToken
        );
        assertNull(started.errorCode);
        assertNotNull(coordinator.recordLocationPoint(point(31.2300, 1_700_000_001_000L)));
        assertNotNull(coordinator.recordLocationPoint(point(31.2302, 1_700_000_011_000L)));
    }

    private static void assertLiveUntouched(
        LocationRecordingPolicy.RecordingStore store,
        LocationRecordingPolicy.RecordingSessionCoordinator coordinator,
        String sessionId,
        String accountId,
        long claimRevision,
        String claimToken
    ) {
        assertNotNull("newer live session must survive the stale cleanup", coordinator.currentSession());
        assertEquals(sessionId, coordinator.currentSession().sessionId);
        assertEquals("recording", coordinator.currentSession().status);
        assertEquals(sessionId, store.loadSession().sessionId);
        assertEquals(2, store.loadPoints(0).size());
        LocationRecordingPolicy.ClaimFence fence = coordinator.currentClaimFence();
        assertEquals(accountId, fence.authorizedAccountId);
        assertEquals(Long.valueOf(claimRevision), fence.authorizedClaimRevision);
        assertEquals(claimToken, fence.authorizedClaimToken);
        assertNotNull(coordinator.recordLocationPoint(point(31.2304, 1_700_000_021_000L)));
        assertEquals(3, store.loadPoints(0).size());
    }

    @Test
    public void delayedGenerationOneLogoutCannotDiscardSameAccountGenerationTwoLiveSession() throws Exception {
        File dir = tmp.newFolder("r14_same_account_logout");
        LocationRecordingPolicy.RecordingStore store = new LocationRecordingPolicy.RecordingStore(dir);
        LocationRecordingPolicy.RecordingSessionCoordinator coordinator =
            new LocationRecordingPolicy.RecordingSessionCoordinator(store);

        // Generation 1 signs out: the Web layer revokes claim 1, its native cleanup is still in flight.
        assertTrue(coordinator.syncAccountClaim("user-a", 1L, "tok-a-1"));
        assertTrue(coordinator.revokeAccountClaim("user-a", 1L));
        // The same runner signs in again (generation 2) and starts recording.
        startLive(coordinator, "sess-a-gen2", "user-a", 2L, "tok-a-2");

        // The delayed generation-1 sign-out cleanup arrives.
        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, null));
        assertLiveUntouched(store, coordinator, "sess-a-gen2", "user-a", 2L, "tok-a-2");
    }

    @Test
    public void delayedLogoutFromOldAccountCannotDiscardOtherAccountsLiveSession() throws Exception {
        File dir = tmp.newFolder("r14_cross_account_logout");
        LocationRecordingPolicy.RecordingStore store = new LocationRecordingPolicy.RecordingStore(dir);
        LocationRecordingPolicy.RecordingSessionCoordinator coordinator =
            new LocationRecordingPolicy.RecordingSessionCoordinator(store);

        assertTrue(coordinator.syncAccountClaim("user-a", 1L, "tok-a-1"));
        assertTrue(coordinator.revokeAccountClaim("user-a", 1L));
        startLive(coordinator, "sess-b-live", "user-b", 2L, "tok-b-2");

        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1"));
        assertLiveUntouched(store, coordinator, "sess-b-live", "user-b", 2L, "tok-b-2");
    }

    @Test
    public void delayedSignInCleanupForOldAccountCannotDiscardOtherAccountsLiveSession() throws Exception {
        File dir = tmp.newFolder("r14_cross_account_keep");
        LocationRecordingPolicy.RecordingStore store = new LocationRecordingPolicy.RecordingStore(dir);
        LocationRecordingPolicy.RecordingSessionCoordinator coordinator =
            new LocationRecordingPolicy.RecordingSessionCoordinator(store);

        assertTrue(coordinator.syncAccountClaim("user-a", 1L, "tok-a-1"));
        assertTrue(coordinator.revokeAccountClaim("user-a", 1L));
        startLive(coordinator, "sess-b-live", "user-b", 2L, "tok-b-2");

        // A late "keep user-a" cleanup from an old tab still holding claim 1.
        assertFalse(coordinator.clearIfAccountMismatch("user-a", 1L, "tok-a-1"));
        assertLiveUntouched(store, coordinator, "sess-b-live", "user-b", 2L, "tok-b-2");
    }

    @Test
    public void unscopedCleanupWithoutRevisionCannotDiscardFencedLiveSession() throws Exception {
        File dir = tmp.newFolder("r14_unscoped");
        LocationRecordingPolicy.RecordingStore store = new LocationRecordingPolicy.RecordingStore(dir);
        LocationRecordingPolicy.RecordingSessionCoordinator coordinator =
            new LocationRecordingPolicy.RecordingSessionCoordinator(store);

        startLive(coordinator, "sess-b-live", "user-b", 2L, "tok-b-2");

        assertFalse(coordinator.clearIfAccountMismatch(null, null, null));
        assertFalse(coordinator.clearIfAccountMismatch("user-a", null, null));
        assertLiveUntouched(store, coordinator, "sess-b-live", "user-b", 2L, "tok-b-2");
    }
}
