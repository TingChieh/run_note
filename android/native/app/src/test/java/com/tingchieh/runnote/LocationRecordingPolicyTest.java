package com.tingchieh.runnote;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.pm.ServiceInfo;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class LocationRecordingPolicyTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    @Test
    public void manifestDeclaresMinimalForegroundLocationPermissionsAndNoBackgroundLocation() throws Exception {
        File manifest = new File("src/main/AndroidManifest.xml");
        assertTrue("Manifest file must exist", manifest.exists());
        String xml = new String(Files.readAllBytes(manifest.toPath()), StandardCharsets.UTF_8);

        for (String required : LocationRecordingPolicy.REQUIRED_MANIFEST_PERMISSIONS) {
            assertTrue("Missing required recording permission: " + required, xml.contains(required));
        }
        for (String forbidden : LocationRecordingPolicy.FORBIDDEN_LOCATION_PERMISSIONS) {
            assertFalse("Forbidden background location permission declared: " + forbidden, xml.contains(forbidden));
        }
        assertTrue("RecordingForegroundService must be declared", xml.contains("RecordingForegroundService"));
        assertTrue("Service must declare foregroundServiceType=location", xml.contains("android:foregroundServiceType=\"location\""));
        assertTrue("Service must not be exported", xml.contains("android:exported=\"false\""));
    }

    @Test
    public void evaluatesPermissionsAcrossAndroidVersionsAndOneTimeApproximateGrants() {
        // Android 10 (API 29): notification permission not required
        LocationRecordingPolicy.PermissionEvaluation api29 =
            LocationRecordingPolicy.evaluatePermissions(true, true, 29, false, true);
        assertEquals("granted", api29.locationStatus);
        assertEquals("not_required", api29.notificationStatus);
        assertTrue(api29.preciseLocation);
        assertTrue(api29.canRecord);

        // Android 13+ (API 33): notification denied does not crash recording, but reports denied
        LocationRecordingPolicy.PermissionEvaluation api33NoNotif =
            LocationRecordingPolicy.evaluatePermissions(true, true, 33, false, true);
        assertEquals("granted", api33NoNotif.locationStatus);
        assertEquals("denied", api33NoNotif.notificationStatus);
        assertTrue(api33NoNotif.canRecord);

        // Android 12+ approximate-only grant cannot record accurate running tracks
        LocationRecordingPolicy.PermissionEvaluation approx =
            LocationRecordingPolicy.evaluatePermissions(false, true, 34, true, true);
        assertEquals("approximate", approx.locationStatus);
        assertFalse(approx.preciseLocation);
        assertFalse(approx.canRecord);

        // Denied or location services disabled cannot record
        LocationRecordingPolicy.PermissionEvaluation denied =
            LocationRecordingPolicy.evaluatePermissions(false, false, 34, true, true);
        assertEquals("denied", denied.locationStatus);
        assertFalse(denied.canRecord);

        LocationRecordingPolicy.PermissionEvaluation locOff =
            LocationRecordingPolicy.evaluatePermissions(true, true, 34, true, false);
        assertFalse(locOff.canRecord);

        // Requested permission array matches API level
        List<String> req29 = Arrays.asList(LocationRecordingPolicy.permissionsToRequest(29));
        assertFalse(req29.contains("android.permission.POST_NOTIFICATIONS"));
        List<String> req33 = Arrays.asList(LocationRecordingPolicy.permissionsToRequest(33));
        assertTrue(req33.contains("android.permission.POST_NOTIFICATIONS"));
        assertFalse(req33.contains("android.permission.ACCESS_BACKGROUND_LOCATION"));

        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            LocationRecordingPolicy.foregroundServiceTypeForApi(29)
        );
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            LocationRecordingPolicy.foregroundServiceTypeForApi(36)
        );
    }

    @Test
    public void classifiesGpsSignalQualityAndFiltersBadFixes() {
        assertEquals("permission_denied", LocationRecordingPolicy.classifyGpsSignal("recording", true, false, 5.0, 0L));
        assertEquals("disabled", LocationRecordingPolicy.classifyGpsSignal("recording", false, true, 5.0, 0L));
        assertEquals("acquiring", LocationRecordingPolicy.classifyGpsSignal("recording", true, true, null, null));
        assertEquals("good", LocationRecordingPolicy.classifyGpsSignal("recording", true, true, 8.5, 1_000L));
        assertEquals("weak", LocationRecordingPolicy.classifyGpsSignal("recording", true, true, 32.0, 2_000L));
        assertEquals("lost", LocationRecordingPolicy.classifyGpsSignal("recording", true, true, 8.0, 20_000L));
        assertEquals("inactive", LocationRecordingPolicy.classifyGpsSignal("paused", true, true, 8.0, 1_000L));

        LocationRecordingPolicy.RecordedPoint p1 =
            new LocationRecordingPolicy.RecordedPoint(31.2300, 121.4700, 12.0, 6.0, 1_700_000_000_000L, 0);
        LocationRecordingPolicy.PointDecision d1 = LocationRecordingPolicy.evaluatePoint(p1, null, 0);
        assertTrue(d1.accepted);
        assertEquals(0.0, d1.distanceDeltaM, 0.001);

        // Poor accuracy rejected (> 50m)
        LocationRecordingPolicy.RecordedPoint poor =
            new LocationRecordingPolicy.RecordedPoint(31.2301, 121.4701, 12.0, 85.0, 1_700_000_005_000L, 0);
        assertFalse(LocationRecordingPolicy.evaluatePoint(poor, p1, 1).accepted);

        // Normal running step (~11m in 4s = 2.75 m/s) accepted
        LocationRecordingPolicy.RecordedPoint p2 =
            new LocationRecordingPolicy.RecordedPoint(31.2301, 121.4700, 12.5, 7.0, 1_700_000_004_000L, 0);
        LocationRecordingPolicy.PointDecision d2 = LocationRecordingPolicy.evaluatePoint(p2, p1, 1);
        assertTrue(d2.accepted);
        assertTrue(d2.distanceDeltaM > 10.0 && d2.distanceDeltaM < 13.0);

        // Unrealistic teleport jump (> 12 m/s) within same segment rejected
        LocationRecordingPolicy.RecordedPoint jump =
            new LocationRecordingPolicy.RecordedPoint(31.2400, 121.4700, 12.0, 5.0, 1_700_000_005_000L, 0);
        LocationRecordingPolicy.PointDecision dJump = LocationRecordingPolicy.evaluatePoint(jump, p2, 2);
        assertFalse(dJump.accepted);
        assertEquals("speed_jump", dJump.reason);

        // New segment after pause accepts location without connecting pause gap distance
        LocationRecordingPolicy.RecordedPoint resumed =
            new LocationRecordingPolicy.RecordedPoint(31.2400, 121.4700, 12.0, 5.0, 1_700_000_600_000L, 1);
        LocationRecordingPolicy.PointDecision dResumed = LocationRecordingPolicy.evaluatePoint(resumed, p2, 2);
        assertTrue(dResumed.accepted);
        assertEquals(0.0, dResumed.distanceDeltaM, 0.001);
    }

    @Test
    public void persistsRecoversAfterCrashSkipsCorruptTrailingLineAndIsolatesAccounts() throws Exception {
        File dir = tmp.newFolder("recordings");
        LocationRecordingPolicy.RecordingStore store = new LocationRecordingPolicy.RecordingStore(dir);

        LocationRecordingPolicy.SessionRecord session = new LocationRecordingPolicy.SessionRecord(
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
        );
        store.saveSession(session);
        store.appendPoint(new LocationRecordingPolicy.RecordedPoint(31.2300, 121.4700, 10.0, 6.0, 1_700_000_000_000L, 0));
        store.appendPoint(new LocationRecordingPolicy.RecordedPoint(31.2302, 121.4700, 10.5, 6.5, 1_700_000_020_000L, 0));

        // Simulate abrupt power loss writing a truncated trailing NDJSON line
        File pointsFile = new File(dir, "points.ndjson");
        Files.write(
            pointsFile.toPath(),
            "{\"lat\":31.23,\"lon\":".getBytes(StandardCharsets.UTF_8),
            java.nio.file.StandardOpenOption.APPEND
        );

        LocationRecordingPolicy.SessionRecord loaded = store.loadSession();
        assertNotNull(loaded);
        assertEquals(2, loaded.pointCount);
        assertEquals(2, store.loadPoints(0).size());

        // Truncated tail was repaired on load, so appending a new point decodes cleanly on a fresh line
        store.appendPoint(new LocationRecordingPolicy.RecordedPoint(31.2304, 121.4700, 11.0, 6.0, 1_700_000_040_000L, 0));
        assertEquals(3, store.loadPoints(0).size());

        // Account-scoped reads isolate other accounts without leaking metadata or points
        assertNotNull(store.loadSessionForAccount("user-a"));
        assertEquals(3, store.loadPointsForAccount("user-a", 0).size());
        assertNull(store.loadSessionForAccount("user-b"));
        assertTrue(store.loadPointsForAccount("user-b", 0).isEmpty());

        // After process death (serviceRunning = false), recording reconciles to interrupted with frozen duration
        LocationRecordingPolicy.SessionRecord reconciled =
            LocationRecordingPolicy.reconcileAfterRestart(loaded, false);
        assertNotNull(reconciled);
        assertEquals("interrupted", reconciled.status);
        assertEquals("process_terminated", reconciled.interruptedReason);
        assertEquals(20_000L, reconciled.activeDurationMs);
        assertNull(reconciled.lastSegmentStartMs);

        // Stopped session with points survives restart as pending handoff until explicitly acknowledged
        LocationRecordingPolicy.SessionRecord stopped = new LocationRecordingPolicy.SessionRecord(
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
        );
        store.saveSession(stopped);
        LocationRecordingPolicy.SessionRecord reloadedStopped =
            LocationRecordingPolicy.reconcileAfterRestart(store.loadSession(), false);
        assertNotNull(reloadedStopped);
        assertEquals("stopped", reloadedStopped.status);
        assertTrue(LocationRecordingPolicy.hasPendingHandoff(reloadedStopped));

        // Wrong sessionId does NOT clear pending handoff; matching sessionId acknowledges and clears
        assertFalse(store.acknowledgeHandoff("wrong-session"));
        assertNotNull(store.loadSession());
        assertTrue(store.acknowledgeHandoff("sess-stopped"));
        assertNull(store.loadSession());
        assertTrue(store.loadPoints(0).isEmpty());

        // Re-save and verify account switch cleanup
        store.saveSession(session);
        assertFalse(store.clearIfAccountMismatch("user-a"));
        assertNotNull(store.loadSession());
        assertTrue(store.clearIfAccountMismatch("user-b"));
        assertNull(store.loadSession());
        assertTrue(store.loadPoints(0).isEmpty());
    }

    @Test
    public void enforcesCrossInstanceLockSingleFinalizerAckOrderingAndCrashRecovery() throws Exception {
        File dir = tmp.newFolder("concurrent_recordings");
        LocationRecordingPolicy.RecordingStore storeA = new LocationRecordingPolicy.RecordingStore(dir);
        LocationRecordingPolicy.RecordingStore storeB = new LocationRecordingPolicy.RecordingStore(dir);
        LocationRecordingPolicy.RecordingSessionCoordinator coordinator =
            new LocationRecordingPolicy.RecordingSessionCoordinator(storeA);

        // 1. Cross-instance lock keeps concurrent writes from storeA and storeB consistent
        LocationRecordingPolicy.StartResult startRes = coordinator.startSession(
            "sess-lock",
            "user-a",
            "11111111-1111-4111-8111-111111111111",
            "并发锁测试",
            false,
            1_700_000_000_000L
        );
        assertNull(startRes.errorCode);
        assertNotNull(startRes.session);

        ExecutorService pool = Executors.newFixedThreadPool(4);
        try {
            CyclicBarrier storeBarrier = new CyclicBarrier(2);
            Future<?> writerA = pool.submit(() -> {
                storeBarrier.await(5, TimeUnit.SECONDS);
                for (int i = 0; i < 40; i++) {
                    storeA.appendPoint(new LocationRecordingPolicy.RecordedPoint(
                        31.23 + i * 0.0001, 121.47, 10.0, 5.0, 1_700_000_001_000L + i * 1000L, 0));
                }
                return null;
            });
            Future<?> writerB = pool.submit(() -> {
                storeBarrier.await(5, TimeUnit.SECONDS);
                for (int i = 0; i < 40; i++) {
                    storeB.appendPoint(new LocationRecordingPolicy.RecordedPoint(
                        31.24 + i * 0.0001, 121.48, 12.0, 6.0, 1_700_000_100_000L + i * 1000L, 0));
                }
                return null;
            });
            writerA.get(5, TimeUnit.SECONDS);
            writerB.get(5, TimeUnit.SECONDS);
            assertEquals(80, storeB.loadPoints(0).size());

            // 2. Last sample vs stop concurrency: every accepted point must appear in snapshot; post-freeze rejected
            for (int iter = 0; iter < 15; iter++) {
                String sid = "sess-race-" + iter;
                coordinator.discardSession();
                LocationRecordingPolicy.StartResult sr = coordinator.startSession(
                    sid, "user-a", "22222222-2222-4222-8222-222222222222", "停表竞态", false, 1_700_000_000_000L);
                assertNull(sr.errorCode);

                // Seed initial point so session has valid trajectory
                coordinator.recordLocationPoint(new LocationRecordingPolicy.RecordedPoint(
                    31.2300, 121.4700, 10.0, 5.0, 1_700_000_001_000L, 0));

                CyclicBarrier raceBarrier = new CyclicBarrier(2);
                Future<LocationRecordingPolicy.PointRecordResult> sampleFuture = pool.submit(() -> {
                    raceBarrier.await(5, TimeUnit.SECONDS);
                    return coordinator.recordLocationPoint(new LocationRecordingPolicy.RecordedPoint(
                        31.2301, 121.4700, 10.0, 5.0, 1_700_000_005_000L, 0));
                });
                Future<LocationRecordingPolicy.FinalizedSnapshot> stopFuture = pool.submit(() -> {
                    raceBarrier.await(5, TimeUnit.SECONDS);
                    return coordinator.finalizeAndFreeze(1_700_000_010_000L);
                });

                LocationRecordingPolicy.PointRecordResult sampleRes = sampleFuture.get(5, TimeUnit.SECONDS);
                LocationRecordingPolicy.FinalizedSnapshot snap = stopFuture.get(5, TimeUnit.SECONDS);
                assertNotNull(snap);
                int expectedCount = (sampleRes != null && sampleRes.accepted) ? 2 : 1;
                assertEquals(expectedCount, snap.points.size());
                assertEquals(expectedCount, snap.session.pointCount);
                assertEquals(expectedCount, storeB.loadPoints(0).size());

                // Duplicate finalize yields identical snapshot with newlyFinalized = false; single handoff claim
                List<Callable<LocationRecordingPolicy.FinalizedSnapshot>> dupCalls = new ArrayList<>();
                CyclicBarrier dupBarrier = new CyclicBarrier(3);
                for (int t = 0; t < 3; t++) {
                    dupCalls.add(() -> {
                        dupBarrier.await(5, TimeUnit.SECONDS);
                        return coordinator.finalizeAndFreeze(1_700_000_020_000L);
                    });
                }
                List<Future<LocationRecordingPolicy.FinalizedSnapshot>> dupFutures = pool.invokeAll(dupCalls);
                for (Future<LocationRecordingPolicy.FinalizedSnapshot> f : dupFutures) {
                    LocationRecordingPolicy.FinalizedSnapshot d = f.get(5, TimeUnit.SECONDS);
                    assertFalse(d.newlyFinalized);
                    assertEquals(snap.points.size(), d.points.size());
                    assertEquals(snap.session.endedAtMs, d.session.endedAtMs);
                }
                assertTrue(coordinator.claimHandoffEmission(sid));
                assertFalse(coordinator.claimHandoffEmission(sid));

                // Post-finalize late GPS samples are ignored
                assertNull(coordinator.recordLocationPoint(new LocationRecordingPolicy.RecordedPoint(
                    31.2302, 121.4700, 10.0, 5.0, 1_700_000_015_000L, 0)));
            }
        } finally {
            pool.shutdownNow();
        }

        // 3. Ack ordering & crash during handoff:
        // Cannot ack while still recording
        coordinator.discardSession();
        coordinator.startSession(
            "sess-ack", "user-a", "33333333-3333-4333-8333-333333333333", "交接测试", false, 1_700_000_000_000L);
        coordinator.recordLocationPoint(new LocationRecordingPolicy.RecordedPoint(
            31.2300, 121.4700, 10.0, 5.0, 1_700_000_001_000L, 0));
        assertFalse(coordinator.acknowledgeHandoff("sess-ack"));
        assertTrue(new File(dir, "active_session.json").exists());

        // Finalize -> simulate crash before ack (new store/coordinator instance reads pending handoff)
        LocationRecordingPolicy.FinalizedSnapshot beforeCrash = coordinator.finalizeAndFreeze(1_700_000_020_000L);
        assertNotNull(beforeCrash);
        assertTrue(beforeCrash.newlyFinalized);

        LocationRecordingPolicy.RecordingStore recoveredStore = new LocationRecordingPolicy.RecordingStore(dir);
        LocationRecordingPolicy.RecordingSessionCoordinator recoveredCoordinator =
            new LocationRecordingPolicy.RecordingSessionCoordinator(recoveredStore);
        LocationRecordingPolicy.SessionRecord pending =
            recoveredCoordinator.loadReconciledSessionForAccount("user-a", false);
        assertNotNull(pending);
        assertEquals("stopped", pending.status);
        assertTrue(LocationRecordingPolicy.hasPendingHandoff(pending));
        assertEquals(1, recoveredCoordinator.loadPointsForAccount("user-a", 0).size());

        // Cannot overwrite unacknowledged stopped session with a new session
        LocationRecordingPolicy.StartResult blockedStart = recoveredCoordinator.startSession(
            "sess-new", "user-a", "44444444-4444-4444-8444-444444444444", "新跑步", false, 1_700_000_030_000L);
        assertEquals("UNHANDLED_STOPPED_SESSION", blockedStart.errorCode);

        // Explicit ack deletes metadata & points; subsequent late destroy/sample/finalize never recreate files
        assertTrue(recoveredCoordinator.acknowledgeHandoff("sess-ack"));
        assertFalse(new File(dir, "active_session.json").exists());
        assertFalse(new File(dir, "points.ndjson").exists());

        assertNull(coordinator.markInterrupted("service_destroyed", 1_700_000_040_000L));
        assertNull(coordinator.recordLocationPoint(new LocationRecordingPolicy.RecordedPoint(
            31.2303, 121.4700, 10.0, 5.0, 1_700_000_045_000L, 0)));
        assertNull(coordinator.finalizeAndFreeze(1_700_000_050_000L));
        assertNull(recoveredCoordinator.markInterrupted("service_destroyed", 1_700_000_055_000L));
        assertFalse(new File(dir, "active_session.json").exists());
        assertFalse(new File(dir, "points.ndjson").exists());
    }

    @Test
    public void rejectsStartingNewSessionWhileAnyExistingSessionIsUnsavedOrUndiscarded() throws Exception {
        File dir = tmp.newFolder("p1_existing_session_guard");
        LocationRecordingPolicy.RecordingStore store = new LocationRecordingPolicy.RecordingStore(dir);
        LocationRecordingPolicy.RecordingSessionCoordinator coordinator =
            new LocationRecordingPolicy.RecordingSessionCoordinator(store);

        // 1. Existing active "recording" session with 1 point -> new start rejected & point preserved
        LocationRecordingPolicy.StartResult oldStart = coordinator.startSession(
            "sess-old",
            "user-a",
            "11111111-1111-4111-8111-111111111111",
            "旧跑步记录",
            false,
            1_700_000_000_000L
        );
        assertNull(oldStart.errorCode);
        assertNotNull(coordinator.recordLocationPoint(new LocationRecordingPolicy.RecordedPoint(
            31.2300, 121.4700, 10.0, 5.0, 1_700_000_001_000L, 0)));

        LocationRecordingPolicy.StartResult recBlocked = coordinator.startSession(
            "sess-new",
            "user-a",
            "22222222-2222-4222-8222-222222222222",
            "覆盖尝试",
            false,
            1_700_000_010_000L
        );
        assertEquals("EXISTING_SESSION_ACTIVE", recBlocked.errorCode);
        assertNotNull(recBlocked.session);
        assertEquals("sess-old", recBlocked.session.sessionId);
        assertEquals("sess-old", coordinator.currentSession().sessionId);
        assertEquals(1, store.loadPoints(0).size());

        // Cross-account start must also reject without returning or clearing user-a's session
        LocationRecordingPolicy.StartResult otherAcctBlocked = coordinator.startSession(
            "sess-other",
            "user-b",
            "33333333-3333-4333-8333-333333333333",
            "跨账号尝试",
            false,
            1_700_000_015_000L
        );
        assertEquals("ACCOUNT_MISMATCH", otherAcctBlocked.errorCode);
        assertNull(otherAcctBlocked.session);
        assertEquals("sess-old", store.loadSession().sessionId);
        assertEquals(1, store.loadPoints(0).size());

        // 2. Existing "paused" session -> rejected & point preserved
        assertNotNull(coordinator.pauseSession(1_700_000_020_000L));
        LocationRecordingPolicy.StartResult pausedBlocked = coordinator.startSession(
            "sess-new-2",
            "user-a",
            "44444444-4444-4444-8444-444444444444",
            "暂停期间新起会话",
            false,
            1_700_000_025_000L
        );
        assertEquals("EXISTING_SESSION_ACTIVE", pausedBlocked.errorCode);
        assertEquals("paused", pausedBlocked.session.status);
        assertEquals("sess-old", store.loadSession().sessionId);
        assertEquals(1, store.loadPoints(0).size());

        // 3. Existing "interrupted" session (same coordinator + fresh coordinator simulating process restart) -> rejected
        assertNotNull(coordinator.markInterrupted("process_terminated", 1_700_000_030_000L));
        LocationRecordingPolicy.StartResult interruptedBlocked = coordinator.startSession(
            "sess-new-3",
            "user-a",
            "55555555-5555-4555-8555-555555555555",
            "中断期间新起会话",
            false,
            1_700_000_035_000L
        );
        assertEquals("EXISTING_SESSION_ACTIVE", interruptedBlocked.errorCode);
        assertEquals("interrupted", interruptedBlocked.session.status);
        assertEquals(1, store.loadPoints(0).size());

        LocationRecordingPolicy.RecordingSessionCoordinator restartedCoordinator =
            new LocationRecordingPolicy.RecordingSessionCoordinator(new LocationRecordingPolicy.RecordingStore(dir));
        LocationRecordingPolicy.StartResult conflictCheck =
            restartedCoordinator.checkStartConflict("user-a", false);
        assertNotNull(conflictCheck);
        assertEquals("EXISTING_SESSION_ACTIVE", conflictCheck.errorCode);
        LocationRecordingPolicy.StartResult coldStartBlocked = restartedCoordinator.startSession(
            "sess-new-4",
            "user-a",
            "66666666-6666-4666-8666-666666666666",
            "重启冷启动新会话",
            false,
            1_700_000_040_000L
        );
        assertEquals("EXISTING_SESSION_ACTIVE", coldStartBlocked.errorCode);
        assertEquals("sess-old", coldStartBlocked.session.sessionId);
        assertEquals(1, restartedCoordinator.loadPointsForAccount("user-a", 0).size());

        // 4. Only after explicit discardSession() does starting a new session succeed
        restartedCoordinator.discardSession();
        assertNull(restartedCoordinator.checkStartConflict("user-a", false));
        LocationRecordingPolicy.StartResult allowedAfterDiscard = restartedCoordinator.startSession(
            "sess-fresh",
            "user-a",
            "77777777-7777-4777-8777-777777777777",
            "显式丢弃后新会话",
            false,
            1_700_000_050_000L
        );
        assertNull(allowedAfterDiscard.errorCode);
        assertNotNull(allowedAfterDiscard.session);
        assertEquals("sess-fresh", allowedAfterDiscard.session.sessionId);
    }

    @Test
    public void concurrentAndRepeatedStartSessionCallsCreateAtMostOneSessionWithoutOverwritingPoints()
        throws Exception {
        File dir = tmp.newFolder("p1_concurrent_start");
        LocationRecordingPolicy.RecordingStore store = new LocationRecordingPolicy.RecordingStore(dir);
        LocationRecordingPolicy.RecordingSessionCoordinator coordinator =
            new LocationRecordingPolicy.RecordingSessionCoordinator(store);

        int threads = 8;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            CyclicBarrier barrier = new CyclicBarrier(threads);
            List<Callable<LocationRecordingPolicy.StartResult>> tasks = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                final int idx = i;
                tasks.add(() -> {
                    barrier.await(5, TimeUnit.SECONDS);
                    return coordinator.startSession(
                        "sess-race-" + idx,
                        "user-a",
                        "aaaaaaaa-0000-4000-8000-00000000000" + idx,
                        "并发启动-" + idx,
                        false,
                        1_700_000_000_000L + idx
                    );
                });
            }
            List<Future<LocationRecordingPolicy.StartResult>> results = pool.invokeAll(tasks);
            String winnerId = null;
            int successCount = 0;
            int rejectedCount = 0;
            for (Future<LocationRecordingPolicy.StartResult> f : results) {
                LocationRecordingPolicy.StartResult res = f.get(5, TimeUnit.SECONDS);
                if (res.errorCode == null) {
                    successCount++;
                    winnerId = res.session.sessionId;
                } else {
                    assertEquals("EXISTING_SESSION_ACTIVE", res.errorCode);
                    rejectedCount++;
                }
            }
            assertEquals(1, successCount);
            assertEquals(threads - 1, rejectedCount);
            assertNotNull(winnerId);
            assertEquals(winnerId, coordinator.currentSession().sessionId);
            assertEquals(winnerId, store.loadSession().sessionId);

            // Append 2 points to the winning session, then verify repeated/concurrent starts cannot overwrite them
            assertNotNull(coordinator.recordLocationPoint(new LocationRecordingPolicy.RecordedPoint(
                31.2300, 121.4700, 10.0, 5.0, 1_700_000_001_000L, 0)));
            assertNotNull(coordinator.recordLocationPoint(new LocationRecordingPolicy.RecordedPoint(
                31.2301, 121.4700, 10.0, 5.0, 1_700_000_005_000L, 0)));

            CyclicBarrier repeatBarrier = new CyclicBarrier(threads);
            List<Callable<LocationRecordingPolicy.StartResult>> repeatTasks = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                final int idx = i;
                repeatTasks.add(() -> {
                    repeatBarrier.await(5, TimeUnit.SECONDS);
                    return coordinator.startSession(
                        "sess-repeat-" + idx,
                        "user-a",
                        "bbbbbbbb-0000-4000-8000-00000000000" + idx,
                        "重复启动-" + idx,
                        false,
                        1_700_000_020_000L + idx
                    );
                });
            }
            for (Future<LocationRecordingPolicy.StartResult> f : pool.invokeAll(repeatTasks)) {
                LocationRecordingPolicy.StartResult res = f.get(5, TimeUnit.SECONDS);
                assertEquals("EXISTING_SESSION_ACTIVE", res.errorCode);
                assertNotNull(res.session);
                assertEquals(winnerId, res.session.sessionId);
            }
            assertEquals(winnerId, coordinator.currentSession().sessionId);
            assertEquals(2, store.loadPoints(0).size());
        } finally {
            pool.shutdownNow();
        }
    }
}
