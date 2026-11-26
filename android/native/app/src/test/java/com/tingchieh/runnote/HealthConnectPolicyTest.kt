package com.tingchieh.runnote

import androidx.health.connect.client.HealthConnectClient
import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthConnectPolicyTest {

    @Test
    fun onlyAllowsMinimalReadOnlyPermissionsAndRejectsAnyWritePermission() {
        val all = HealthConnectPolicy.allReadPermissions()
        assertEquals(6, all.size)
        for (permission in all) {
            assertTrue("Expected read permission: $permission", HealthConnectPolicy.isReadOnlyPermission(permission))
            assertFalse("Write permission forbidden: $permission", permission.contains("WRITE_"))
        }
        assertFalse(HealthConnectPolicy.isReadOnlyPermission("android.permission.health.WRITE_STEPS"))
        assertFalse(HealthConnectPolicy.isReadOnlyPermission("android.permission.health.WRITE_HEART_RATE"))
        assertFalse(HealthConnectPolicy.isReadOnlyPermission("android.permission.health.READ_EXERCISE_ROUTE"))
        assertFalse(HealthConnectPolicy.isReadOnlyPermission("android.permission.health.READ_NUTRITION"))
        assertFalse(HealthConnectPolicy.isReadOnlyPermission(""))
        assertFalse(HealthConnectPolicy.isReadOnlyPermission(null))
    }

    @Test
    fun manifestDeclaresZeroWriteHealthPermissionsAndExactMinimalReadSet() {
        val manifest = File("src/main/AndroidManifest.xml")
        assertTrue("Manifest file must exist in module root", manifest.exists())
        val xml = String(Files.readAllBytes(manifest.toPath()), StandardCharsets.UTF_8)
        assertFalse(
            "AndroidManifest must not declare any Health Connect WRITE permission",
            xml.contains("android.permission.health.WRITE_"),
        )
        assertFalse(
            "AndroidManifest must not request background health reads in Phase 2",
            xml.contains("READ_HEALTH_DATA_IN_BACKGROUND"),
        )
        assertFalse(
            "AndroidManifest must not request exercise routes in Phase 2",
            xml.contains("READ_EXERCISE_ROUTE"),
        )
        for (permission in HealthConnectPolicy.allReadPermissions()) {
            assertTrue("Missing declared read permission in manifest: $permission", xml.contains(permission))
        }
    }

    @Test
    fun classifiesAvailabilityAcrossSupportedUpdateRequiredAndUnsupported() {
        val available = HealthConnectPolicy.classifyAvailability(HealthConnectClient.SDK_AVAILABLE)
        assertTrue(available.available)
        assertEquals("available", available.status)
        assertNull(available.reason)

        val updateRequired =
            HealthConnectPolicy.classifyAvailability(HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED)
        assertFalse(updateRequired.available)
        assertEquals("provider_update_required", updateRequired.status)
        assertNotNull(updateRequired.reason)

        val unsupported = HealthConnectPolicy.classifyAvailability(HealthConnectClient.SDK_UNAVAILABLE)
        assertFalse(unsupported.available)
        assertEquals("unsupported", unsupported.status)
        assertNotNull(unsupported.reason)
    }

    @Test
    fun evaluatesGrantedPartialAndDeniedPermissionStates() {
        val requested = listOf("steps", "heart_rate", "unknown_metric")
        assertEquals(listOf("steps", "heart_rate"), HealthConnectPolicy.resolveRequestedMetrics(requested))

        val both = hashSetOf(
            HealthConnectPolicy.permissionForMetric("steps")!!,
            HealthConnectPolicy.permissionForMetric("heart_rate")!!,
        )
        val full = HealthConnectPolicy.evaluatePermissions(requested, both)
        assertEquals("granted", full.status)
        assertEquals(listOf("steps", "heart_rate"), full.granted)
        assertTrue(full.denied.isEmpty())

        val onlySteps = setOf(HealthConnectPolicy.permissionForMetric("steps")!!)
        val partial = HealthConnectPolicy.evaluatePermissions(requested, onlySteps)
        assertEquals("partial", partial.status)
        assertEquals(listOf("steps"), partial.granted)
        assertEquals(listOf("heart_rate"), partial.denied)

        val none = HealthConnectPolicy.evaluatePermissions(
            requested,
            setOf("android.permission.health.WRITE_STEPS"),
        )
        assertEquals("denied", none.status)
        assertTrue(none.granted.isEmpty())
        assertEquals(listOf("steps", "heart_rate"), none.denied)
    }

    @Test
    fun clampsWindowToThirtyDaysAndRejectsInvertedRange() {
        val now = Instant.parse("2026-11-23T12:00:00Z")
        val defaultWindow = HealthConnectPolicy.resolveWindow(null, null, now)
        assertEquals(Instant.parse("2026-11-16T12:00:00Z"), defaultWindow.start)
        assertEquals(now, defaultWindow.end)

        val clamped = HealthConnectPolicy.resolveWindow(
            "2026-01-01T00:00:00Z",
            "2026-12-01T00:00:00Z",
            now,
        )
        assertEquals(now, clamped.end)
        assertEquals(Instant.parse("2026-10-24T12:00:00Z"), clamped.start)

        var rejected = false
        try {
            HealthConnectPolicy.resolveWindow("2026-11-23T12:00:00Z", "2026-11-20T00:00:00Z", now)
        } catch (_: IllegalArgumentException) {
            rejected = true
        }
        assertTrue("Inverted range must be rejected", rejected)
    }

    @Test
    fun aggregatesSyntheticSamplesAndHandlesEmptyState() {
        val empty = HealthConnectPolicy.aggregateSummary(
            0L, 0.0, 0.0, emptyList(), emptyList(), emptyList(),
        )
        assertFalse(empty.hasAnyData)
        assertNull(empty.steps)
        assertNull(empty.heartRate)

        val summary = HealthConnectPolicy.aggregateSummary(
            12450L,
            8423.46,
            512.7,
            listOf(140L, 152L, 160L, 999L), // 999 bpm outlier filtered out
            listOf(54L, 56L),
            listOf(25200L, 1800L), // 450 min = 7.5h
        )
        assertTrue(summary.hasAnyData)
        assertEquals(12450L, summary.steps)
        assertEquals(8423.5, summary.distanceMeters)
        assertEquals(513, summary.activeCaloriesKcal)
        val heartRate = summary.heartRate
        assertNotNull(heartRate)
        assertEquals(151, heartRate!!.avgBpm)
        assertEquals(140, heartRate.minBpm)
        assertEquals(160, heartRate.maxBpm)
        assertEquals(3, heartRate.sampleCount)
        assertEquals(55, summary.restingHeartRateBpm)
        assertEquals(450, summary.sleepMinutes)
    }

    @Test
    fun paginatesRecordTokensAndGuardsAgainstCapsAndCycles() {
        // Multi-page traversal follows pageToken until null/blank.
        val full = HealthConnectPolicy.collectPagesBlocking<Long>(10) { token ->
            when (token) {
                null -> HealthConnectPolicy.RecordPage(listOf(140L, 145L), "tok-2")
                "tok-2" -> HealthConnectPolicy.RecordPage(listOf(150L, 155L), "tok-3")
                else -> HealthConnectPolicy.RecordPage(listOf(160L), null)
            }
        }
        assertFalse(full.truncated)
        assertEquals(3, full.pagesFetched)
        assertEquals(listOf(140L, 145L, 150L, 155L, 160L), full.records)

        // Enforces maxPages cap when provider keeps returning next tokens.
        val capped = HealthConnectPolicy.collectPagesBlocking<Long>(2) { token ->
            if (token == null) {
                HealthConnectPolicy.RecordPage(listOf(101L), "tok-2")
            } else {
                HealthConnectPolicy.RecordPage(listOf(102L), "tok-3")
            }
        }
        assertTrue(capped.truncated)
        assertEquals(2, capped.pagesFetched)
        assertEquals(listOf(101L, 102L), capped.records)

        // Stops safely if a broken provider repeats a previously seen pageToken.
        val cyclic = HealthConnectPolicy.collectPagesBlocking<Long>(10) {
            HealthConnectPolicy.RecordPage(listOf(120L), "loop-tok")
        }
        assertTrue(cyclic.truncated)
        assertEquals(2, cyclic.pagesFetched)
        assertEquals(listOf(120L, 120L), cyclic.records)
    }
}
