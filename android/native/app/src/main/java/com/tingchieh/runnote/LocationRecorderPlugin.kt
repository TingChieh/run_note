package com.tingchieh.runnote

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Logger
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Platform-neutral Capacitor `LocationRecorder` plugin backed by Android's
 * `RecordingForegroundService` (future iOS builds implement the same contract via Core Location).
 *
 * Security & privacy invariants:
 * - Never logs GPS coordinates, altitude, cookies, or session tokens.
 * - Never writes to backend databases directly; returns captured points to Web UI for GPX
 *   serialization and idempotent upload through RunNote's existing authenticated API.
 */
@CapacitorPlugin(name = "LocationRecorder")
class LocationRecorderPlugin : Plugin() {

    private var permissionLauncher: ActivityResultLauncher<Array<String>>? = null

    @Volatile
    private var pendingPermissionCall: PluginCall? = null

    override fun load() {
        super.load()
        val host = activity ?: return
        permissionLauncher = host.registerForActivityResult(
            ActivityResultContracts.RequestMultiplePermissions()
        ) {
            val call = pendingPermissionCall
            pendingPermissionCall = null
            if (call != null) {
                call.resolve(buildPermissionsPayload())
            }
            pushCurrentStateEvent()
        }
        RecordingForegroundService.stateListener = { session, gpsStatus ->
            notifyListeners("sessionUpdate", buildStatePayload(session, gpsStatus))
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        pushCurrentStateEvent()
    }

    override fun handleOnDestroy() {
        pendingPermissionCall = null
        RecordingForegroundService.stateListener = null
        super.handleOnDestroy()
    }

    @PluginMethod
    fun getCapabilities(call: PluginCall) {
        val payload = JSObject().apply {
            put("platform", "android")
            put("native", true)
            put("backgroundSupported", true)
            put("requiresNotificationPermission", Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            put("locationServicesEnabled", RecordingForegroundService.isLocationServicesEnabled(context))
            put("sdkInt", Build.VERSION.SDK_INT)
        }
        call.resolve(payload)
    }

    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        call.resolve(buildPermissionsPayload())
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        if (pendingPermissionCall != null) {
            call.reject("已有正在进行的定位权限请求", "REQUEST_IN_PROGRESS")
            return
        }
        val launcher = permissionLauncher
        if (launcher == null) {
            call.reject("当前页面无法请求定位权限", "LAUNCHER_UNAVAILABLE")
            return
        }
        pendingPermissionCall = call
        val perms = LocationRecordingPolicy.permissionsToRequest(Build.VERSION.SDK_INT)
        activity?.runOnUiThread {
            try {
                launcher.launch(perms)
            } catch (ex: Exception) {
                pendingPermissionCall = null
                Logger.warn("RunNoteRecorder", "Failed to launch location permission request: ${ex.javaClass.simpleName}")
                call.reject("无法弹出定位权限申请", "PERMISSION_LAUNCH_FAILED")
            }
        } ?: run {
            pendingPermissionCall = null
            call.reject("当前页面不可用", "ACTIVITY_UNAVAILABLE")
        }
    }

    @PluginMethod
    fun openAppSettings(call: PluginCall) {
        val intent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", context.packageName, null),
        ).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
            call.resolve(JSObject().put("opened", true))
        } catch (_: ActivityNotFoundException) {
            call.resolve(JSObject().put("opened", false))
        }
    }

    @PluginMethod
    fun openLocationSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
            call.resolve(JSObject().put("opened", true))
        } catch (_: ActivityNotFoundException) {
            call.resolve(JSObject().put("opened", false))
        }
    }

    @PluginMethod
    fun startSession(call: PluginCall) {
        val eval = inspectPermissions()
        if (eval.locationStatus == "denied") {
            call.reject("尚未授予定位权限，无法开始记录", "LOCATION_PERMISSION_DENIED")
            return
        }
        if (eval.locationStatus == "approximate") {
            call.reject("跑步轨迹记录需要精确位置权限，请开启精确位置", "PRECISE_LOCATION_REQUIRED")
            return
        }
        if (!eval.locationServicesEnabled) {
            call.reject("系统定位服务已关闭，请先开启定位", "LOCATION_SERVICES_DISABLED")
            return
        }

        val resumeInterrupted = call.getBoolean("resumeInterrupted", false) ?: false
        val sessionId = call.getString("sessionId")?.trim().orEmpty()
        val accountId = call.getString("accountId")?.trim().orEmpty()
        val idempotencyKey = call.getString("idempotencyKey")?.trim().orEmpty()
        val title = call.getString("title")?.trim().orEmpty()
        val claimRevision = readPositiveLongArg(call, "claimRevision")
        val claimToken = call.getString("claimToken")?.trim()?.takeIf { it.isNotEmpty() }

        if (!resumeInterrupted && (sessionId.isBlank() || accountId.isBlank() || idempotencyKey.isBlank())) {
            call.reject("缺少记录会话标识", "INVALID_SESSION_ARGS")
            return
        }

        val conflict = RecordingForegroundService.coordinatorFor(context)
            .checkStartConflict(accountId, resumeInterrupted, claimRevision, claimToken)
        if (conflict != null) {
            val message = when (conflict.errorCode) {
                "UNHANDLED_STOPPED_SESSION" -> "存在尚未保存到上传队列的已结束记录，请先完成保存或丢弃"
                "EXISTING_SESSION_ACTIVE" -> "存在尚未保存或丢弃的记录会话，请先恢复、保存或安全丢弃后再开始新记录"
                "ACCOUNT_MISMATCH" -> "当前原生会话属于其他账号，请先完成账号切换清理后再开始记录"
                "STALE_CLAIM" -> "当前登录状态已变更或会话已失效，请刷新页面后再开始记录"
                "NO_RESUMABLE_SESSION" -> "没有可继续的未完成记录会话"
                else -> "当前无法开始新的记录会话"
            }
            if (conflict.session != null && conflict.session.accountId == accountId) {
                val gps = if (RecordingForegroundService.isServiceRunning) {
                    RecordingForegroundService.currentGpsStatus
                } else {
                    "inactive"
                }
                notifyListeners("sessionUpdate", buildStatePayload(conflict.session, gps))
            }
            call.reject(message, conflict.errorCode ?: "START_REJECTED")
            return
        }

        val intent = Intent(context, RecordingForegroundService::class.java).apply {
            action = RecordingForegroundService.ACTION_START
            putExtra(RecordingForegroundService.EXTRA_SESSION_ID, sessionId)
            putExtra(RecordingForegroundService.EXTRA_ACCOUNT_ID, accountId)
            putExtra(RecordingForegroundService.EXTRA_IDEMPOTENCY_KEY, idempotencyKey)
            putExtra(RecordingForegroundService.EXTRA_TITLE, title)
            putExtra(RecordingForegroundService.EXTRA_RESUME_INTERRUPTED, resumeInterrupted)
            if (claimRevision > 0L) {
                putExtra(RecordingForegroundService.EXTRA_CLAIM_REVISION, claimRevision)
            }
            if (claimToken != null) {
                putExtra(RecordingForegroundService.EXTRA_CLAIM_TOKEN, claimToken)
            }
        }

        try {
            ContextCompat.startForegroundService(context, intent)
            call.resolve(JSObject().put("started", true))
        } catch (ex: SecurityException) {
            Logger.warn("RunNoteRecorder", "SecurityException starting recording service")
            call.reject("系统拒绝启动前台定位服务，请检查定位权限", "FOREGROUND_SERVICE_DENIED")
        } catch (ex: IllegalStateException) {
            Logger.warn("RunNoteRecorder", "IllegalStateException starting recording service")
            call.reject("请在前台界面启动跑步记录", "BACKGROUND_START_BLOCKED")
        }
    }

    @PluginMethod
    fun pauseSession(call: PluginCall) {
        sendServiceAction(RecordingForegroundService.ACTION_PAUSE)
        call.resolve(JSObject().put("paused", true))
    }

    @PluginMethod
    fun resumeSession(call: PluginCall) {
        val eval = inspectPermissions()
        if (eval.locationStatus == "denied") {
            call.reject("尚未授予定位权限，无法继续记录", "LOCATION_PERMISSION_DENIED")
            return
        }
        if (eval.locationStatus == "approximate") {
            call.reject("跑步轨迹记录需要精确位置权限，请开启精确位置", "PRECISE_LOCATION_REQUIRED")
            return
        }
        if (!eval.locationServicesEnabled) {
            call.reject("系统定位服务已关闭，请先开启定位", "LOCATION_SERVICES_DISABLED")
            return
        }
        val intent = Intent(context, RecordingForegroundService::class.java).apply {
            action = RecordingForegroundService.ACTION_RESUME
        }
        try {
            if (RecordingForegroundService.isServiceRunning) {
                context.startService(intent)
            } else {
                ContextCompat.startForegroundService(context, intent)
            }
            call.resolve(JSObject().put("resumed", true))
        } catch (_: Exception) {
            call.reject("无法恢复前台定位服务", "RESUME_FAILED")
        }
    }

    @PluginMethod
    fun stopSession(call: PluginCall) {
        val accountId = call.getString("accountId")?.trim().orEmpty()
        val sessionId = call.getString("sessionId")?.trim().orEmpty()
        val claimRevision = readPositiveLongArg(call, "claimRevision")
        val claimToken = call.getString("claimToken")?.trim()?.takeIf { it.isNotEmpty() }
        if (accountId.isBlank() || sessionId.isBlank() || claimRevision <= 0L) {
            call.reject("缺少有效的账号或会话归属凭据，已阻止停止原生记录", "INVALID_STOP_ARGS")
            return
        }
        val stopResult = RecordingForegroundService.stopAndFinalizeForOwnerSync(
            context = context,
            expectedAccountId = accountId,
            expectedSessionId = sessionId,
            expectedClaimRevision = claimRevision,
            expectedClaimToken = claimToken,
        )
        if (stopResult.errorCode != null) {
            val message = when (stopResult.errorCode) {
                "ACCOUNT_MISMATCH" -> "当前原生记录属于其他账号，已阻止停止或读取其他账号数据"
                "SESSION_MISMATCH" -> "当前原生记录会话已变更，已阻止停止其他会话"
                "STALE_CLAIM" -> "当前登录状态已变更或本地记录数据已清理，已阻止停止原生记录"
                "NO_ACTIVE_SESSION" -> "当前没有可停止的原生记录会话"
                else -> "无法确认当前记录归属，已阻止停止原生记录"
            }
            call.reject(message, stopResult.errorCode)
            return
        }
        val snapshot = stopResult.snapshot
        val payload = buildStatePayload(snapshot?.session, "inactive").apply {
            put("points", pointsToJsArray(snapshot?.points ?: emptyList()))
        }
        call.resolve(payload)
    }

    @PluginMethod
    fun acknowledgeHandoff(call: PluginCall) {
        val sessionId = call.getString("sessionId")?.trim().orEmpty()
        val accountId = call.getString("accountId")?.trim().orEmpty()
        val claimRevision = readPositiveLongArg(call, "claimRevision")
        val claimToken = call.getString("claimToken")?.trim()?.takeIf { it.isNotEmpty() }
        val cleared = RecordingForegroundService.coordinatorFor(context)
            .acknowledgeHandoff(sessionId, accountId, claimRevision, claimToken)
        call.resolve(JSObject().put("acknowledged", cleared))
    }

    @PluginMethod
    fun syncAccountClaim(call: PluginCall) {
        val accountId = call.getString("accountId")?.trim()?.takeIf { it.isNotEmpty() }
        val claimRevision = readPositiveLongArg(call, "claimRevision")
        val claimToken = call.getString("claimToken")?.trim()?.takeIf { it.isNotEmpty() }
        val synced = RecordingForegroundService.coordinatorFor(context)
            .syncAccountClaim(accountId, claimRevision, claimToken)
        call.resolve(JSObject().put("synced", synced))
    }

    @PluginMethod
    fun revokeAccountClaim(call: PluginCall) {
        val accountId = call.getString("accountId")?.trim()?.takeIf { it.isNotEmpty() }
        val claimRevision = readPositiveLongArg(call, "claimRevision")
        val revoked = RecordingForegroundService.coordinatorFor(context)
            .revokeAccountClaim(accountId, claimRevision)
        call.resolve(JSObject().put("revoked", revoked))
    }

    @PluginMethod
    fun discardSession(call: PluginCall) {
        RecordingForegroundService.discardSync(context)
        call.resolve(JSObject().put("discarded", true))
    }

    @PluginMethod
    fun getSessionState(call: PluginCall) {
        val accountId = call.getString("accountId")?.trim()
        val coordinator = RecordingForegroundService.coordinatorFor(context)
        val reconciled = coordinator.loadReconciledSessionForAccount(
            accountId,
            RecordingForegroundService.isServiceRunning,
        )
        val gpsStatus = if (RecordingForegroundService.isServiceRunning && reconciled != null) {
            RecordingForegroundService.currentGpsStatus
        } else {
            "inactive"
        }
        call.resolve(buildStatePayload(reconciled, gpsStatus))
    }

    @PluginMethod
    fun getSessionPoints(call: PluginCall) {
        val accountId = call.getString("accountId")?.trim()
        val afterIndex = (call.getInt("afterIndex", 0) ?: 0).coerceAtLeast(0)
        val points = RecordingForegroundService.coordinatorFor(context).loadPointsForAccount(accountId, afterIndex)
        call.resolve(
            JSObject().apply {
                put("points", pointsToJsArray(points))
                put("totalReturned", points.size)
            }
        )
    }

    @PluginMethod
    fun clearAccountSessions(call: PluginCall) {
        val keepAccountId = call.getString("keepAccountId")?.trim()
        val claimRevision = readPositiveLongArg(call, "claimRevision").takeIf { it > 0L }
        val claimToken = call.getString("claimToken")?.trim()?.takeIf { it.isNotEmpty() }
        val cleared = RecordingForegroundService.clearIfAccountMismatchSync(
            context = context,
            keepAccountId = keepAccountId,
            claimRevision = claimRevision,
            claimToken = claimToken,
        )
        call.resolve(JSObject().put("cleared", cleared))
    }

    private fun readPositiveLongArg(call: PluginCall, key: String): Long {
        val raw = call.data?.opt(key) ?: return 0L
        val parsed = when (raw) {
            is Number -> raw.toLong()
            is String -> raw.trim().toLongOrNull() ?: 0L
            else -> 0L
        }
        return if (parsed > 0L) parsed else 0L
    }

    private fun sendServiceAction(actionName: String) {
        val intent = Intent(context, RecordingForegroundService::class.java).apply {
            action = actionName
        }
        try {
            context.startService(intent)
        } catch (_: Exception) {
            // Service already stopped; state reconciled via disk store.
        }
    }

    private fun pushCurrentStateEvent() {
        val coordinator = RecordingForegroundService.coordinatorFor(context)
        val reconciled = coordinator.loadReconciledSessionForAccount(
            null,
            RecordingForegroundService.isServiceRunning,
        )
        val gpsStatus = if (RecordingForegroundService.isServiceRunning) {
            RecordingForegroundService.currentGpsStatus
        } else {
            "inactive"
        }
        notifyListeners("sessionUpdate", buildStatePayload(reconciled, gpsStatus))
    }

    private fun inspectPermissions(): LocationRecordingPolicy.PermissionEvaluation {
        val hasFine = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        val hasNotif = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
        return LocationRecordingPolicy.evaluatePermissions(
            hasFineLocation = hasFine,
            hasCoarseLocation = hasCoarse,
            sdkInt = Build.VERSION.SDK_INT,
            hasNotifications = hasNotif,
            locationServicesEnabled = RecordingForegroundService.isLocationServicesEnabled(context),
        )
    }

    private fun buildPermissionsPayload(): JSObject {
        val eval = inspectPermissions()
        return JSObject().apply {
            put("location", eval.locationStatus)
            put("notification", eval.notificationStatus)
            put("locationServicesEnabled", eval.locationServicesEnabled)
            put("preciseLocation", eval.preciseLocation)
            put("canRecord", eval.canRecord)
        }
    }

    private fun buildStatePayload(
        session: LocationRecordingPolicy.SessionRecord?,
        gpsStatus: String,
    ): JSObject {
        val nowMs = System.currentTimeMillis()
        val permissions = buildPermissionsPayload()
        return JSObject().apply {
            put("serviceRunning", RecordingForegroundService.isServiceRunning)
            put("gpsStatus", gpsStatus)
            put("permissions", permissions)
            if (session == null) {
                put("status", "idle")
                put("session", JSObject.NULL)
            } else {
                put("status", session.status)
                put(
                    "session",
                    JSObject().apply {
                        put("sessionId", session.sessionId)
                        put("accountId", session.accountId)
                        put("idempotencyKey", session.idempotencyKey)
                        put("title", session.title)
                        put("status", session.status)
                        put("startedAtMs", session.startedAtMs)
                        if (session.endedAtMs != null) put("endedAtMs", session.endedAtMs)
                        put("activeDurationMs", session.effectiveActiveDurationMs(nowMs))
                        put("segmentIndex", session.segmentIndex)
                        put("pointCount", session.pointCount)
                        put("previewDistanceM", session.previewDistanceM)
                        if (session.lastPointTimeMs != null) put("lastPointTimeMs", session.lastPointTimeMs)
                        if (session.lastAccuracyM != null) put("lastAccuracyM", session.lastAccuracyM)
                        if (session.interruptedReason != null) put("interruptedReason", session.interruptedReason)
                    }
                )
            }
        }
    }

    private fun pointsToJsArray(points: List<LocationRecordingPolicy.RecordedPoint>): JSArray {
        val arr = JSArray()
        for (p in points) {
            arr.put(
                JSObject().apply {
                    put("lat", p.lat)
                    put("lon", p.lon)
                    if (p.elevationM != null) put("elevationM", p.elevationM)
                    if (p.accuracyM != null) put("accuracyM", p.accuracyM)
                    put("recordedAtMs", p.recordedAtMs)
                    put("segmentIndex", p.segmentIndex)
                }
            )
        }
        return arr
    }
}
