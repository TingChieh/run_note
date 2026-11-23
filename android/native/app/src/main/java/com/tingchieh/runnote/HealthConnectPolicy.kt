package com.tingchieh.runnote

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * Pure policy & aggregation logic for RunNote's read-only Health Connect bridge.
 *
 * Security & privacy invariants:
 * - Strictly read-only: write permissions are never mapped, requested, or accepted.
 * - Minimal metric set aligned with existing RunNote running & recovery fields.
 * - No raw samples or personal identifiers are logged.
 */
object HealthConnectPolicy {

    const val PROVIDER_PACKAGE_NAME = "com.google.android.apps.healthdata"
    const val DEFAULT_WINDOW_DAYS = 7L
    const val MAX_WINDOW_DAYS = 30L

    @JvmField
    val SUPPORTED_METRICS: List<String> = listOf(
        "steps",
        "distance",
        "active_calories",
        "heart_rate",
        "resting_heart_rate",
        "sleep"
    )

    private val PERMISSION_BY_METRIC: Map<String, String> = linkedMapOf(
        "steps" to HealthPermission.getReadPermission(StepsRecord::class),
        "distance" to HealthPermission.getReadPermission(DistanceRecord::class),
        "active_calories" to HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        "heart_rate" to HealthPermission.getReadPermission(HeartRateRecord::class),
        "resting_heart_rate" to HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        "sleep" to HealthPermission.getReadPermission(SleepSessionRecord::class)
    )

    private val ALLOWED_READ_PERMISSIONS: Set<String> = PERMISSION_BY_METRIC.values.toSet()

    data class AvailabilitySpec(
        @JvmField val available: Boolean,
        @JvmField val status: String,
        @JvmField val reason: String?
    )

    data class PermissionEvaluation(
        @JvmField val status: String,
        @JvmField val granted: List<String>,
        @JvmField val denied: List<String>
    )

    data class QueryWindow(
        @JvmField val start: Instant,
        @JvmField val end: Instant
    )

    data class HeartRateSummary(
        @JvmField val avgBpm: Int?,
        @JvmField val minBpm: Int?,
        @JvmField val maxBpm: Int?,
        @JvmField val sampleCount: Int
    )

    data class SummaryResult(
        @JvmField val steps: Long?,
        @JvmField val distanceMeters: Double?,
        @JvmField val activeCaloriesKcal: Int?,
        @JvmField val heartRate: HeartRateSummary?,
        @JvmField val restingHeartRateBpm: Int?,
        @JvmField val sleepMinutes: Int?,
        @JvmField val hasAnyData: Boolean
    )

    @JvmStatic
    fun isReadOnlyPermission(permission: String?): Boolean {
        if (permission.isNullOrBlank()) return false
        if (permission.contains(".WRITE_", ignoreCase = true)) return false
        return ALLOWED_READ_PERMISSIONS.contains(permission)
    }

    @JvmStatic
    fun allReadPermissions(): Set<String> = LinkedHashSet(ALLOWED_READ_PERMISSIONS)

    @JvmStatic
    fun permissionForMetric(metric: String): String? = PERMISSION_BY_METRIC[metric]

    @JvmStatic
    fun resolveRequestedMetrics(rawMetrics: List<String>?): List<String> {
        if (rawMetrics.isNullOrEmpty()) {
            return SUPPORTED_METRICS
        }
        val normalized = LinkedHashSet<String>()
        for (raw in rawMetrics) {
            val trimmed = raw.trim()
            if (PERMISSION_BY_METRIC.containsKey(trimmed)) {
                normalized.add(trimmed)
            }
        }
        return normalized.toList()
    }

    @JvmStatic
    fun permissionsForMetrics(metrics: List<String>): Set<String> {
        val result = LinkedHashSet<String>()
        for (metric in metrics) {
            val permission = PERMISSION_BY_METRIC[metric]
            if (permission != null && isReadOnlyPermission(permission)) {
                result.add(permission)
            }
        }
        return result
    }

    @JvmStatic
    fun classifyAvailability(sdkStatus: Int): AvailabilitySpec {
        return when (sdkStatus) {
            HealthConnectClient.SDK_AVAILABLE -> AvailabilitySpec(
                available = true,
                status = "available",
                reason = null
            )
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> AvailabilitySpec(
                available = false,
                status = "provider_update_required",
                reason = "Health Connect 需要安装或更新后才能读取健康数据"
            )
            else -> AvailabilitySpec(
                available = false,
                status = "unsupported",
                reason = "当前设备或系统版本不支持 Health Connect"
            )
        }
    }

    @JvmStatic
    fun evaluatePermissions(
        requestedMetrics: List<String>,
        grantedPermissions: Set<String>
    ): PermissionEvaluation {
        val validRequested = resolveRequestedMetrics(requestedMetrics)
        val safeGrantedPermissions = grantedPermissions.filter { isReadOnlyPermission(it) }.toSet()
        val granted = mutableListOf<String>()
        val denied = mutableListOf<String>()
        for (metric in validRequested) {
            val permission = PERMISSION_BY_METRIC[metric]
            if (permission != null && safeGrantedPermissions.contains(permission)) {
                granted.add(metric)
            } else {
                denied.add(metric)
            }
        }
        val status = when {
            granted.isEmpty() -> "denied"
            denied.isEmpty() -> "granted"
            else -> "partial"
        }
        return PermissionEvaluation(status = status, granted = granted, denied = denied)
    }

    @JvmStatic
    fun resolveWindow(startIso: String?, endIso: String?, now: Instant): QueryWindow {
        val parsedEnd = parseOptionalInstant(endIso) ?: now
        val clampedEnd = if (parsedEnd.isAfter(now)) now else parsedEnd
        val defaultStart = clampedEnd.minus(Duration.ofDays(DEFAULT_WINDOW_DAYS))
        val parsedStart = parseOptionalInstant(startIso) ?: defaultStart
        require(parsedStart.isBefore(clampedEnd)) { "startDate must be strictly before endDate" }
        val earliestAllowed = clampedEnd.minus(Duration.ofDays(MAX_WINDOW_DAYS))
        val clampedStart = if (parsedStart.isBefore(earliestAllowed)) earliestAllowed else parsedStart
        return QueryWindow(start = clampedStart, end = clampedEnd)
    }

    private fun parseOptionalInstant(raw: String?): Instant? {
        if (raw.isNullOrBlank()) return null
        return try {
            Instant.parse(raw.trim())
        } catch (ex: DateTimeParseException) {
            throw IllegalArgumentException("Invalid ISO-8601 timestamp", ex)
        }
    }

    @JvmStatic
    fun aggregateSummary(
        steps: Long?,
        distanceMeters: Double?,
        activeCaloriesKcal: Double?,
        heartRateSamplesBpm: List<Long>?,
        restingHeartRateSamplesBpm: List<Long>?,
        sleepDurationsSeconds: List<Long>?
    ): SummaryResult {
        val cleanSteps = steps?.takeIf { it > 0L }
        val cleanDistance = distanceMeters
            ?.takeIf { it.isFinite() && it > 0.0 }
            ?.let { (it * 10.0).roundToLong() / 10.0 }
        val cleanCalories = activeCaloriesKcal
            ?.takeIf { it.isFinite() && it > 0.0 }
            ?.roundToInt()

        val validHr = heartRateSamplesBpm?.filter { it in 20L..260L } ?: emptyList()
        val hrSummary = if (validHr.isNotEmpty()) {
            HeartRateSummary(
                avgBpm = validHr.average().roundToInt(),
                minBpm = validHr.min().toInt(),
                maxBpm = validHr.max().toInt(),
                sampleCount = validHr.size
            )
        } else {
            null
        }

        val validResting = restingHeartRateSamplesBpm?.filter { it in 20L..220L } ?: emptyList()
        val restingAvg = if (validResting.isNotEmpty()) validResting.average().roundToInt() else null

        val totalSleepSeconds = sleepDurationsSeconds?.filter { it > 0L }?.sum() ?: 0L
        val cleanSleepMinutes = if (totalSleepSeconds > 0L) (totalSleepSeconds / 60.0).roundToInt() else null

        val hasAny = cleanSteps != null ||
            cleanDistance != null ||
            cleanCalories != null ||
            hrSummary != null ||
            restingAvg != null ||
            cleanSleepMinutes != null

        return SummaryResult(
            steps = cleanSteps,
            distanceMeters = cleanDistance,
            activeCaloriesKcal = cleanCalories,
            heartRate = hrSummary,
            restingHeartRateBpm = restingAvg,
            sleepMinutes = cleanSleepMinutes,
            hasAnyData = hasAny
        )
    }
}
