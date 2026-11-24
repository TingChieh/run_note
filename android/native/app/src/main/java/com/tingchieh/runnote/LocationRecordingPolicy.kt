package com.tingchieh.runnote

import android.content.pm.ServiceInfo
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.nio.charset.StandardCharsets
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.Locale
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Pure JVM policy, GPS point filtering, foreground-service permission rules, and crash-safe
 * disk persistence for RunNote Phase 3 active-run recording.
 *
 * Security & privacy invariants:
 * - Zero coordinates, tokens, cookies, or health data are ever formatted into logs.
 * - Foreground service location only: does NOT declare ACCESS_BACKGROUND_LOCATION.
 * - Persisted sessions are strictly bound to an opaque `accountId` and wiped on account switch.
 */
object LocationRecordingPolicy {

    const val MAX_ACCEPTED_ACCURACY_METERS: Double = 50.0
    const val GOOD_ACCURACY_METERS: Double = 15.0
    const val GPS_LOST_TIMEOUT_MS: Long = 15_000L
    const val MAX_REALISTIC_SPEED_MPS: Double = 12.0
    const val MAX_POINTS_PER_SESSION: Int = 50_000
    const val MAX_SEGMENTS_PER_SESSION: Int = 1_000
    const val EARTH_RADIUS_METERS: Double = 6_371_008.8

    @JvmField
    val REQUIRED_MANIFEST_PERMISSIONS: List<String> = listOf(
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_LOCATION",
        "android.permission.POST_NOTIFICATIONS",
    )

    @JvmField
    val FORBIDDEN_LOCATION_PERMISSIONS: List<String> = listOf(
        "android.permission.ACCESS_BACKGROUND_LOCATION",
    )

    data class PermissionEvaluation(
        @JvmField val locationStatus: String,
        @JvmField val notificationStatus: String,
        @JvmField val locationServicesEnabled: Boolean,
        @JvmField val preciseLocation: Boolean,
        @JvmField val canRecord: Boolean,
    )

    data class RecordedPoint(
        @JvmField val lat: Double,
        @JvmField val lon: Double,
        @JvmField val elevationM: Double?,
        @JvmField val accuracyM: Double?,
        @JvmField val recordedAtMs: Long,
        @JvmField val segmentIndex: Int,
    )

    data class PointDecision(
        @JvmField val accepted: Boolean,
        @JvmField val reason: String?,
        @JvmField val distanceDeltaM: Double,
    )

    data class SessionRecord(
        @JvmField val sessionId: String,
        @JvmField val accountId: String,
        @JvmField val idempotencyKey: String,
        @JvmField val title: String,
        @JvmField val status: String,
        @JvmField val startedAtMs: Long,
        @JvmField val endedAtMs: Long?,
        @JvmField val activeDurationMs: Long,
        @JvmField val lastSegmentStartMs: Long?,
        @JvmField val segmentIndex: Int,
        @JvmField val pointCount: Int,
        @JvmField val previewDistanceM: Double,
        @JvmField val lastPointTimeMs: Long?,
        @JvmField val lastAccuracyM: Double?,
        @JvmField val interruptedReason: String?,
    ) {
        fun effectiveActiveDurationMs(nowMs: Long): Long {
            val runningDelta = if (status == "recording" && lastSegmentStartMs != null && nowMs > lastSegmentStartMs) {
                nowMs - lastSegmentStartMs
            } else {
                0L
            }
            return (activeDurationMs + runningDelta).coerceAtLeast(0L)
        }
    }

    @JvmStatic
    fun evaluatePermissions(
        hasFineLocation: Boolean,
        hasCoarseLocation: Boolean,
        sdkInt: Int,
        hasNotifications: Boolean,
        locationServicesEnabled: Boolean,
    ): PermissionEvaluation {
        val locationStatus = when {
            hasFineLocation -> "granted"
            hasCoarseLocation -> "approximate"
            else -> "denied"
        }
        val notificationStatus = when {
            sdkInt < 33 -> "not_required"
            hasNotifications -> "granted"
            else -> "denied"
        }
        // Running tracks require precise GPS fixes (<= 50m accuracy); approximate-only cannot record.
        val canRecord = hasFineLocation && locationServicesEnabled
        return PermissionEvaluation(
            locationStatus = locationStatus,
            notificationStatus = notificationStatus,
            locationServicesEnabled = locationServicesEnabled,
            preciseLocation = hasFineLocation,
            canRecord = canRecord,
        )
    }

    @JvmStatic
    fun hasPendingHandoff(session: SessionRecord?): Boolean {
        return session != null && session.status == "stopped" && session.pointCount > 0
    }

    @JvmStatic
    fun permissionsToRequest(sdkInt: Int): Array<String> {
        val perms = mutableListOf(
            "android.permission.ACCESS_FINE_LOCATION",
            "android.permission.ACCESS_COARSE_LOCATION",
        )
        if (sdkInt >= 33) {
            perms.add("android.permission.POST_NOTIFICATIONS")
        }
        return perms.toTypedArray()
    }

    @JvmStatic
    fun foregroundServiceTypeForApi(sdkInt: Int): Int {
        return if (sdkInt >= 29) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        } else {
            0
        }
    }

    @JvmStatic
    fun classifyGpsSignal(
        status: String,
        locationServicesEnabled: Boolean,
        hasLocationPermission: Boolean,
        lastAccuracyM: Double?,
        lastFixAgeMs: Long?,
    ): String {
        if (!hasLocationPermission) return "permission_denied"
        if (!locationServicesEnabled) return "disabled"
        if (status != "recording") return "inactive"
        if (lastFixAgeMs == null) return "acquiring"
        if (lastFixAgeMs > GPS_LOST_TIMEOUT_MS) return "lost"
        if (lastAccuracyM != null && lastAccuracyM <= GOOD_ACCURACY_METERS) return "good"
        return "weak"
    }

    @JvmStatic
    fun haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val rLat1 = Math.toRadians(lat1)
        val rLat2 = Math.toRadians(lat2)
        val a = sin(dLat / 2.0) * sin(dLat / 2.0) +
            cos(rLat1) * cos(rLat2) * sin(dLon / 2.0) * sin(dLon / 2.0)
        val c = 2.0 * atan2(sqrt(a), sqrt((1.0 - a).coerceAtLeast(0.0)))
        return EARTH_RADIUS_METERS * c
    }

    @JvmStatic
    fun evaluatePoint(
        candidate: RecordedPoint,
        previous: RecordedPoint?,
        currentPointCount: Int,
    ): PointDecision {
        if (currentPointCount >= MAX_POINTS_PER_SESSION) {
            return PointDecision(false, "point_limit_reached", 0.0)
        }
        if (candidate.segmentIndex < 0 || candidate.segmentIndex >= MAX_SEGMENTS_PER_SESSION) {
            return PointDecision(false, "segment_limit_reached", 0.0)
        }
        if (!candidate.lat.isFinite() || !candidate.lon.isFinite()) {
            return PointDecision(false, "invalid_coordinate", 0.0)
        }
        if (candidate.lat < -90.0 || candidate.lat > 90.0 || candidate.lon < -180.0 || candidate.lon > 180.0) {
            return PointDecision(false, "coordinate_out_of_range", 0.0)
        }
        if (candidate.elevationM != null && !candidate.elevationM.isFinite()) {
            return PointDecision(false, "invalid_elevation", 0.0)
        }
        if (candidate.recordedAtMs <= 0L) {
            return PointDecision(false, "invalid_timestamp", 0.0)
        }
        if (candidate.accuracyM != null && (!candidate.accuracyM.isFinite() || candidate.accuracyM < 0.0 || candidate.accuracyM > MAX_ACCEPTED_ACCURACY_METERS)) {
            return PointDecision(false, "poor_accuracy", 0.0)
        }
        if (previous != null) {
            if (candidate.recordedAtMs < previous.recordedAtMs) {
                return PointDecision(false, "time_reversal", 0.0)
            }
            if (candidate.recordedAtMs == previous.recordedAtMs &&
                candidate.lat == previous.lat &&
                candidate.lon == previous.lon
            ) {
                return PointDecision(false, "duplicate_point", 0.0)
            }
            if (candidate.segmentIndex == previous.segmentIndex) {
                val deltaMeters = haversineMeters(previous.lat, previous.lon, candidate.lat, candidate.lon)
                val dtSeconds = (candidate.recordedAtMs - previous.recordedAtMs) / 1000.0
                if (dtSeconds == 0.0 && deltaMeters > 0.0) {
                    return PointDecision(false, "zero_time_jump", 0.0)
                }
                if (dtSeconds > 0.0 && (deltaMeters / dtSeconds) > MAX_REALISTIC_SPEED_MPS) {
                    return PointDecision(false, "speed_jump", 0.0)
                }
                return PointDecision(true, null, deltaMeters)
            }
        }
        return PointDecision(true, null, 0.0)
    }

    @JvmStatic
    fun reconcileAfterRestart(session: SessionRecord?, serviceRunning: Boolean): SessionRecord? {
        if (session == null) return null
        if (!serviceRunning && (session.status == "recording" || session.status == "paused")) {
            val frozenActive = if (session.status == "recording" && session.lastSegmentStartMs != null) {
                val endRef = session.lastPointTimeMs?.coerceAtLeast(session.lastSegmentStartMs)
                    ?: session.lastSegmentStartMs
                (session.activeDurationMs + (endRef - session.lastSegmentStartMs)).coerceAtLeast(0L)
            } else {
                session.activeDurationMs
            }
            return session.copy(
                status = "interrupted",
                activeDurationMs = frozenActive,
                lastSegmentStartMs = null,
                interruptedReason = session.interruptedReason ?: "process_terminated",
            )
        }
        return session
    }

    @JvmStatic
    fun formatDurationClock(durationMs: Long): String {
        val totalSeconds = (durationMs / 1000L).coerceAtLeast(0L)
        val hours = totalSeconds / 3600L
        val minutes = (totalSeconds % 3600L) / 60L
        val seconds = totalSeconds % 60L
        return if (hours > 0L) {
            String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
        } else {
            String.format(Locale.US, "%02d:%02d", minutes, seconds)
        }
    }

    @JvmStatic
    fun formatPreviewKm(distanceMeters: Double): String {
        val safeKm = if (distanceMeters.isFinite() && distanceMeters > 0.0) distanceMeters / 1000.0 else 0.0
        return String.format(Locale.US, "%.2f", safeKm)
    }

    private fun jsonQuote(value: String): String {
        val sb = StringBuilder(value.length + 2)
        sb.append('"')
        for (ch in value) {
            when (ch) {
                '\\' -> sb.append("\\\\")
                '"' -> sb.append("\\\"")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> {
                    if (ch.code < 0x20) {
                        sb.append(String.format(Locale.US, "\\u%04x", ch.code))
                    } else {
                        sb.append(ch)
                    }
                }
            }
        }
        sb.append('"')
        return sb.toString()
    }

    /**
     * Minimal, pure-JVM flat JSON object parser (supports strings, numbers, booleans, null) so
     * persistence works identically on Android runtime and local JVM JUnit tests without Android stubs.
     */
    private fun parseFlatJsonObject(raw: String): Map<String, String?>? {
        val s = raw.trim()
        if (!s.startsWith("{") || !s.endsWith("}")) return null
        val result = LinkedHashMap<String, String?>()
        var i = 1
        val end = s.length - 1
        fun skipWs() {
            while (i < end && s[i].isWhitespace()) i++
        }
        fun readString(): String? {
            if (i >= end || s[i] != '"') return null
            i++
            val sb = StringBuilder()
            while (i < end) {
                val c = s[i++]
                if (c == '"') return sb.toString()
                if (c == '\\') {
                    if (i >= end) return null
                    when (val esc = s[i++]) {
                        '"' -> sb.append('"')
                        '\\' -> sb.append('\\')
                        '/' -> sb.append('/')
                        'n' -> sb.append('\n')
                        'r' -> sb.append('\r')
                        't' -> sb.append('\t')
                        'u' -> {
                            if (i + 4 > end) return null
                            val hex = s.substring(i, i + 4)
                            sb.append(hex.toInt(16).toChar())
                            i += 4
                        }
                        else -> return null
                    }
                } else {
                    sb.append(c)
                }
            }
            return null
        }

        skipWs()
        while (i < end) {
            val key = readString() ?: return null
            skipWs()
            if (i >= end || s[i] != ':') return null
            i++
            skipWs()
            if (i >= end) return null
            val value: String? = if (s[i] == '"') {
                readString() ?: return null
            } else {
                val start = i
                while (i < end && s[i] != ',' && !s[i].isWhitespace()) i++
                val token = s.substring(start, i)
                if (token == "null") null else token
            }
            result[key] = value
            skipWs()
            if (i < end) {
                if (s[i] != ',') return null
                i++
                skipWs()
            }
        }
        return result
    }

    /**
     * Crash-safe, account-scoped disk store for the active recording session.
     * Uses atomic temp-file replacement for metadata JSON and append-only NDJSON for track points
     * so sudden process death or power loss never corrupts already-captured points.
     */
    class RecordingStore(private val dir: File) {
        private val metaFile: File = File(dir, "active_session.json")
        private val metaTmpFile: File = File(dir, "active_session.json.tmp")
        private val pointsFile: File = File(dir, "points.ndjson")
        private val pointsTmpFile: File = File(dir, "points.ndjson.tmp")

        private fun atomicReplace(source: File, target: File) {
            try {
                Files.move(
                    source.toPath(),
                    target.toPath(),
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE,
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(source.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
        }

        @Synchronized
        fun saveSession(session: SessionRecord) {
            if (!dir.exists()) {
                dir.mkdirs()
            }
            val fields = listOf(
                "\"sessionId\":${jsonQuote(session.sessionId)}",
                "\"accountId\":${jsonQuote(session.accountId)}",
                "\"idempotencyKey\":${jsonQuote(session.idempotencyKey)}",
                "\"title\":${jsonQuote(session.title)}",
                "\"status\":${jsonQuote(session.status)}",
                "\"startedAtMs\":${session.startedAtMs}",
                "\"endedAtMs\":${session.endedAtMs?.toString() ?: "null"}",
                "\"activeDurationMs\":${session.activeDurationMs}",
                "\"lastSegmentStartMs\":${session.lastSegmentStartMs?.toString() ?: "null"}",
                "\"segmentIndex\":${session.segmentIndex}",
                "\"pointCount\":${session.pointCount}",
                "\"previewDistanceM\":${String.format(Locale.US, "%.4f", session.previewDistanceM)}",
                "\"lastPointTimeMs\":${session.lastPointTimeMs?.toString() ?: "null"}",
                "\"lastAccuracyM\":${session.lastAccuracyM?.let { String.format(Locale.US, "%.3f", it) } ?: "null"}",
                "\"interruptedReason\":${session.interruptedReason?.let { jsonQuote(it) } ?: "null"}",
            )
            val payload = "{${fields.joinToString(",")}}"
            FileOutputStream(metaTmpFile).use { fos ->
                fos.write(payload.toByteArray(StandardCharsets.UTF_8))
                fos.flush()
                try {
                    fos.fd.sync()
                } catch (_: Exception) {
                    // Best-effort fsync on platforms that support it.
                }
            }
            atomicReplace(metaTmpFile, metaFile)
        }

        private fun formatPointLine(point: RecordedPoint): String {
            val fields = mutableListOf(
                "\"lat\":${String.format(Locale.US, "%.7f", point.lat)}",
                "\"lon\":${String.format(Locale.US, "%.7f", point.lon)}",
                "\"t\":${point.recordedAtMs}",
                "\"seg\":${point.segmentIndex}",
            )
            if (point.elevationM != null) {
                fields.add("\"ele\":${String.format(Locale.US, "%.2f", point.elevationM)}")
            }
            if (point.accuracyM != null) {
                fields.add("\"acc\":${String.format(Locale.US, "%.2f", point.accuracyM)}")
            }
            return "{${fields.joinToString(",")}}"
        }

        @Synchronized
        fun appendPoint(point: RecordedPoint) {
            if (!dir.exists()) {
                dir.mkdirs()
            }
            val line = formatPointLine(point)
            FileOutputStream(pointsFile, true).use { fos ->
                BufferedWriter(OutputStreamWriter(fos, StandardCharsets.UTF_8)).use { writer ->
                    writer.write(line)
                    writer.newLine()
                    writer.flush()
                }
            }
        }

        @Synchronized
        fun loadSessionForAccount(accountId: String?): SessionRecord? {
            val loaded = loadSession() ?: return null
            if (!accountId.isNullOrBlank() && loaded.accountId != accountId) {
                return null
            }
            return loaded
        }

        @Synchronized
        fun loadPointsForAccount(accountId: String?, afterIndex: Int = 0): List<RecordedPoint> {
            val loaded = loadSession() ?: return emptyList()
            if (!accountId.isNullOrBlank() && loaded.accountId != accountId) {
                return emptyList()
            }
            return loadPoints(afterIndex)
        }

        @Synchronized
        fun acknowledgeHandoff(sessionId: String): Boolean {
            if (sessionId.isBlank()) return false
            val existing = loadSession() ?: return false
            if (existing.sessionId != sessionId) return false
            clearAll()
            return true
        }

        @Synchronized
        fun loadSession(): SessionRecord? {
            if (!metaFile.exists()) return null
            return try {
                val raw = metaFile.readText(StandardCharsets.UTF_8)
                val obj = parseFlatJsonObject(raw) ?: return null
                val sessionId = obj["sessionId"]?.trim().orEmpty()
                val accountId = obj["accountId"]?.trim().orEmpty()
                val idempotencyKey = obj["idempotencyKey"]?.trim().orEmpty()
                if (sessionId.isBlank() || accountId.isBlank() || idempotencyKey.isBlank()) {
                    return null
                }
                val validPoints = loadPoints(0)
                val recordedCount = validPoints.size
                SessionRecord(
                    sessionId = sessionId,
                    accountId = accountId,
                    idempotencyKey = idempotencyKey,
                    title = obj["title"].orEmpty(),
                    status = obj["status"] ?: "interrupted",
                    startedAtMs = obj["startedAtMs"]?.toLongOrNull() ?: 0L,
                    endedAtMs = obj["endedAtMs"]?.toLongOrNull(),
                    activeDurationMs = (obj["activeDurationMs"]?.toLongOrNull() ?: 0L).coerceAtLeast(0L),
                    lastSegmentStartMs = obj["lastSegmentStartMs"]?.toLongOrNull(),
                    segmentIndex = (obj["segmentIndex"]?.toIntOrNull() ?: 0).coerceAtLeast(0),
                    pointCount = recordedCount,
                    previewDistanceM = obj["previewDistanceM"]?.toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0.0 } ?: 0.0,
                    lastPointTimeMs = obj["lastPointTimeMs"]?.toLongOrNull(),
                    lastAccuracyM = obj["lastAccuracyM"]?.toDoubleOrNull()?.takeIf { it.isFinite() },
                    interruptedReason = obj["interruptedReason"],
                )
            } catch (_: Exception) {
                null
            }
        }

        @Synchronized
        fun loadPoints(afterIndex: Int = 0): List<RecordedPoint> {
            if (!pointsFile.exists()) return emptyList()
            val allValid = mutableListOf<RecordedPoint>()
            var hadCorruptLine = false
            try {
                BufferedReader(InputStreamReader(FileInputStream(pointsFile), StandardCharsets.UTF_8)).use { reader ->
                    var line = reader.readLine()
                    while (line != null) {
                        val trimmed = line.trim()
                        if (trimmed.isNotEmpty()) {
                            val parsed = parsePointLine(trimmed)
                            if (parsed != null) {
                                allValid.add(parsed)
                            } else {
                                hadCorruptLine = true
                            }
                        }
                        line = reader.readLine()
                    }
                }
            } catch (_: Exception) {
                hadCorruptLine = true
            }
            if (hadCorruptLine) {
                repairPointsFile(allValid)
            }
            return if (afterIndex <= 0) allValid else if (afterIndex >= allValid.size) emptyList() else allValid.subList(afterIndex, allValid.size).toList()
        }

        private fun repairPointsFile(validPoints: List<RecordedPoint>) {
            try {
                if (!dir.exists()) dir.mkdirs()
                FileOutputStream(pointsTmpFile).use { fos ->
                    BufferedWriter(OutputStreamWriter(fos, StandardCharsets.UTF_8)).use { writer ->
                        for (pt in validPoints) {
                            writer.write(formatPointLine(pt))
                            writer.newLine()
                        }
                        writer.flush()
                    }
                    try {
                        fos.fd.sync()
                    } catch (_: Exception) {
                        // Best-effort fsync.
                    }
                }
                atomicReplace(pointsTmpFile, pointsFile)
            } catch (_: Exception) {
                if (pointsTmpFile.exists()) pointsTmpFile.delete()
            }
        }

        @Synchronized
        fun clearIfAccountMismatch(activeAccountId: String?): Boolean {
            val existing = loadSession() ?: return false
            if (activeAccountId == null || activeAccountId.isBlank() || existing.accountId != activeAccountId) {
                clearAll()
                return true
            }
            return false
        }

        @Synchronized
        fun clearAll() {
            if (metaTmpFile.exists()) metaTmpFile.delete()
            if (metaFile.exists()) metaFile.delete()
            if (pointsTmpFile.exists()) pointsTmpFile.delete()
            if (pointsFile.exists()) pointsFile.delete()
        }

        private fun parsePointLine(line: String): RecordedPoint? {
            return try {
                val obj = parseFlatJsonObject(line) ?: return null
                val lat = obj["lat"]?.toDoubleOrNull() ?: return null
                val lon = obj["lon"]?.toDoubleOrNull() ?: return null
                val t = obj["t"]?.toLongOrNull() ?: return null
                val seg = obj["seg"]?.toIntOrNull() ?: 0
                if (!lat.isFinite() || !lon.isFinite() || lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0 || t <= 0L) {
                    return null
                }
                val ele = obj["ele"]?.toDoubleOrNull()?.takeIf { it.isFinite() }
                val acc = obj["acc"]?.toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0.0 }
                RecordedPoint(lat = lat, lon = lon, elevationM = ele, accuracyM = acc, recordedAtMs = t, segmentIndex = seg)
            } catch (_: Exception) {
                // Corrupted / truncated trailing line after power loss is skipped safely.
                null
            }
        }
    }
}
