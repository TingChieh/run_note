package com.tingchieh.runnote

import android.content.pm.ServiceInfo
import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.StandardOpenOption
import java.util.concurrent.Callable
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class LocationRecordingPolicyTest {

    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun manifestDeclaresMinimalForegroundLocationPermissionsAndNoBackgroundLocation() {
        val manifest = File("src/main/AndroidManifest.xml")
        assertTrue("Manifest file must exist", manifest.exists())
        val xml = String(Files.readAllBytes(manifest.toPath()), StandardCharsets.UTF_8)

        for (required in LocationRecordingPolicy.REQUIRED_MANIFEST_PERMISSIONS) {
            assertTrue("Missing required recording permission: $required", xml.contains(required))
        }
        for (forbidden in LocationRecordingPolicy.FORBIDDEN_LOCATION_PERMISSIONS) {
            assertFalse("Forbidden background location permission declared: $forbidden", xml.contains(forbidden))
        }
        assertTrue("RecordingForegroundService must be declared", xml.contains("RecordingForegroundService"))
        assertTrue("Service must declare foregroundServiceType=location", xml.contains("android:foregroundServiceType=\"location\""))
        assertTrue("Service must not be exported", xml.contains("android:exported=\"false\""))
    }

    @Test
    fun evaluatesPermissionsAcrossAndroidVersionsAndOneTimeApproximateGrants() {
        // Android 10 (API 29): notification permission not required
        val api29 =
            LocationRecordingPolicy.evaluatePermissions(true, true, 29, false, true)
        assertEquals("granted", api29.locationStatus)
        assertEquals("not_required", api29.notificationStatus)
        assertTrue(api29.preciseLocation)
        assertTrue(api29.canRecord)

        // Android 13+ (API 33): notification denied does not crash recording, but reports denied
        val api33NoNotif =
            LocationRecordingPolicy.evaluatePermissions(true, true, 33, false, true)
        assertEquals("granted", api33NoNotif.locationStatus)
        assertEquals("denied", api33NoNotif.notificationStatus)
        assertTrue(api33NoNotif.canRecord)

        // Android 12+ approximate-only grant cannot record accurate running tracks
        val approx =
            LocationRecordingPolicy.evaluatePermissions(false, true, 34, true, true)
        assertEquals("approximate", approx.locationStatus)
        assertFalse(approx.preciseLocation)
        assertFalse(approx.canRecord)

        // Denied or location services disabled cannot record
        val denied =
            LocationRecordingPolicy.evaluatePermissions(false, false, 34, true, true)
        assertEquals("denied", denied.locationStatus)
        assertFalse(denied.canRecord)

        val locOff =
            LocationRecordingPolicy.evaluatePermissions(true, true, 34, true, false)
        assertFalse(locOff.canRecord)

        // Requested permission array matches API level
        val req29 = LocationRecordingPolicy.permissionsToRequest(29).asList()
        assertFalse(req29.contains("android.permission.POST_NOTIFICATIONS"))
        val req33 = LocationRecordingPolicy.permissionsToRequest(33).asList()
        assertTrue(req33.contains("android.permission.POST_NOTIFICATIONS"))
        assertFalse(req33.contains("android.permission.ACCESS_BACKGROUND_LOCATION"))

        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            LocationRecordingPolicy.foregroundServiceTypeForApi(29)
        )
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            LocationRecordingPolicy.foregroundServiceTypeForApi(36)
        )
    }

    @Test
    fun classifiesGpsSignalQualityAndFiltersBadFixes() {
        assertEquals("permission_denied", LocationRecordingPolicy.classifyGpsSignal("recording", true, false, 5.0, 0L))
        assertEquals("disabled", LocationRecordingPolicy.classifyGpsSignal("recording", false, true, 5.0, 0L))
        assertEquals("acquiring", LocationRecordingPolicy.classifyGpsSignal("recording", true, true, null, null))
        assertEquals("good", LocationRecordingPolicy.classifyGpsSignal("recording", true, true, 8.5, 1_000L))
        assertEquals("weak", LocationRecordingPolicy.classifyGpsSignal("recording", true, true, 32.0, 2_000L))
        assertEquals("lost", LocationRecordingPolicy.classifyGpsSignal("recording", true, true, 8.0, 20_000L))
        assertEquals("inactive", LocationRecordingPolicy.classifyGpsSignal("paused", true, true, 8.0, 1_000L))

        val p1 =
            LocationRecordingPolicy.RecordedPoint(31.2300, 121.4700, 12.0, 6.0, 1_700_000_000_000L, 0)
        val d1 = LocationRecordingPolicy.evaluatePoint(p1, null, 0)
        assertTrue(d1.accepted)
        assertEquals(0.0, d1.distanceDeltaM, 0.001)

        // Poor accuracy rejected (> 50m)
        val poor =
            LocationRecordingPolicy.RecordedPoint(31.2301, 121.4701, 12.0, 85.0, 1_700_000_005_000L, 0)
        assertFalse(LocationRecordingPolicy.evaluatePoint(poor, p1, 1).accepted)

        // Normal running step (~11m in 4s = 2.75 m/s) accepted
        val p2 =
            LocationRecordingPolicy.RecordedPoint(31.2301, 121.4700, 12.5, 7.0, 1_700_000_004_000L, 0)
        val d2 = LocationRecordingPolicy.evaluatePoint(p2, p1, 1)
        assertTrue(d2.accepted)
        assertTrue(d2.distanceDeltaM > 10.0 && d2.distanceDeltaM < 13.0)

        // Unrealistic teleport jump (> 12 m/s) within same segment rejected
        val jump =
            LocationRecordingPolicy.RecordedPoint(31.2400, 121.4700, 12.0, 5.0, 1_700_000_005_000L, 0)
        val dJump = LocationRecordingPolicy.evaluatePoint(jump, p2, 2)
        assertFalse(dJump.accepted)
        assertEquals("speed_jump", dJump.reason)

        // New segment after pause accepts location without connecting pause gap distance
        val resumed =
            LocationRecordingPolicy.RecordedPoint(31.2400, 121.4700, 12.0, 5.0, 1_700_000_600_000L, 1)
        val dResumed = LocationRecordingPolicy.evaluatePoint(resumed, p2, 2)
        assertTrue(dResumed.accepted)
        assertEquals(0.0, dResumed.distanceDeltaM, 0.001)
    }

    @Test
    fun persistsRecoversAfterCrashSkipsCorruptTrailingLineAndIsolatesAccounts() {
        val dir = tmp.newFolder("recordings")
        val store = LocationRecordingPolicy.RecordingStore(dir)

        val session = LocationRecordingPolicy.SessionRecord(
            "sess-1",
            "user-a",
            "11111111-1111-4111-8111-111111111111",
            "晨跑",
            "recording",
            1_700_000_000_000L,
            null,
            10_000L,
            1_700_000_010_000L,
            0,
            2,
            22.4,
            1_700_000_020_000L,
            6.5,
            null
        )
        store.saveSession(session)
        store.appendPoint(LocationRecordingPolicy.RecordedPoint(31.2300, 121.4700, 10.0, 6.0, 1_700_000_000_000L, 0))
        store.appendPoint(LocationRecordingPolicy.RecordedPoint(31.2302, 121.4700, 10.5, 6.5, 1_700_000_020_000L, 0))

        // Simulate abrupt power loss writing a truncated trailing NDJSON line
        val pointsFile = File(dir, "points.ndjson")
        Files.write(
            pointsFile.toPath(),
            "{\"lat\":31.23,\"lon\":".toByteArray(StandardCharsets.UTF_8),
            StandardOpenOption.APPEND
        )

        val loaded = store.loadSession()
        assertNotNull(loaded)
        assertEquals(2, loaded!!.pointCount)
        assertEquals(2, store.loadPoints(0).size)

        // Truncated tail was repaired on load, so appending a new point decodes cleanly on a fresh line
        store.appendPoint(LocationRecordingPolicy.RecordedPoint(31.2304, 121.4700, 11.0, 6.0, 1_700_000_040_000L, 0))
        assertEquals(3, store.loadPoints(0).size)

        // Account-scoped reads isolate other accounts without leaking metadata or points
        assertNotNull(store.loadSessionForAccount("user-a"))
        assertEquals(3, store.loadPointsForAccount("user-a", 0).size)
        assertNull(store.loadSessionForAccount("user-b"))
        assertTrue(store.loadPointsForAccount("user-b", 0).isEmpty())

        // After process death (serviceRunning = false), recording reconciles to interrupted with frozen duration
        val reconciled =
            LocationRecordingPolicy.reconcileAfterRestart(loaded, false)
        assertNotNull(reconciled)
        assertEquals("interrupted", reconciled!!.status)
        assertEquals("process_terminated", reconciled!!.interruptedReason)
        assertEquals(20_000L, reconciled!!.activeDurationMs)
        assertNull(reconciled!!.lastSegmentStartMs)

        // Stopped session with points survives restart as pending handoff until explicitly acknowledged
        val stopped = LocationRecordingPolicy.SessionRecord(
            "sess-stopped",
            "user-a",
            "22222222-2222-4222-8222-222222222222",
            "待入队晨跑",
            "stopped",
            1_700_000_000_000L,
            1_700_000_040_000L,
            40_000L,
            null,
            0,
            3,
            45.0,
            1_700_000_040_000L,
            6.0,
            null
        )
        store.saveSession(stopped)
        val reloadedStopped =
            LocationRecordingPolicy.reconcileAfterRestart(store.loadSession(), false)
        assertNotNull(reloadedStopped)
        assertEquals("stopped", reloadedStopped!!.status)
        assertTrue(LocationRecordingPolicy.hasPendingHandoff(reloadedStopped))

        // Wrong sessionId or accountId or non-positive claimRevision does NOT clear pending handoff
        // matching (sessionId, accountId, claimRevision) acknowledges and clears
        assertFalse(store.acknowledgeHandoff("wrong-session", "user-a", 1L))
        assertFalse(store.acknowledgeHandoff("sess-stopped", "user-b", 1L))
        assertFalse(store.acknowledgeHandoff("sess-stopped", "user-a", 0L))
        assertNotNull(store.loadSession())
        assertTrue(store.acknowledgeHandoff("sess-stopped", "user-a", 1L))
        assertNull(store.loadSession())
        assertTrue(store.loadPoints(0).isEmpty())

        // Re-save and verify account switch cleanup
        store.saveSession(session)
        assertFalse(store.clearIfAccountMismatch("user-a"))
        assertNotNull(store.loadSession())
        assertTrue(store.clearIfAccountMismatch("user-b"))
        assertNull(store.loadSession())
        assertTrue(store.loadPoints(0).isEmpty())
    }

    @Test
    fun enforcesCrossInstanceLockSingleFinalizerAckOrderingAndCrashRecovery() {
        val dir = tmp.newFolder("concurrent_recordings")
        val storeA = LocationRecordingPolicy.RecordingStore(dir)
        val storeB = LocationRecordingPolicy.RecordingStore(dir)
        val coordinator =
            LocationRecordingPolicy.RecordingSessionCoordinator(storeA)

        // 1. Cross-instance lock keeps concurrent writes from storeA and storeB consistent
        val startRes = coordinator.startSession(
            "sess-lock",
            "user-a",
            "11111111-1111-4111-8111-111111111111",
            "并发锁测试",
            false,
            1_700_000_000_000L
        )
        assertNull(startRes.errorCode)
        assertNotNull(startRes.session)

        val pool = Executors.newFixedThreadPool(4)
        try {
            val storeBarrier = CyclicBarrier(2)
            val writerA = pool.submit(
                Callable<Any?> {
                    storeBarrier.await(5, TimeUnit.SECONDS)
                    for (i in 0 until 40) {
                        storeA.appendPoint(LocationRecordingPolicy.RecordedPoint(
                            31.23 + i * 0.0001, 121.47, 10.0, 5.0, 1_700_000_001_000L + i * 1000L, 0))
                    }
                    null
                },
            )
            val writerB = pool.submit(
                Callable<Any?> {
                    storeBarrier.await(5, TimeUnit.SECONDS)
                    for (i in 0 until 40) {
                        storeB.appendPoint(LocationRecordingPolicy.RecordedPoint(
                            31.24 + i * 0.0001, 121.48, 12.0, 6.0, 1_700_000_100_000L + i * 1000L, 0))
                    }
                    null
                },
            )
            writerA.get(5, TimeUnit.SECONDS)
            writerB.get(5, TimeUnit.SECONDS)
            assertEquals(80, storeB.loadPoints(0).size)

            // 2. Last sample vs stop concurrency: every accepted point must appear in snapshot; post-freeze rejected
            for (iter in 0 until 15) {
                val sid = "sess-race-$iter"
                coordinator.discardSession()
                val sr = coordinator.startSession(
                    sid, "user-a", "22222222-2222-4222-8222-222222222222", "停表竞态", false, 1_700_000_000_000L)
                assertNull(sr.errorCode)

                // Seed initial point so session has valid trajectory
                coordinator.recordLocationPoint(LocationRecordingPolicy.RecordedPoint(
                    31.2300, 121.4700, 10.0, 5.0, 1_700_000_001_000L, 0))

                val raceBarrier = CyclicBarrier(2)
                val sampleFuture = pool.submit(
                    Callable {
                        raceBarrier.await(5, TimeUnit.SECONDS)
                        coordinator.recordLocationPoint(LocationRecordingPolicy.RecordedPoint(
                            31.2301, 121.4700, 10.0, 5.0, 1_700_000_005_000L, 0))
                    },
                )
                val stopFuture = pool.submit(
                    Callable {
                        raceBarrier.await(5, TimeUnit.SECONDS)
                        coordinator.finalizeAndFreeze(1_700_000_010_000L)
                    },
                )

                val sampleRes = sampleFuture.get(5, TimeUnit.SECONDS)
                val snap = stopFuture.get(5, TimeUnit.SECONDS)
                assertNotNull(snap)
                snap!!
                val expectedCount = if (sampleRes != null && sampleRes.accepted) 2 else 1
                assertEquals(expectedCount, snap.points.size)
                assertEquals(expectedCount, snap.session.pointCount)
                assertEquals(expectedCount, storeB.loadPoints(0).size)

                // Duplicate finalize yields identical snapshot with newlyFinalized = false; single handoff claim
                val dupCalls = ArrayList<Callable<LocationRecordingPolicy.FinalizedSnapshot?>>()
                val dupBarrier = CyclicBarrier(3)
                for (t in 0 until 3) {
                    dupCalls.add(
                        Callable {
                            dupBarrier.await(5, TimeUnit.SECONDS)
                            coordinator.finalizeAndFreeze(1_700_000_020_000L)
                        },
                    )
                }
                val dupFutures = pool.invokeAll(dupCalls)
                for (f in dupFutures) {
                    val d = f.get(5, TimeUnit.SECONDS)!!
                    assertFalse(d.newlyFinalized)
                    assertEquals(snap.points.size, d.points.size)
                    assertEquals(snap.session.endedAtMs, d.session.endedAtMs)
                }
                assertTrue(coordinator.claimHandoffEmission(sid))
                assertFalse(coordinator.claimHandoffEmission(sid))

                // Post-finalize late GPS samples are ignored
                assertNull(coordinator.recordLocationPoint(LocationRecordingPolicy.RecordedPoint(
                    31.2302, 121.4700, 10.0, 5.0, 1_700_000_015_000L, 0)))
            }
        } finally {
            pool.shutdownNow()
        }

        // 3. Ack ordering & crash during handoff:
        // Cannot ack while still recording
        coordinator.discardSession()
        coordinator.startSession(
            "sess-ack", "user-a", "33333333-3333-4333-8333-333333333333", "交接测试", false, 1_700_000_000_000L)
        coordinator.recordLocationPoint(LocationRecordingPolicy.RecordedPoint(
            31.2300, 121.4700, 10.0, 5.0, 1_700_000_001_000L, 0))
        assertFalse(coordinator.acknowledgeHandoff("sess-ack", "user-a", 1L))
        assertTrue(File(dir, "active_session.json").exists())

        // Finalize -> simulate crash before ack (new store/coordinator instance reads pending handoff)
        val beforeCrash = coordinator.finalizeAndFreeze(1_700_000_020_000L)
        assertNotNull(beforeCrash)
        assertTrue(beforeCrash!!.newlyFinalized)

        val recoveredStore = LocationRecordingPolicy.RecordingStore(dir)
        val recoveredCoordinator =
            LocationRecordingPolicy.RecordingSessionCoordinator(recoveredStore)
        val pending =
            recoveredCoordinator.loadReconciledSessionForAccount("user-a", false)
        assertNotNull(pending)
        assertEquals("stopped", pending!!.status)
        assertTrue(LocationRecordingPolicy.hasPendingHandoff(pending))
        assertEquals(1, recoveredCoordinator.loadPointsForAccount("user-a", 0).size)

        // Cannot overwrite unacknowledged stopped session with a new session
        val blockedStart = recoveredCoordinator.startSession(
            "sess-new", "user-a", "44444444-4444-4444-8444-444444444444", "新跑步", false, 1_700_000_030_000L)
        assertEquals("UNHANDLED_STOPPED_SESSION", blockedStart.errorCode)

        // Explicit ack deletes metadata & points; subsequent late destroy/sample/finalize never recreate files
        assertTrue(recoveredCoordinator.acknowledgeHandoff("sess-ack", "user-a", 1L))
        assertFalse(File(dir, "active_session.json").exists())
        assertFalse(File(dir, "points.ndjson").exists())

        assertNull(coordinator.markInterrupted("service_destroyed", 1_700_000_040_000L))
        assertNull(coordinator.recordLocationPoint(LocationRecordingPolicy.RecordedPoint(
            31.2303, 121.4700, 10.0, 5.0, 1_700_000_045_000L, 0)))
        assertNull(coordinator.finalizeAndFreeze(1_700_000_050_000L))
        assertNull(recoveredCoordinator.markInterrupted("service_destroyed", 1_700_000_055_000L))
        assertFalse(File(dir, "active_session.json").exists())
        assertFalse(File(dir, "points.ndjson").exists())
    }

    @Test
    fun rejectsStartingNewSessionWhileAnyExistingSessionIsUnsavedOrUndiscarded() {
        val dir = tmp.newFolder("p1_existing_session_guard")
        val store = LocationRecordingPolicy.RecordingStore(dir)
        val coordinator =
            LocationRecordingPolicy.RecordingSessionCoordinator(store)

        // 1. Existing active "recording" session with 1 point -> new start rejected & point preserved
        val oldStart = coordinator.startSession(
            "sess-old",
            "user-a",
            "11111111-1111-4111-8111-111111111111",
            "旧跑步记录",
            false,
            1_700_000_000_000L
        )
        assertNull(oldStart.errorCode)
        assertNotNull(coordinator.recordLocationPoint(LocationRecordingPolicy.RecordedPoint(
            31.2300, 121.4700, 10.0, 5.0, 1_700_000_001_000L, 0)))

        val recBlocked = coordinator.startSession(
            "sess-new",
            "user-a",
            "22222222-2222-4222-8222-222222222222",
            "覆盖尝试",
            false,
            1_700_000_010_000L
        )
        assertEquals("EXISTING_SESSION_ACTIVE", recBlocked.errorCode)
        assertNotNull(recBlocked.session)
        assertEquals("sess-old", recBlocked.session!!.sessionId)
        assertEquals("sess-old", coordinator.currentSession()!!.sessionId)
        assertEquals(1, store.loadPoints(0).size)

        // Cross-account start must also reject without returning or clearing user-a's session
        val otherAcctBlocked = coordinator.startSession(
            "sess-other",
            "user-b",
            "33333333-3333-4333-8333-333333333333",
            "跨账号尝试",
            false,
            1_700_000_015_000L
        )
        assertEquals("ACCOUNT_MISMATCH", otherAcctBlocked.errorCode)
        assertNull(otherAcctBlocked.session)
        assertEquals("sess-old", store.loadSession()!!.sessionId)
        assertEquals(1, store.loadPoints(0).size)

        // 2. Existing "paused" session -> rejected & point preserved
        assertNotNull(coordinator.pauseSession(1_700_000_020_000L))
        val pausedBlocked = coordinator.startSession(
            "sess-new-2",
            "user-a",
            "44444444-4444-4444-8444-444444444444",
            "暂停期间新起会话",
            false,
            1_700_000_025_000L
        )
        assertEquals("EXISTING_SESSION_ACTIVE", pausedBlocked.errorCode)
        assertEquals("paused", pausedBlocked.session!!.status)
        assertEquals("sess-old", store.loadSession()!!.sessionId)
        assertEquals(1, store.loadPoints(0).size)

        // 3. Existing "interrupted" session (same coordinator + fresh coordinator simulating process restart) -> rejected
        assertNotNull(coordinator.markInterrupted("process_terminated", 1_700_000_030_000L))
        val interruptedBlocked = coordinator.startSession(
            "sess-new-3",
            "user-a",
            "55555555-5555-4555-8555-555555555555",
            "中断期间新起会话",
            false,
            1_700_000_035_000L
        )
        assertEquals("EXISTING_SESSION_ACTIVE", interruptedBlocked.errorCode)
        assertEquals("interrupted", interruptedBlocked.session!!.status)
        assertEquals(1, store.loadPoints(0).size)

        val restartedCoordinator =
            LocationRecordingPolicy.RecordingSessionCoordinator(LocationRecordingPolicy.RecordingStore(dir))
        val conflictCheck =
            restartedCoordinator.checkStartConflict("user-a", false)
        assertNotNull(conflictCheck)
        assertEquals("EXISTING_SESSION_ACTIVE", conflictCheck!!.errorCode)
        val coldStartBlocked = restartedCoordinator.startSession(
            "sess-new-4",
            "user-a",
            "66666666-6666-4666-8666-666666666666",
            "重启冷启动新会话",
            false,
            1_700_000_040_000L
        )
        assertEquals("EXISTING_SESSION_ACTIVE", coldStartBlocked.errorCode)
        assertEquals("sess-old", coldStartBlocked.session!!.sessionId)
        assertEquals(1, restartedCoordinator.loadPointsForAccount("user-a", 0).size)

        // 4. Only after explicit discardSession() does starting a new session succeed
        restartedCoordinator.discardSession()
        assertNull(restartedCoordinator.checkStartConflict("user-a", false))
        val allowedAfterDiscard = restartedCoordinator.startSession(
            "sess-fresh",
            "user-a",
            "77777777-7777-4777-8777-777777777777",
            "显式丢弃后新会话",
            false,
            1_700_000_050_000L
        )
        assertNull(allowedAfterDiscard.errorCode)
        assertNotNull(allowedAfterDiscard.session)
        assertEquals("sess-fresh", allowedAfterDiscard.session!!.sessionId)
    }

    @Test
    fun concurrentAndRepeatedStartSessionCallsCreateAtMostOneSessionWithoutOverwritingPoints() {
        val dir = tmp.newFolder("p1_concurrent_start")
        val store = LocationRecordingPolicy.RecordingStore(dir)
        val coordinator =
            LocationRecordingPolicy.RecordingSessionCoordinator(store)

        val threads = 8
        val pool = Executors.newFixedThreadPool(threads)
        try {
            val barrier = CyclicBarrier(threads)
            val tasks = ArrayList<Callable<LocationRecordingPolicy.StartResult>>()
            for (idx in 0 until threads) {
                tasks.add(
                    Callable {
                        barrier.await(5, TimeUnit.SECONDS)
                        coordinator.startSession(
                            "sess-race-$idx",
                            "user-a",
                            "aaaaaaaa-0000-4000-8000-00000000000$idx",
                            "并发启动-$idx",
                            false,
                            1_700_000_000_000L + idx,
                        )
                    },
                )
            }
            val results = pool.invokeAll(tasks)
            var winnerId: String? = null
            var successCount = 0
            var rejectedCount = 0
            for (f in results) {
                val res = f.get(5, TimeUnit.SECONDS)
                if (res.errorCode == null) {
                    successCount++
                    winnerId = res.session!!.sessionId
                } else {
                    assertEquals("EXISTING_SESSION_ACTIVE", res.errorCode)
                    rejectedCount++
                }
            }
            assertEquals(1, successCount)
            assertEquals(threads - 1, rejectedCount)
            assertNotNull(winnerId)
            assertEquals(winnerId, coordinator.currentSession()!!.sessionId)
            assertEquals(winnerId, store.loadSession()!!.sessionId)

            // Append 2 points to the winning session, then verify repeated/concurrent starts cannot overwrite them
            assertNotNull(coordinator.recordLocationPoint(LocationRecordingPolicy.RecordedPoint(
                31.2300, 121.4700, 10.0, 5.0, 1_700_000_001_000L, 0)))
            assertNotNull(coordinator.recordLocationPoint(LocationRecordingPolicy.RecordedPoint(
                31.2301, 121.4700, 10.0, 5.0, 1_700_000_005_000L, 0)))

            val repeatBarrier = CyclicBarrier(threads)
            val repeatTasks = ArrayList<Callable<LocationRecordingPolicy.StartResult>>()
            for (idx in 0 until threads) {
                repeatTasks.add(
                    Callable {
                        repeatBarrier.await(5, TimeUnit.SECONDS)
                        coordinator.startSession(
                            "sess-repeat-$idx",
                            "user-a",
                            "bbbbbbbb-0000-4000-8000-00000000000$idx",
                            "重复启动-$idx",
                            false,
                            1_700_000_020_000L + idx,
                        )
                    },
                )
            }
            for (f in pool.invokeAll(repeatTasks)) {
                val res = f.get(5, TimeUnit.SECONDS)
                assertEquals("EXISTING_SESSION_ACTIVE", res.errorCode)
                assertNotNull(res.session)
                assertEquals(winnerId, res.session!!.sessionId)
            }
            assertEquals(winnerId, coordinator.currentSession()!!.sessionId)
            assertEquals(2, store.loadPoints(0).size)
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun round13AcknowledgeHandoffRejectsStaleForeignAndRevokedClaimsWhilePreservingSession() {
        val dir = tmp.newFolder("r13_ack_claim_fence")
        val store = LocationRecordingPolicy.RecordingStore(dir)
        val coordinator =
            LocationRecordingPolicy.RecordingSessionCoordinator(store)

        assertTrue(coordinator.syncAccountClaim("user-a", 1L, "tok-a-1"))
        val started = coordinator.startSession(
            "sess-r13-ack",
            "user-a",
            "11111111-1313-4111-8111-111111111111",
            "交接校验测试",
            false,
            1_700_000_000_000L,
            1L,
            "tok-a-1"
        )
        assertNull(started.errorCode)
        assertNotNull(coordinator.recordLocationPoint(LocationRecordingPolicy.RecordedPoint(
            31.2300, 121.4700, 10.0, 5.0, 1_700_000_001_000L, 0)))
        val stopped = coordinator.finalizeAndFreezeForOwner(
            "user-a", "sess-r13-ack", 1L, "tok-a-1", 1_700_000_020_000L, null)
        assertNull(stopped.errorCode)
        assertNotNull(stopped.snapshot)

        // Foreign account, wrong session, wrong token, or zero revision must be rejected.
        assertFalse(coordinator.acknowledgeHandoff("sess-r13-ack", "user-b", 1L, "tok-a-1"))
        assertFalse(coordinator.acknowledgeHandoff("sess-other", "user-a", 1L, "tok-a-1"))
        assertFalse(coordinator.acknowledgeHandoff("sess-r13-ack", "user-a", 1L, "tok-wrong"))
        assertFalse(coordinator.acknowledgeHandoff("sess-r13-ack", "user-a", 0L, "tok-a-1"))
        assertNotNull(store.loadSession())

        // Cleanup revokes claim 1: stale ack with (user-a, 1, tok-a-1) must be rejected and preserve session.
        assertTrue(coordinator.revokeAccountClaim("user-a", 1L))
        assertFalse(coordinator.acknowledgeHandoff("sess-r13-ack", "user-a", 1L, "tok-a-1"))
        assertNotNull(store.loadSession())
        assertEquals(1, store.loadPoints(0).size)

        // Same-account re-login establishes generation 2: old generation 1 still rejected, generation 2 succeeds.
        assertTrue(coordinator.syncAccountClaim("user-a", 2L, "tok-a-2"))
        assertFalse(coordinator.acknowledgeHandoff("sess-r13-ack", "user-a", 1L, "tok-a-1"))
        assertFalse(coordinator.acknowledgeHandoff("sess-r13-ack", "user-a", 2L, "tok-a-1"))
        assertNotNull(store.loadSession())

        // New coordinator instance reading claim_fence.json from disk enforces the same fence.
        val reloaded =
            LocationRecordingPolicy.RecordingSessionCoordinator(LocationRecordingPolicy.RecordingStore(dir))
        assertFalse(reloaded.acknowledgeHandoff("sess-r13-ack", "user-a", 1L, "tok-a-1"))
        assertTrue(reloaded.acknowledgeHandoff("sess-r13-ack", "user-a", 2L, "tok-a-2"))
        assertNull(store.loadSession())
        assertTrue(store.loadPoints(0).isEmpty())
    }

    @Test
    fun round13FinalizeForOwnerRejectsForeignAccountWrongSessionAndStaleClaimWithoutFreezing() {
        val dir = tmp.newFolder("r13_stop_owner_guard")
        val store = LocationRecordingPolicy.RecordingStore(dir)
        val coordinator =
            LocationRecordingPolicy.RecordingSessionCoordinator(store)

        assertTrue(coordinator.syncAccountClaim("user-b", 2L, "tok-b-2"))
        val started = coordinator.startSession(
            "sess-b-live",
            "user-b",
            "22222222-1313-4222-8222-222222222222",
            "账号B跑步",
            false,
            1_700_000_000_000L,
            2L,
            "tok-b-2"
        )
        assertNull(started.errorCode)
        assertNotNull(coordinator.recordLocationPoint(LocationRecordingPolicy.RecordedPoint(
            31.2300, 121.4700, 10.0, 5.0, 1_700_000_001_000L, 0)))

        var freezeCount = 0
        val onFreeze = Runnable { freezeCount++ }

        // Stale account A attempting stop must be rejected without freezing or leaking B's session.
        val foreignStop = coordinator.finalizeAndFreezeForOwner(
            "user-a", "sess-a-old", 1L, "tok-a-1", 1_700_000_010_000L, onFreeze)
        assertEquals("ACCOUNT_MISMATCH", foreignStop.errorCode)
        assertNull(foreignStop.snapshot)
        assertEquals(0, freezeCount)

        // Even guessing B's sessionId with A's accountId is rejected.
        val foreignSameSess = coordinator.finalizeAndFreezeForOwner(
            "user-a", "sess-b-live", 2L, "tok-b-2", 1_700_000_011_000L, onFreeze)
        assertEquals("ACCOUNT_MISMATCH", foreignSameSess.errorCode)
        assertNull(foreignSameSess.snapshot)
        assertEquals(0, freezeCount)

        // Wrong sessionId or stale claim for B is also rejected without freezing.
        val wrongSession = coordinator.finalizeAndFreezeForOwner(
            "user-b", "sess-b-other", 2L, "tok-b-2", 1_700_000_012_000L, onFreeze)
        assertEquals("SESSION_MISMATCH", wrongSession.errorCode)
        assertEquals(0, freezeCount)

        val staleClaim = coordinator.finalizeAndFreezeForOwner(
            "user-b", "sess-b-live", 1L, "tok-b-1", 1_700_000_013_000L, onFreeze)
        assertEquals("STALE_CLAIM", staleClaim.errorCode)
        assertEquals(0, freezeCount)

        // Account B's session is still recording and accepts new GPS fixes!
        assertEquals("recording", coordinator.currentSession()!!.status)
        assertNotNull(coordinator.recordLocationPoint(LocationRecordingPolicy.RecordedPoint(
            31.2301, 121.4700, 10.5, 5.0, 1_700_000_015_000L, 0)))
        assertEquals(2, store.loadPoints(0).size)

        // Matching owner (user-b, sess-b-live, 2, tok-b-2) freezes and stops cleanly.
        val validStop = coordinator.finalizeAndFreezeForOwner(
            "user-b", "sess-b-live", 2L, "tok-b-2", 1_700_000_020_000L, onFreeze)
        assertNull(validStop.errorCode)
        assertNotNull(validStop.snapshot)
        assertEquals(1, freezeCount)
        assertEquals("stopped", validStop.snapshot!!.session.status)
        assertEquals(2, validStop.snapshot!!.points.size)
    }
}
