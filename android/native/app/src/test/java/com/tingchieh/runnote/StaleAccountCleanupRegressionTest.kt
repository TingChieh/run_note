package com.tingchieh.runnote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Round 14 regression: a delayed account cleanup issued for claim generation 1 reaches native after
 * generation 2 started a live recording. Uses only the pre-Round-14 coordinator API so the same file
 * runs against 51a04fc, where every case below discards the newer session.
 */
class StaleAccountCleanupRegressionTest {

    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun delayedGenerationOneLogoutCannotDiscardSameAccountGenerationTwoLiveSession() {
        val dir = tmp.newFolder("r14_same_account_logout")
        val store = LocationRecordingPolicy.RecordingStore(dir)
        val coordinator = LocationRecordingPolicy.RecordingSessionCoordinator(store)

        // Generation 1 signs out: the Web layer revokes claim 1, its native cleanup is still in flight.
        assertTrue(coordinator.syncAccountClaim("user-a", 1L, "tok-a-1"))
        assertTrue(coordinator.revokeAccountClaim("user-a", 1L))
        // The same runner signs in again (generation 2) and starts recording.
        startLive(coordinator, "sess-a-gen2", "user-a", 2L, "tok-a-2")

        // The delayed generation-1 sign-out cleanup arrives.
        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, null))
        assertLiveUntouched(store, coordinator, "sess-a-gen2", "user-a", 2L, "tok-a-2")
    }

    @Test
    fun delayedLogoutFromOldAccountCannotDiscardOtherAccountsLiveSession() {
        val dir = tmp.newFolder("r14_cross_account_logout")
        val store = LocationRecordingPolicy.RecordingStore(dir)
        val coordinator = LocationRecordingPolicy.RecordingSessionCoordinator(store)

        assertTrue(coordinator.syncAccountClaim("user-a", 1L, "tok-a-1"))
        assertTrue(coordinator.revokeAccountClaim("user-a", 1L))
        startLive(coordinator, "sess-b-live", "user-b", 2L, "tok-b-2")

        assertFalse(coordinator.clearIfAccountMismatch(null, 1L, "tok-a-1"))
        assertLiveUntouched(store, coordinator, "sess-b-live", "user-b", 2L, "tok-b-2")
    }

    @Test
    fun delayedSignInCleanupForOldAccountCannotDiscardOtherAccountsLiveSession() {
        val dir = tmp.newFolder("r14_cross_account_keep")
        val store = LocationRecordingPolicy.RecordingStore(dir)
        val coordinator = LocationRecordingPolicy.RecordingSessionCoordinator(store)

        assertTrue(coordinator.syncAccountClaim("user-a", 1L, "tok-a-1"))
        assertTrue(coordinator.revokeAccountClaim("user-a", 1L))
        startLive(coordinator, "sess-b-live", "user-b", 2L, "tok-b-2")

        // A late "keep user-a" cleanup from an old tab still holding claim 1.
        assertFalse(coordinator.clearIfAccountMismatch("user-a", 1L, "tok-a-1"))
        assertLiveUntouched(store, coordinator, "sess-b-live", "user-b", 2L, "tok-b-2")
    }

    @Test
    fun unscopedCleanupWithoutRevisionCannotDiscardFencedLiveSession() {
        val dir = tmp.newFolder("r14_unscoped")
        val store = LocationRecordingPolicy.RecordingStore(dir)
        val coordinator = LocationRecordingPolicy.RecordingSessionCoordinator(store)

        startLive(coordinator, "sess-b-live", "user-b", 2L, "tok-b-2")

        assertFalse(coordinator.clearIfAccountMismatch(null, null, null))
        assertFalse(coordinator.clearIfAccountMismatch("user-a", null, null))
        assertLiveUntouched(store, coordinator, "sess-b-live", "user-b", 2L, "tok-b-2")
    }

    private companion object {
        fun point(lat: Double, t: Long): LocationRecordingPolicy.RecordedPoint =
            LocationRecordingPolicy.RecordedPoint(lat, 121.47, 10.0, 5.0, t, 0)

        fun startLive(
            coordinator: LocationRecordingPolicy.RecordingSessionCoordinator,
            sessionId: String,
            accountId: String,
            claimRevision: Long,
            claimToken: String,
        ) {
            assertTrue(coordinator.syncAccountClaim(accountId, claimRevision, claimToken))
            val started = coordinator.startSession(
                sessionId,
                accountId,
                "14141414-1414-4141-8141-" + String.format("%012d", claimRevision),
                "第十四轮",
                false,
                1_700_000_000_000L,
                claimRevision,
                claimToken,
            )
            assertNull(started.errorCode)
            assertNotNull(coordinator.recordLocationPoint(point(31.2300, 1_700_000_001_000L)))
            assertNotNull(coordinator.recordLocationPoint(point(31.2302, 1_700_000_011_000L)))
        }

        fun assertLiveUntouched(
            store: LocationRecordingPolicy.RecordingStore,
            coordinator: LocationRecordingPolicy.RecordingSessionCoordinator,
            sessionId: String,
            accountId: String,
            claimRevision: Long,
            claimToken: String,
        ) {
            assertNotNull("newer live session must survive the stale cleanup", coordinator.currentSession())
            assertEquals(sessionId, coordinator.currentSession()!!.sessionId)
            assertEquals("recording", coordinator.currentSession()!!.status)
            assertEquals(sessionId, store.loadSession()!!.sessionId)
            assertEquals(2, store.loadPoints(0).size)
            val fence = coordinator.currentClaimFence()!!
            assertEquals(accountId, fence.authorizedAccountId)
            assertEquals(claimRevision, fence.authorizedClaimRevision)
            assertEquals(claimToken, fence.authorizedClaimToken)
            assertNotNull(coordinator.recordLocationPoint(point(31.2304, 1_700_000_021_000L)))
            assertEquals(3, store.loadPoints(0).size)
        }
    }
}
