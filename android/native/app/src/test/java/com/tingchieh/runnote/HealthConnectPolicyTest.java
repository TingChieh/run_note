package com.tingchieh.runnote;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import androidx.health.connect.client.HealthConnectClient;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Instant;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.Test;

public class HealthConnectPolicyTest {

    @Test
    public void onlyAllowsMinimalReadOnlyPermissionsAndRejectsAnyWritePermission() {
        Set<String> all = HealthConnectPolicy.allReadPermissions();
        assertEquals(6, all.size());
        for (String permission : all) {
            assertTrue("Expected read permission: " + permission, HealthConnectPolicy.isReadOnlyPermission(permission));
            assertFalse("Write permission forbidden: " + permission, permission.contains("WRITE_"));
        }
        assertFalse(HealthConnectPolicy.isReadOnlyPermission("android.permission.health.WRITE_STEPS"));
        assertFalse(HealthConnectPolicy.isReadOnlyPermission("android.permission.health.WRITE_HEART_RATE"));
        assertFalse(HealthConnectPolicy.isReadOnlyPermission("android.permission.health.READ_EXERCISE_ROUTE"));
        assertFalse(HealthConnectPolicy.isReadOnlyPermission("android.permission.health.READ_NUTRITION"));
        assertFalse(HealthConnectPolicy.isReadOnlyPermission(""));
        assertFalse(HealthConnectPolicy.isReadOnlyPermission(null));
    }

    @Test
    public void manifestDeclaresZeroWriteHealthPermissionsAndExactMinimalReadSet() throws Exception {
        File manifest = new File("src/main/AndroidManifest.xml");
        assertTrue("Manifest file must exist in module root", manifest.exists());
        String xml = new String(Files.readAllBytes(manifest.toPath()), StandardCharsets.UTF_8);
        assertFalse("AndroidManifest must not declare any Health Connect WRITE permission",
            xml.contains("android.permission.health.WRITE_"));
        assertFalse("AndroidManifest must not request background health reads in Phase 2",
            xml.contains("READ_HEALTH_DATA_IN_BACKGROUND"));
        assertFalse("AndroidManifest must not request exercise routes in Phase 2",
            xml.contains("READ_EXERCISE_ROUTE"));
        for (String permission : HealthConnectPolicy.allReadPermissions()) {
            assertTrue("Missing declared read permission in manifest: " + permission, xml.contains(permission));
        }
    }

    @Test
    public void classifiesAvailabilityAcrossSupportedUpdateRequiredAndUnsupported() {
        HealthConnectPolicy.AvailabilitySpec available =
            HealthConnectPolicy.classifyAvailability(HealthConnectClient.SDK_AVAILABLE);
        assertTrue(available.available);
        assertEquals("available", available.status);
        assertNull(available.reason);

        HealthConnectPolicy.AvailabilitySpec updateRequired =
            HealthConnectPolicy.classifyAvailability(HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED);
        assertFalse(updateRequired.available);
        assertEquals("provider_update_required", updateRequired.status);
        assertNotNull(updateRequired.reason);

        HealthConnectPolicy.AvailabilitySpec unsupported =
            HealthConnectPolicy.classifyAvailability(HealthConnectClient.SDK_UNAVAILABLE);
        assertFalse(unsupported.available);
        assertEquals("unsupported", unsupported.status);
        assertNotNull(unsupported.reason);
    }

    @Test
    public void evaluatesGrantedPartialAndDeniedPermissionStates() {
        List<String> requested = Arrays.asList("steps", "heart_rate", "unknown_metric");
        assertEquals(Arrays.asList("steps", "heart_rate"), HealthConnectPolicy.resolveRequestedMetrics(requested));

        Set<String> both = new HashSet<>(Arrays.asList(
            HealthConnectPolicy.permissionForMetric("steps"),
            HealthConnectPolicy.permissionForMetric("heart_rate")
        ));
        HealthConnectPolicy.PermissionEvaluation full = HealthConnectPolicy.evaluatePermissions(requested, both);
        assertEquals("granted", full.status);
        assertEquals(Arrays.asList("steps", "heart_rate"), full.granted);
        assertTrue(full.denied.isEmpty());

        Set<String> onlySteps = Collections.singleton(HealthConnectPolicy.permissionForMetric("steps"));
        HealthConnectPolicy.PermissionEvaluation partial = HealthConnectPolicy.evaluatePermissions(requested, onlySteps);
        assertEquals("partial", partial.status);
        assertEquals(Collections.singletonList("steps"), partial.granted);
        assertEquals(Collections.singletonList("heart_rate"), partial.denied);

        HealthConnectPolicy.PermissionEvaluation none = HealthConnectPolicy.evaluatePermissions(
            requested,
            Collections.singleton("android.permission.health.WRITE_STEPS")
        );
        assertEquals("denied", none.status);
        assertTrue(none.granted.isEmpty());
        assertEquals(Arrays.asList("steps", "heart_rate"), none.denied);
    }

    @Test
    public void clampsWindowToThirtyDaysAndRejectsInvertedRange() {
        Instant now = Instant.parse("2026-11-23T12:00:00Z");
        HealthConnectPolicy.QueryWindow defaultWindow = HealthConnectPolicy.resolveWindow(null, null, now);
        assertEquals(Instant.parse("2026-11-16T12:00:00Z"), defaultWindow.start);
        assertEquals(now, defaultWindow.end);

        HealthConnectPolicy.QueryWindow clamped = HealthConnectPolicy.resolveWindow(
            "2026-01-01T00:00:00Z",
            "2026-12-01T00:00:00Z",
            now
        );
        assertEquals(now, clamped.end);
        assertEquals(Instant.parse("2026-10-24T12:00:00Z"), clamped.start);

        boolean rejected = false;
        try {
            HealthConnectPolicy.resolveWindow("2026-11-23T12:00:00Z", "2026-11-20T00:00:00Z", now);
        } catch (IllegalArgumentException expected) {
            rejected = true;
        }
        assertTrue("Inverted range must be rejected", rejected);
    }

    @Test
    public void aggregatesSyntheticSamplesAndHandlesEmptyState() {
        HealthConnectPolicy.SummaryResult empty = HealthConnectPolicy.aggregateSummary(
            0L, 0.0, 0.0, Collections.emptyList(), Collections.emptyList(), Collections.emptyList()
        );
        assertFalse(empty.hasAnyData);
        assertNull(empty.steps);
        assertNull(empty.heartRate);

        HealthConnectPolicy.SummaryResult summary = HealthConnectPolicy.aggregateSummary(
            12450L,
            8423.46,
            512.7,
            Arrays.asList(140L, 152L, 160L, 999L), // 999 bpm outlier filtered out
            Arrays.asList(54L, 56L),
            Arrays.asList(25200L, 1800L) // 450 min = 7.5h
        );
        assertTrue(summary.hasAnyData);
        assertEquals(Long.valueOf(12450L), summary.steps);
        assertEquals(Double.valueOf(8423.5), summary.distanceMeters);
        assertEquals(Integer.valueOf(513), summary.activeCaloriesKcal);
        assertNotNull(summary.heartRate);
        assertEquals(Integer.valueOf(151), summary.heartRate.avgBpm);
        assertEquals(Integer.valueOf(140), summary.heartRate.minBpm);
        assertEquals(Integer.valueOf(160), summary.heartRate.maxBpm);
        assertEquals(3, summary.heartRate.sampleCount);
        assertEquals(Integer.valueOf(55), summary.restingHeartRateBpm);
        assertEquals(Integer.valueOf(450), summary.sleepMinutes);
    }
}
