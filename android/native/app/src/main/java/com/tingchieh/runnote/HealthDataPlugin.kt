package com.tingchieh.runnote

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Logger
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant
import kotlin.reflect.KClass

/**
 * Strictly read-only Android Health Connect bridge exposed as the platform-neutral `HealthData`
 * Capacitor plugin (future iOS HealthKit implements the same plugin contract).
 */
@CapacitorPlugin(name = "HealthData")
class HealthDataPlugin : Plugin() {

    private val pluginScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var permissionLauncher: ActivityResultLauncher<Set<String>>? = null

    @Volatile
    private var pendingPermissionCall: PluginCall? = null

    @Volatile
    private var pendingRequestedMetrics: List<String> = HealthConnectPolicy.SUPPORTED_METRICS

    override fun load() {
        super.load()
        val host = activity ?: return
        val contract = PermissionController.createRequestPermissionResultContract()
        permissionLauncher = host.registerForActivityResult(contract) { granted ->
            val call = pendingPermissionCall
            val requested = pendingRequestedMetrics
            pendingPermissionCall = null
            if (call == null) return@registerForActivityResult
            val eval = HealthConnectPolicy.evaluatePermissions(requested, granted)
            call.resolve(buildPermissionPayload(eval))
        }
    }

    override fun handleOnDestroy() {
        pendingPermissionCall = null
        pluginScope.cancel()
        super.handleOnDestroy()
    }

    @PluginMethod
    fun getAvailability(call: PluginCall) {
        val status = inspectSdkStatus()
        val spec = HealthConnectPolicy.classifyAvailability(status)
        val payload = JSObject().apply {
            put("available", spec.available)
            put("status", spec.status)
            put("platform", "android")
            put("providerPackage", HealthConnectPolicy.PROVIDER_PACKAGE_NAME)
            put("readOnly", true)
            put("supportedMetrics", toJsArray(HealthConnectPolicy.SUPPORTED_METRICS))
            if (spec.reason != null) {
                put("reason", spec.reason)
            }
        }
        call.resolve(payload)
    }

    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        val spec = HealthConnectPolicy.classifyAvailability(inspectSdkStatus())
        if (!spec.available) {
            call.resolve(
                JSObject().apply {
                    put("status", "unsupported")
                    put("granted", JSArray())
                    put("denied", toJsArray(parseRequestedMetrics(call)))
                    put("readOnly", true)
                }
            )
            return
        }
        val requested = parseRequestedMetrics(call)
        val client = createClientOrNull()
        if (client == null) {
            call.reject("Health Connect 客户端不可用", "UNAVAILABLE")
            return
        }
        pluginScope.launch {
            try {
                val granted = client.permissionController.getGrantedPermissions()
                val eval = HealthConnectPolicy.evaluatePermissions(requested, granted)
                call.resolve(buildPermissionPayload(eval))
            } catch (ex: Exception) {
                Logger.warn("RunNoteHealth", "Failed to check Health Connect permissions: ${ex.javaClass.simpleName}")
                call.reject("无法检查健康数据权限", "PERMISSION_CHECK_FAILED")
            }
        }
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        val spec = HealthConnectPolicy.classifyAvailability(inspectSdkStatus())
        if (!spec.available) {
            call.resolve(
                JSObject().apply {
                    put("status", "unsupported")
                    put("granted", JSArray())
                    put("denied", toJsArray(parseRequestedMetrics(call)))
                    put("readOnly", true)
                }
            )
            return
        }
        if (pendingPermissionCall != null) {
            call.reject("已有正在进行的健康数据授权请求", "REQUEST_IN_PROGRESS")
            return
        }
        val requested = parseRequestedMetrics(call)
        val permissions = HealthConnectPolicy.permissionsForMetrics(requested)
        if (permissions.isEmpty()) {
            call.reject("未选择有效的只读健康指标", "INVALID_METRICS")
            return
        }
        val launcher = permissionLauncher
        if (launcher == null) {
            call.reject("当前页面无法发起健康权限授权", "LAUNCHER_UNAVAILABLE")
            return
        }
        pendingPermissionCall = call
        pendingRequestedMetrics = requested
        activity?.runOnUiThread {
            try {
                launcher.launch(permissions)
            } catch (ex: Exception) {
                pendingPermissionCall = null
                Logger.warn("RunNoteHealth", "Failed to launch Health Connect permission sheet: ${ex.javaClass.simpleName}")
                call.reject("无法打开 Health Connect 授权页面", "PERMISSION_LAUNCH_FAILED")
            }
        } ?: run {
            pendingPermissionCall = null
            call.reject("当前页面不可用", "ACTIVITY_UNAVAILABLE")
        }
    }

    @PluginMethod
    fun readSummary(call: PluginCall) {
        val spec = HealthConnectPolicy.classifyAvailability(inspectSdkStatus())
        if (!spec.available) {
            call.resolve(
                JSObject().apply {
                    put("status", "unsupported")
                    put("readOnly", true)
                    put("grantedMetrics", JSArray())
                }
            )
            return
        }
        val requested = parseRequestedMetrics(call)
        val window = try {
            HealthConnectPolicy.resolveWindow(
                call.getString("startDate"),
                call.getString("endDate"),
                Instant.now()
            )
        } catch (ex: IllegalArgumentException) {
            call.reject("查询时间范围无效", "INVALID_WINDOW")
            return
        }
        val client = createClientOrNull()
        if (client == null) {
            call.reject("Health Connect 客户端不可用", "UNAVAILABLE")
            return
        }
        pluginScope.launch {
            try {
                val grantedPerms = client.permissionController.getGrantedPermissions()
                val eval = HealthConnectPolicy.evaluatePermissions(requested, grantedPerms)
                if (eval.granted.isEmpty()) {
                    call.resolve(
                        JSObject().apply {
                            put("status", "denied")
                            put("windowStart", window.start.toString())
                            put("windowEnd", window.end.toString())
                            put("grantedMetrics", JSArray())
                            put("readOnly", true)
                        }
                    )
                    return@launch
                }

                val range = TimeRangeFilter.between(window.start, window.end)
                val grantedSet = eval.granted.toSet()

                var stepsTotal: Long? = null
                var distanceTotal: Double? = null
                var caloriesTotal: Double? = null
                val aggregateMetrics = buildSet {
                    if ("steps" in grantedSet) add(StepsRecord.COUNT_TOTAL)
                    if ("distance" in grantedSet) add(DistanceRecord.DISTANCE_TOTAL)
                    if ("active_calories" in grantedSet) add(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
                }
                if (aggregateMetrics.isNotEmpty()) {
                    val agg = client.aggregate(AggregateRequest(aggregateMetrics, range))
                    if ("steps" in grantedSet) stepsTotal = agg[StepsRecord.COUNT_TOTAL]
                    if ("distance" in grantedSet) distanceTotal = agg[DistanceRecord.DISTANCE_TOTAL]?.inMeters
                    if ("active_calories" in grantedSet) {
                        caloriesTotal = agg[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories
                    }
                }

                val hrSamples = if ("heart_rate" in grantedSet) {
                    val result = readAllRecords(client, HeartRateRecord::class, range)
                    if (result.truncated) {
                        Logger.warn("RunNoteHealth", "HeartRateRecord pagination reached page limit")
                    }
                    result.records.flatMap { rec -> rec.samples.map { it.beatsPerMinute } }
                } else {
                    null
                }

                val restingSamples = if ("resting_heart_rate" in grantedSet) {
                    val result = readAllRecords(client, RestingHeartRateRecord::class, range)
                    if (result.truncated) {
                        Logger.warn("RunNoteHealth", "RestingHeartRateRecord pagination reached page limit")
                    }
                    result.records.map { it.beatsPerMinute }
                } else {
                    null
                }

                val sleepSeconds = if ("sleep" in grantedSet) {
                    val result = readAllRecords(client, SleepSessionRecord::class, range)
                    if (result.truncated) {
                        Logger.warn("RunNoteHealth", "SleepSessionRecord pagination reached page limit")
                    }
                    result.records.map { Duration.between(it.startTime, it.endTime).seconds }
                } else {
                    null
                }

                val summary = HealthConnectPolicy.aggregateSummary(
                    steps = stepsTotal,
                    distanceMeters = distanceTotal,
                    activeCaloriesKcal = caloriesTotal,
                    heartRateSamplesBpm = hrSamples,
                    restingHeartRateSamplesBpm = restingSamples,
                    sleepDurationsSeconds = sleepSeconds
                )

                val metricsJson = JSObject().apply {
                    summary.steps?.let { put("steps", it) }
                    summary.distanceMeters?.let { put("distanceMeters", it) }
                    summary.activeCaloriesKcal?.let { put("activeCaloriesKcal", it) }
                    summary.restingHeartRateBpm?.let { put("restingHeartRateBpm", it) }
                    summary.sleepMinutes?.let { put("sleepMinutes", it) }
                    summary.heartRate?.let { hr ->
                        put(
                            "heartRate",
                            JSObject().apply {
                                hr.avgBpm?.let { put("avgBpm", it) }
                                hr.minBpm?.let { put("minBpm", it) }
                                hr.maxBpm?.let { put("maxBpm", it) }
                                put("sampleCount", hr.sampleCount)
                            }
                        )
                    }
                }

                call.resolve(
                    JSObject().apply {
                        put("status", if (summary.hasAnyData) "ok" else "empty")
                        put("windowStart", window.start.toString())
                        put("windowEnd", window.end.toString())
                        put("grantedMetrics", toJsArray(eval.granted))
                        put("metrics", metricsJson)
                        put("readOnly", true)
                    }
                )
            } catch (ex: SecurityException) {
                Logger.warn("RunNoteHealth", "Health Connect permission revoked during read")
                call.resolve(
                    JSObject().apply {
                        put("status", "denied")
                        put("windowStart", window.start.toString())
                        put("windowEnd", window.end.toString())
                        put("grantedMetrics", JSArray())
                        put("readOnly", true)
                    }
                )
            } catch (ex: Exception) {
                Logger.warn("RunNoteHealth", "Failed to read Health Connect summary: ${ex.javaClass.simpleName}")
                call.reject("读取设备健康数据失败，请稍后重试", "READ_FAILED")
            }
        }
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        val ctx = context
        val action = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            "android.health.connect.action.MANAGE_HEALTH_PERMISSIONS"
        } else {
            HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS
        }
        val intents = listOf(
            Intent(action).apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    putExtra(Intent.EXTRA_PACKAGE_NAME, ctx.packageName)
                }
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
            Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
            Intent(
                Intent.ACTION_VIEW,
                Uri.parse("market://details?id=${HealthConnectPolicy.PROVIDER_PACKAGE_NAME}")
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
            Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", ctx.packageName, null)
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        )
        for (intent in intents) {
            try {
                ctx.startActivity(intent)
                call.resolve(JSObject().put("opened", true))
                return
            } catch (_: ActivityNotFoundException) {
                // Try next fallback target.
            } catch (_: SecurityException) {
                // Some OEM ROMs guard MANAGE_HEALTH_PERMISSIONS; fall back cleanly.
            }
        }
        call.resolve(JSObject().put("opened", false))
    }

    private suspend fun <T : Record> readAllRecords(
        client: HealthConnectClient,
        recordType: KClass<T>,
        range: TimeRangeFilter
    ): HealthConnectPolicy.PaginatedResult<T> {
        return HealthConnectPolicy.collectPages(HealthConnectPolicy.MAX_READ_PAGES) { token ->
            val response = client.readRecords(
                ReadRecordsRequest(
                    recordType = recordType,
                    timeRangeFilter = range,
                    pageSize = HealthConnectPolicy.READ_PAGE_SIZE,
                    pageToken = token
                )
            )
            HealthConnectPolicy.RecordPage(response.records, response.pageToken)
        }
    }

    private fun inspectSdkStatus(): Int {
        return try {
            HealthConnectClient.getSdkStatus(context, HealthConnectPolicy.PROVIDER_PACKAGE_NAME)
        } catch (_: Throwable) {
            HealthConnectClient.SDK_UNAVAILABLE
        }
    }

    private fun createClientOrNull(): HealthConnectClient? {
        return try {
            HealthConnectClient.getOrCreate(context)
        } catch (_: Throwable) {
            null
        }
    }

    private fun parseRequestedMetrics(call: PluginCall): List<String> {
        val arr = call.getArray("metrics") ?: return HealthConnectPolicy.SUPPORTED_METRICS
        val list = mutableListOf<String>()
        for (i in 0 until arr.length()) {
            val value = arr.optString(i, "")
            if (value.isNotBlank()) list.add(value)
        }
        return HealthConnectPolicy.resolveRequestedMetrics(list)
    }

    private fun buildPermissionPayload(eval: HealthConnectPolicy.PermissionEvaluation): JSObject {
        return JSObject().apply {
            put("status", eval.status)
            put("granted", toJsArray(eval.granted))
            put("denied", toJsArray(eval.denied))
            put("readOnly", true)
        }
    }

    private fun toJsArray(values: List<String>): JSArray {
        val arr = JSArray()
        for (v in values) arr.put(v)
        return arr
    }
}
