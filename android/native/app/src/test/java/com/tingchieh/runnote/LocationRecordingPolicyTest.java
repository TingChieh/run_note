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
import java.util.Arrays;
import java.util.List;
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

        // Android 12+ approximate-only grant
        LocationRecordingPolicy.PermissionEvaluation approx =
            LocationRecordingPolicy.evaluatePermissions(false, true, 34, true, true);
        assertEquals("approximate", approx.locationStatus);
        assertFalse(approx.preciseLocation);
        assertTrue(approx.canRecord);

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

        // After process death (serviceRunning = false), recording reconciles to interrupted with frozen duration
        LocationRecordingPolicy.SessionRecord reconciled =
            LocationRecordingPolicy.reconcileAfterRestart(loaded, false);
        assertNotNull(reconciled);
        assertEquals("interrupted", reconciled.status);
        assertEquals("process_terminated", reconciled.interruptedReason);
        assertEquals(20_000L, reconciled.activeDurationMs);
        assertNull(reconciled.lastSegmentStartMs);

        // Same account keeps session; different account wipes it cleanly
        assertFalse(store.clearIfAccountMismatch("user-a"));
        assertNotNull(store.loadSession());
        assertTrue(store.clearIfAccountMismatch("user-b"));
        assertNull(store.loadSession());
        assertTrue(store.loadPoints(0).isEmpty());
    }
}
