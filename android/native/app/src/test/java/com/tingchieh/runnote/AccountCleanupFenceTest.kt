package com.tingchieh.runnote

import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Round 14: account cleanup is fenced by account, claim revision/token and the live session's
 * generation inside one critical section, and GPS teardown (`onDiscard`) runs only for the session
 * that is actually removed.
 */
class AccountCleanupFenceTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private lateinit var store: LocationRecordingPolicy.RecordingStore
    private lateinit var coordinator: LocationRecordingPolicy.RecordingSessionCoordinator
    private val teardowns = AtomicInteger()
    private val onDiscard = Runnable { teardowns.incrementAndGet() }

    private fun newStore(name: String) {
        val dir = tmp.newFolder(name)
        store = LocationRecordingPolicy.RecordingStore(dir)
        coordinator = LocationRecordingPolicy.RecordingSessionCoordinator(store)
    }

    private fun startLive(sessionId: String, accountId: String, claimRevision: Long, claimToken: String?) {
        if (claimRevision > 0L) {
            assertTrue(coordinator.syncAccountClaim(accountId, claimRevision, claimToken))
        }
        val started = coordinator.startSession(
            sessionId,
            accountId,
            "14141414-1414-4141-8141-" + String.format("%012d", abs(sessionId.hashCode())),
            "第十四轮",
            false,
            1_700_000_000_000L,
            claimRevision,
            claimToken,
        )
        assertNull(started.errorCode)
        assertNotNull(coordinator.recordLocationPoint(point(31.2300, 1_700_000_001_000L)))
    }

    private fun assertSessionKept(sessionId: String) {
        assertNotNull(coordinator.currentSession())
        assertEquals(sessionId, coordinator.currentSession()!!.sessionId)
        assertEquals(sessionId, store.loadSession()!!.sessionId)
        assertEquals(1, store.loadPoints(0).size)
    }

    private fun assertFence(accountId: String?, revision: Long?, token: String?, epoch: Long) {
        val fence = coordinator.currentClaimFence()
        assertNotNull(fence)
        assertEquals(accountId, fence!!.authorizedAccountId)
        assertEquals(revision, fence.authorizedClaimRevision)
        assertEquals(token, fence.authorizedClaimToken)
        assertEquals(epoch, fence.claimEpoch)
    }

    @Test
    fun oldLogoutRacingNewSameAccountGenerationIsNoOpAndRound13AckStillWorks() {
        newStore("logout_same_account")
        assertTrue(coordinator.syncAccountClaim("user-a", 1L, "tok-a-1"))
        assertTrue(coordinator.revokeAccountClaim("user-a", 1L))
        startLive("sess-a-gen2", "user-a", 2L, "tok-a-2")

        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1", "user-a", onDiscard))
        assertFalse(coordinator.clearIfAccountMismatch("user-a", 1L, "tok-a-1", null, onDiscard))
        assertEquals(0, teardowns.get())
        assertSessionKept("sess-a-gen2")
        assertFence("user-a", 2L, "tok-a-2", 2L)

        // Round 13 owner stop/ack fence is unchanged by the rejected cleanups.
        val stopped = coordinator.finalizeAndFreezeForOwner(
            "user-a", "sess-a-gen2", 2L, "tok-a-2", 1_700_000_010_000L, null)
        assertNull(stopped.errorCode)
        assertFalse(coordinator.acknowledgeHandoff("sess-a-gen2", "user-a", 1L, "tok-a-1"))
        assertTrue(coordinator.acknowledgeHandoff("sess-a-gen2", "user-a", 2L, "tok-a-2"))
        assertNull(store.loadSession())
    }

    @Test
    fun oldAccountCleanupRacingOtherAccountsLiveSessionIsNoOp() {
        newStore("old_account_vs_new_live")
        assertTrue(coordinator.syncAccountClaim("user-a", 1L, "tok-a-1"))
        assertTrue(coordinator.revokeAccountClaim("user-a", 1L))
        startLive("sess-b-live", "user-b", 2L, "tok-b-2")

        assertFalse(coordinator.clearIfAccountMismatch("user-a", 1L, "tok-a-1", null, onDiscard))
        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1", "user-a", onDiscard))
        // A sign-out for user-a that (wrongly) carries user-b's current revision is still not user-b's.
        assertFalse(coordinator.clearIfAccountMismatch(null, 2L, "tok-b-2", "user-a", onDiscard))
        assertEquals(0, teardowns.get())
        assertSessionKept("sess-b-live")
        assertFence("user-b", 2L, "tok-b-2", 2L)
    }

    @Test
    fun crossAccountCleanupCannotTransferTheCurrentClaimToAnotherAccount() {
        newStore("cross_account_transfer")
        startLive("sess-b-live", "user-b", 2L, "tok-b-2")

        // Before Round 14, keep=user-a with user-b's revision discarded B's session and re-pinned the
        // fence to user-a at revision 2.
        assertFalse(coordinator.clearIfAccountMismatch("user-a", 2L, "tok-b-2", null, onDiscard))
        assertFalse(coordinator.clearIfAccountMismatch("user-a", 2L, null, null, onDiscard))
        assertEquals(0, teardowns.get())
        assertSessionKept("sess-b-live")
        assertFence("user-b", 2L, "tok-b-2", 2L)

        // A newer claim for user-a (Web revoked B and claimed A at 3) does take over.
        assertTrue(coordinator.clearIfAccountMismatch("user-a", 3L, "tok-a-3", null, onDiscard))
        assertEquals(1, teardowns.get())
        assertNull(store.loadSession())
        assertFence("user-a", 3L, "tok-a-3", 3L)
    }

    @Test
    fun sameAccountGenerationChangeRejectsOldRevisionAndWrongToken() {
        newStore("same_account_generation")
        startLive("sess-a-gen2", "user-a", 2L, "tok-a-2")
        // A different account's orphaned cleanup would need the current token for revision 2.
        assertFalse(coordinator.clearIfAccountMismatch("user-b", 2L, "tok-a-2", null, onDiscard))
        assertFalse(coordinator.clearIfAccountMismatch("user-a", 2L, "tok-forged", null, onDiscard))
        assertFalse(coordinator.clearIfAccountMismatch(null, 2L, "tok-forged", "user-a", onDiscard))
        assertFalse(coordinator.clearIfAccountMismatch(null, 2L, null, "user-a", onDiscard))
        assertEquals(0, teardowns.get())
        assertSessionKept("sess-a-gen2")
        assertFence("user-a", 2L, "tok-a-2", 2L)

        // Matching keep cleanup for the same account keeps its session and the fence.
        assertFalse(coordinator.clearIfAccountMismatch("user-a", 2L, "tok-a-2", null, onDiscard))
        assertSessionKept("sess-a-gen2")
        assertFence("user-a", 2L, "tok-a-2", 2L)
    }

    @Test
    fun legacySessionWithoutRevisionIsProtectedByTheFenceThatAuthorizesItsAccount() {
        newStore("legacy_session_generation")
        assertTrue(coordinator.syncAccountClaim("user-a", 4L, "tok-a-4"))
        startLive("sess-a-legacy", "user-a", 0L, null)
        assertNull(coordinator.currentSession()!!.claimRevision)

        assertFalse(coordinator.clearIfAccountMismatch(null, 3L, null, "user-a", onDiscard))
        assertFalse(coordinator.clearIfAccountMismatch("user-b", 3L, null, null, onDiscard))
        assertEquals(0, teardowns.get())
        assertSessionKept("sess-a-legacy")
    }

    @Test
    fun lostFenceFileStillProtectsASessionStartedUnderANewerRevision() {
        val dir = tmp.newFolder("lost_fence_file")
        store = LocationRecordingPolicy.RecordingStore(dir)
        coordinator = LocationRecordingPolicy.RecordingSessionCoordinator(store)
        startLive("sess-a-gen2", "user-a", 2L, "tok-a-2")
        assertTrue(File(dir, "claim_fence.json").delete())
        assertNull(coordinator.currentClaimFence())

        assertFalse(coordinator.clearIfAccountMismatch("user-b", 1L, "tok-b-1", null, onDiscard))
        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, null, "user-a", onDiscard))
        assertFalse(coordinator.clearIfAccountMismatch(null, null, null, null, onDiscard))
        assertEquals(0, teardowns.get())
        assertSessionKept("sess-a-gen2")
    }

    @Test
    fun currentLogoutDiscardsOnlyTheDepartingAccountsSessionWhenRevokeReachedNativeFirst() {
        newStore("logout_current_revoked_first")
        startLive("sess-a-live", "user-a", 1L, "tok-a-1")
        assertTrue(coordinator.revokeAccountClaim("user-a", 1L))

        assertTrue(coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1", "user-a", onDiscard))
        assertEquals(1, teardowns.get())
        assertNull(coordinator.currentSession())
        assertNull(store.loadSession())
        assertTrue(store.loadPoints(0).isEmpty())
        assertFence(null, null, null, 1L)

        // Duplicate delivery is a harmless no-op, and the next generation can still start.
        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1", "user-a", onDiscard))
        assertEquals(1, teardowns.get())
        startLive("sess-a-gen2", "user-a", 2L, "tok-a-2")
        assertSessionKept("sess-a-gen2")
    }

    @Test
    fun revokeFailureStillLetsTheMatchingLogoutCleanupButNotAForgedOne() {
        newStore("revoke_failure")
        startLive("sess-a-live", "user-a", 1L, "tok-a-1")
        // The bridge revoke never arrived: the fence still authorizes user-a at revision 1.
        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, "tok-wrong", "user-a", onDiscard))
        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1", "user-b", onDiscard))
        assertEquals(0, teardowns.get())
        assertSessionKept("sess-a-live")

        assertTrue(coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1", "user-a", onDiscard))
        assertEquals(1, teardowns.get())
        assertNull(store.loadSession())
        assertFence(null, null, null, 1L)
    }

    @Test
    fun logoutForAnotherAccountLeavesAnOrphanedSessionOfTheOriginalOwner() {
        newStore("logout_scoped_to_departing")
        startLive("sess-b-old", "user-b", 1L, "tok-b-1")
        // Native missed B's revoke; the Web layer has since claimed user-a at 2 and A signs out.
        assertFalse(coordinator.clearIfAccountMismatch(null, 2L, "tok-a-2", "user-a", onDiscard))
        assertEquals(0, teardowns.get())
        assertSessionKept("sess-b-old")
        assertFence(null, null, null, 2L)
    }

    @Test
    fun pinFailureLetsTheNewerClaimRemoveTheOrphanAndPinsTheFence() {
        newStore("pin_failure")
        startLive("sess-b-orphan", "user-b", 1L, "tok-b-1")
        // syncAccountClaim(user-a, 2) failed on the bridge; the sign-in cleanup carries the claim.
        assertTrue(coordinator.clearIfAccountMismatch("user-a", 2L, "tok-a-2", null, onDiscard))
        assertEquals(1, teardowns.get())
        assertNull(store.loadSession())
        assertFence("user-a", 2L, "tok-a-2", 2L)

        // The orphan's own late cleanup can no longer re-pin user-b.
        assertFalse(coordinator.clearIfAccountMismatch("user-b", 1L, "tok-b-1", null, onDiscard))
        assertFence("user-a", 2L, "tok-a-2", 2L)
        startLive("sess-a-live", "user-a", 2L, "tok-a-2")
        assertSessionKept("sess-a-live")
    }

    @Test
    fun cleanupAfterClaimLossIsNoOpAgainstTheNewOwnerAndAckStillMatchesNewClaim() {
        newStore("claim_loss")
        assertTrue(coordinator.syncAccountClaim("user-a", 1L, "tok-a-1"))
        // Another tab re-claimed (revision 2) and started recording; this page lost claim 1.
        startLive("sess-a-other-tab", "user-a", 2L, "tok-a-2")

        assertFalse(coordinator.clearIfAccountMismatch("user-a", 1L, "tok-a-1", null, onDiscard))
        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1", "user-a", onDiscard))
        assertFalse(coordinator.clearIfAccountMismatch(null, null, null, "user-a", onDiscard))
        assertEquals(0, teardowns.get())
        assertSessionKept("sess-a-other-tab")
        assertFence("user-a", 2L, "tok-a-2", 2L)
        val staleStop = coordinator.finalizeAndFreezeForOwner(
            "user-a", "sess-a-other-tab", 1L, "tok-a-1", 1_700_000_010_000L, null)
        assertEquals("STALE_CLAIM", staleStop.errorCode)
    }

    @Test
    fun storeWithoutClaimHistoryKeepsLegacyUnscopedCleanup() {
        newStore("legacy_unscoped")
        startLive("sess-legacy-b", "user-b", 0L, null)
        assertFalse(coordinator.clearIfAccountMismatch("user-b", null, null, null, onDiscard))
        assertTrue(coordinator.clearIfAccountMismatch("user-a", null, null, null, onDiscard))
        assertEquals(1, teardowns.get())
        assertNull(store.loadSession())
        assertNull(coordinator.currentClaimFence())
    }

    @Test
    fun concurrentStaleLogoutAndNewGenerationStartNeverLoseTheNewSession() {
        val pool = Executors.newFixedThreadPool(2)
        try {
            for (i in 0 until 40) {
                newStore("race_$i")
                teardowns.set(0)
                startLive("sess-a-gen1", "user-a", 1L, "tok-a-1")
                val stopped = coordinator.finalizeAndFreezeForOwner(
                    "user-a", "sess-a-gen1", 1L, "tok-a-1", 1_700_000_005_000L, null)
                assertNull(stopped.errorCode)
                assertTrue(coordinator.acknowledgeHandoff("sess-a-gen1", "user-a", 1L, "tok-a-1"))
                assertTrue(coordinator.revokeAccountClaim("user-a", 1L))

                val barrier = CyclicBarrier(2)
                val results = ArrayList<Future<Boolean>>()
                results.add(
                    pool.submit(
                        Callable {
                            barrier.await(5, TimeUnit.SECONDS)
                            coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1", "user-a", onDiscard)
                        },
                    ),
                )
                results.add(
                    pool.submit(
                        Callable {
                            barrier.await(5, TimeUnit.SECONDS)
                            assertTrue(coordinator.syncAccountClaim("user-a", 2L, "tok-a-2"))
                            val started = coordinator.startSession(
                                "sess-a-gen2", "user-a", "22222222-1414-4222-8222-222222222222", "",
                                false, 1_700_000_006_000L, 2L, "tok-a-2")
                            assertNull(started.errorCode)
                            true
                        },
                    ),
                )
                assertFalse(results[0].get(5, TimeUnit.SECONDS))
                assertTrue(results[1].get(5, TimeUnit.SECONDS))
                assertEquals(0, teardowns.get())
                assertEquals("sess-a-gen2", store.loadSession()!!.sessionId)
                assertEquals("recording", coordinator.currentSession()!!.status)
            }
        } finally {
            pool.shutdownNow()
        }
    }

    private companion object {
        fun point(lat: Double, t: Long): LocationRecordingPolicy.RecordedPoint =
            LocationRecordingPolicy.RecordedPoint(lat, 121.47, 10.0, 5.0, t, 0)
    }
}
