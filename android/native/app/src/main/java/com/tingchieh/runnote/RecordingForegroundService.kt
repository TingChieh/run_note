package com.tingchieh.runnote

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.Logger
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Foreground location service keeping GPS recording alive across app backgrounding, screen lock,
 * and Doze while the user is actively recording a run.
 *
 * Security & privacy invariants:
 * - Never logs GPS coordinates, altitude, cookies, or session tokens.
 * - Immediately persists accepted points to app-private disk storage (`allowBackup=false`).
 * - Uses START_NOT_STICKY to comply with Android 14+ foreground service start restrictions;
 *   if killed by the OS, persisted points are recovered cleanly when the user reopens RunNote.
 */
class RecordingForegroundService : Service(), LocationListener {

    companion object {
        const val CHANNEL_ID = "runnote_recording"
        const val NOTIFICATION_ID = 30501

        const val ACTION_START = "com.tingchieh.runnote.action.RECORDING_START"
        const val ACTION_PAUSE = "com.tingchieh.runnote.action.RECORDING_PAUSE"
        const val ACTION_RESUME = "com.tingchieh.runnote.action.RECORDING_RESUME"
        const val ACTION_STOP = "com.tingchieh.runnote.action.RECORDING_STOP"
        const val ACTION_DISCARD = "com.tingchieh.runnote.action.RECORDING_DISCARD"

        const val EXTRA_SESSION_ID = "session_id"
        const val EXTRA_ACCOUNT_ID = "account_id"
        const val EXTRA_IDEMPOTENCY_KEY = "idempotency_key"
        const val EXTRA_TITLE = "title"
        const val EXTRA_RESUME_INTERRUPTED = "resume_interrupted"
        const val EXTRA_CLAIM_REVISION = "claim_revision"
        const val EXTRA_CLAIM_TOKEN = "claim_token"

        private const val GPS_UPDATE_INTERVAL_MS = 1_000L
        private const val HEARTBEAT_INTERVAL_MS = 2_000L

        @Volatile
        var isServiceRunning: Boolean = false
            private set

        @Volatile
        var currentGpsStatus: String = "inactive"
            private set

        @Volatile
        var stateListener: ((LocationRecordingPolicy.SessionRecord?, String) -> Unit)? = null

        private val storesByDir = ConcurrentHashMap<String, LocationRecordingPolicy.RecordingStore>()
        private val coordinatorsByDir = ConcurrentHashMap<String, LocationRecordingPolicy.RecordingSessionCoordinator>()

        @Volatile
        private var runningInstance: RecordingForegroundService? = null

        fun storeFor(context: Context): LocationRecordingPolicy.RecordingStore {
            val dir = File(context.applicationContext.filesDir, "recordings")
            val key = LocationRecordingPolicy.canonicalDirKey(dir)
            return storesByDir.computeIfAbsent(key) { LocationRecordingPolicy.RecordingStore(dir) }
        }

        fun coordinatorFor(context: Context): LocationRecordingPolicy.RecordingSessionCoordinator {
            val dir = File(context.applicationContext.filesDir, "recordings")
            val key = LocationRecordingPolicy.canonicalDirKey(dir)
            val store = storesByDir.computeIfAbsent(key) { LocationRecordingPolicy.RecordingStore(dir) }
            return coordinatorsByDir.computeIfAbsent(key) {
                LocationRecordingPolicy.RecordingSessionCoordinator(store)
            }
        }

        fun stopAndFinalizeSync(
            context: Context,
            timeoutMs: Long = 3_000L,
        ): LocationRecordingPolicy.FinalizedSnapshot? {
            val coordinator = coordinatorFor(context)
            val service = runningInstance
            if (service != null) {
                if (Looper.myLooper() == Looper.getMainLooper()) {
                    return service.freezeAndStopOnMainThread(emitHandoffEvent = false)
                }
                var result: LocationRecordingPolicy.FinalizedSnapshot? = null
                val latch = CountDownLatch(1)
                val posted = service.mainHandler.post {
                    try {
                        result = service.freezeAndStopOnMainThread(emitHandoffEvent = false)
                    } finally {
                        latch.countDown()
                    }
                }
                if (posted) {
                    try {
                        if (latch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
                            return result
                        }
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                    }
                }
            }
            val fallback = coordinator.finalizeAndFreeze(System.currentTimeMillis())
            if (fallback != null) {
                coordinator.claimHandoffEmission(fallback.session.sessionId)
            }
            return fallback
        }

        fun discardSync(context: Context, timeoutMs: Long = 3_000L) {
            val coordinator = coordinatorFor(context)
            val service = runningInstance
            if (service != null) {
                if (Looper.myLooper() == Looper.getMainLooper()) {
                    service.handleDiscard()
                    return
                }
                val latch = CountDownLatch(1)
                val posted = service.mainHandler.post {
                    try {
                        service.handleDiscard()
                    } finally {
                        latch.countDown()
                    }
                }
                if (posted) {
                    try {
                        if (latch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
                            return
                        }
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                    }
                }
            }
            coordinator.discardSession()
        }

        fun stopAndFinalizeForOwnerSync(
            context: Context,
            expectedAccountId: String,
            expectedSessionId: String,
            expectedClaimRevision: Long,
            expectedClaimToken: String? = null,
            timeoutMs: Long = 3_000L,
        ): LocationRecordingPolicy.StopResult {
            val coordinator = coordinatorFor(context)
            val service = runningInstance
            if (service != null) {
                if (Looper.myLooper() == Looper.getMainLooper()) {
                    return service.freezeAndStopForOwnerOnMainThread(
                        expectedAccountId = expectedAccountId,
                        expectedSessionId = expectedSessionId,
                        expectedClaimRevision = expectedClaimRevision,
                        expectedClaimToken = expectedClaimToken,
                        emitHandoffEvent = false,
                    )
                }
                var result: LocationRecordingPolicy.StopResult? = null
                val latch = CountDownLatch(1)
                val posted = service.mainHandler.post {
                    try {
                        result = service.freezeAndStopForOwnerOnMainThread(
                            expectedAccountId = expectedAccountId,
                            expectedSessionId = expectedSessionId,
                            expectedClaimRevision = expectedClaimRevision,
                            expectedClaimToken = expectedClaimToken,
                            emitHandoffEvent = false,
                        )
                    } finally {
                        latch.countDown()
                    }
                }
                if (posted) {
                    try {
                        if (latch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
                            return result ?: LocationRecordingPolicy.StopResult(null, "NO_ACTIVE_SESSION")
                        }
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                    }
                }
            }
            val fallback = coordinator.finalizeAndFreezeForOwner(
                expectedAccountId = expectedAccountId,
                expectedSessionId = expectedSessionId,
                expectedClaimRevision = expectedClaimRevision,
                expectedClaimToken = expectedClaimToken,
                nowMs = System.currentTimeMillis(),
            )
            if (fallback.snapshot != null) {
                coordinator.claimHandoffEmission(fallback.snapshot.session.sessionId)
            }
            return fallback
        }

        fun clearIfAccountMismatchSync(
            context: Context,
            keepAccountId: String?,
            claimRevision: Long? = null,
            claimToken: String? = null,
            timeoutMs: Long = 3_000L,
        ): Boolean {
            val coordinator = coordinatorFor(context)
            val hasMismatch = coordinator.hasAccountMismatch(keepAccountId)
            val service = runningInstance
            if (hasMismatch && service != null) {
                if (Looper.myLooper() == Looper.getMainLooper()) {
                    val cleared = service.handleDiscardIfAccountMismatch(keepAccountId)
                    coordinator.clearIfAccountMismatch(keepAccountId, claimRevision, claimToken)
                    return cleared
                }
                var cleared = false
                val latch = CountDownLatch(1)
                val posted = service.mainHandler.post {
                    try {
                        cleared = service.handleDiscardIfAccountMismatch(keepAccountId)
                    } finally {
                        latch.countDown()
                    }
                }
                if (posted) {
                    try {
                        if (latch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
                            coordinator.clearIfAccountMismatch(keepAccountId, claimRevision, claimToken)
                            return cleared
                        }
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                    }
                }
            }
            return coordinator.clearIfAccountMismatch(keepAccountId, claimRevision, claimToken)
        }

        fun isLocationServicesEnabled(context: Context): Boolean {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
            return try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    lm.isLocationEnabled
                } else {
                    @Suppress("DEPRECATION")
                    lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                        lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
                }
            } catch (_: Exception) {
                false
            }
        }
    }

    private lateinit var store: LocationRecordingPolicy.RecordingStore
    private lateinit var coordinator: LocationRecordingPolicy.RecordingSessionCoordinator
    private var locationManager: LocationManager? = null
    private var lastFixElapsedMs: Long? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var locationSubscribed = false

    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            val session = coordinator.currentSession() ?: return
            if (session.status != "recording" && session.status != "paused") {
                return
            }
            val nowMs = System.currentTimeMillis()
            val hasFine = hasFineLocationPermission()
            val locEnabled = isLocationServicesEnabled(this@RecordingForegroundService)
            if (!hasFine && session.status == "recording") {
                handlePermissionRevokedMidRun(nowMs)
                return
            }
            val ageMs = lastFixElapsedMs?.let { (nowMs - it).coerceAtLeast(0L) }
            currentGpsStatus = LocationRecordingPolicy.classifyGpsSignal(
                status = session.status,
                locationServicesEnabled = locEnabled,
                hasLocationPermission = hasFine,
                lastAccuracyM = session.lastAccuracyM,
                lastFixAgeMs = ageMs,
            )
            updateNotification(session, currentGpsStatus, nowMs)
            emitState(session, currentGpsStatus)
            mainHandler.postDelayed(this, HEARTBEAT_INTERVAL_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        runningInstance = this
        coordinator = coordinatorFor(applicationContext)
        store = coordinator.store
        locationManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        ensureNotificationChannel()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: return START_NOT_STICKY
        when (action) {
            ACTION_START -> handleStart(intent)
            ACTION_PAUSE -> handlePause()
            ACTION_RESUME -> handleResume()
            ACTION_STOP -> handleStop()
            ACTION_DISCARD -> handleDiscard()
        }
        return START_NOT_STICKY
    }

    private fun handleStart(intent: Intent) {
        val nowMs = System.currentTimeMillis()
        if (!hasFineLocationPermission()) {
            Logger.warn("RunNoteRecorder", "Cannot start recording service without precise location permission")
            currentGpsStatus = "permission_denied"
            emitState(coordinator.currentSession(), currentGpsStatus)
            stopSelf()
            return
        }

        val resumeInterrupted = intent.getBooleanExtra(EXTRA_RESUME_INTERRUPTED, false)
        val sessionId = intent.getStringExtra(EXTRA_SESSION_ID).orEmpty()
        val accountId = intent.getStringExtra(EXTRA_ACCOUNT_ID).orEmpty()
        val idempotencyKey = intent.getStringExtra(EXTRA_IDEMPOTENCY_KEY).orEmpty()
        val title = intent.getStringExtra(EXTRA_TITLE).orEmpty()
        val claimRevision = intent.getLongExtra(EXTRA_CLAIM_REVISION, 0L)
        val claimToken = intent.getStringExtra(EXTRA_CLAIM_TOKEN)

        val startRes = coordinator.startSession(
            sessionId = sessionId,
            accountId = accountId,
            idempotencyKey = idempotencyKey,
            title = title,
            resumeInterrupted = resumeInterrupted,
            nowMs = nowMs,
            claimRevision = claimRevision,
            claimToken = claimToken,
        )
        if (startRes.errorCode != null) {
            Logger.warn("RunNoteRecorder", "Rejected recording start: ${startRes.errorCode}")
            if (startRes.session != null) {
                val gps = if (isServiceRunning) currentGpsStatus else "inactive"
                emitState(startRes.session, gps)
            }
            if (!isServiceRunning) {
                stopSelf()
            }
            return
        }
        val session = startRes.session
        if (session == null) {
            Logger.warn("RunNoteRecorder", "Rejected recording start: invalid_state")
            if (!isServiceRunning) {
                stopSelf()
            }
            return
        }

        lastFixElapsedMs = null
        currentGpsStatus = if (isLocationServicesEnabled(this)) "acquiring" else "disabled"

        if (!promoteToForeground(session, currentGpsStatus, nowMs)) {
            val interrupted = coordinator.markInterrupted("foreground_service_denied", nowMs)
            isServiceRunning = false
            emitState(interrupted, "permission_denied")
            stopSelf()
            return
        }

        isServiceRunning = true
        subscribeLocationUpdates()
        scheduleHeartbeat()
        emitState(session, currentGpsStatus)
        Logger.info("RunNoteRecorder", "Recording foreground service started")
    }

    private fun handlePause() {
        val nowMs = System.currentTimeMillis()
        val updated = coordinator.pauseSession(nowMs) ?: return
        unsubscribeLocationUpdates()
        currentGpsStatus = "inactive"
        updateNotification(updated, currentGpsStatus, nowMs)
        emitState(updated, currentGpsStatus)
        Logger.info("RunNoteRecorder", "Recording paused")
    }

    private fun handleResume() {
        val current = coordinator.currentSession() ?: store.loadSession() ?: return
        if (current.status != "paused" && current.status != "interrupted") return
        val nowMs = System.currentTimeMillis()
        if (!hasFineLocationPermission()) {
            handlePermissionRevokedMidRun(nowMs)
            return
        }
        val updated = coordinator.resumeSession(nowMs) ?: return
        lastFixElapsedMs = null
        currentGpsStatus = if (isLocationServicesEnabled(this)) "acquiring" else "disabled"
        if (!isServiceRunning) {
            if (!promoteToForeground(updated, currentGpsStatus, nowMs)) {
                handlePermissionRevokedMidRun(nowMs)
                return
            }
            isServiceRunning = true
        } else {
            updateNotification(updated, currentGpsStatus, nowMs)
        }
        subscribeLocationUpdates()
        scheduleHeartbeat()
        emitState(updated, currentGpsStatus)
        Logger.info("RunNoteRecorder", "Recording resumed on new track segment")
    }

    private fun freezeAndStopForOwnerOnMainThread(
        expectedAccountId: String,
        expectedSessionId: String,
        expectedClaimRevision: Long,
        expectedClaimToken: String?,
        emitHandoffEvent: Boolean,
    ): LocationRecordingPolicy.StopResult {
        val nowMs = System.currentTimeMillis()
        val result = coordinator.finalizeAndFreezeForOwner(
            expectedAccountId = expectedAccountId,
            expectedSessionId = expectedSessionId,
            expectedClaimRevision = expectedClaimRevision,
            expectedClaimToken = expectedClaimToken,
            nowMs = nowMs,
        ) {
            unsubscribeLocationUpdates()
            mainHandler.removeCallbacks(heartbeatRunnable)
        }
        if (result.errorCode != null) {
            Logger.warn("RunNoteRecorder", "Rejected manual recording stop: ${result.errorCode}")
            return result
        }
        val snapshot = result.snapshot
        isServiceRunning = false
        currentGpsStatus = "inactive"
        if (snapshot != null) {
            if (emitHandoffEvent) {
                if (snapshot.newlyFinalized && coordinator.claimHandoffEmission(snapshot.session.sessionId)) {
                    emitState(snapshot.session, currentGpsStatus)
                }
            } else {
                coordinator.claimHandoffEmission(snapshot.session.sessionId)
            }
        }
        stopForegroundCompat()
        stopSelf()
        Logger.info("RunNoteRecorder", "Recording stopped cleanly for owner")
        return result
    }

    private fun freezeAndStopOnMainThread(emitHandoffEvent: Boolean): LocationRecordingPolicy.FinalizedSnapshot? {
        val nowMs = System.currentTimeMillis()
        val snapshot = coordinator.finalizeAndFreeze(nowMs) {
            unsubscribeLocationUpdates()
            mainHandler.removeCallbacks(heartbeatRunnable)
        }
        isServiceRunning = false
        currentGpsStatus = "inactive"
        if (snapshot != null) {
            if (emitHandoffEvent) {
                if (snapshot.newlyFinalized && coordinator.claimHandoffEmission(snapshot.session.sessionId)) {
                    emitState(snapshot.session, currentGpsStatus)
                }
            } else {
                coordinator.claimHandoffEmission(snapshot.session.sessionId)
            }
        }
        stopForegroundCompat()
        stopSelf()
        Logger.info("RunNoteRecorder", "Recording stopped cleanly")
        return snapshot
    }

    private fun handleStop() {
        freezeAndStopOnMainThread(emitHandoffEvent = true)
    }

    private fun handleDiscard() {
        unsubscribeLocationUpdates()
        mainHandler.removeCallbacks(heartbeatRunnable)
        lastFixElapsedMs = null
        coordinator.discardSession()
        isServiceRunning = false
        currentGpsStatus = "inactive"
        emitState(null, currentGpsStatus)
        stopForegroundCompat()
        stopSelf()
        Logger.info("RunNoteRecorder", "Recording discarded")
    }

    private fun handleDiscardIfAccountMismatch(keepAccountId: String?): Boolean {
        if (!coordinator.hasAccountMismatch(keepAccountId)) {
            return false
        }
        handleDiscard()
        return true
    }

    private fun handlePermissionRevokedMidRun(nowMs: Long) {
        Logger.warn("RunNoteRecorder", "Location permission revoked during recording")
        unsubscribeLocationUpdates()
        mainHandler.removeCallbacks(heartbeatRunnable)
        val interrupted = coordinator.markInterrupted("permission_revoked", nowMs)
        isServiceRunning = false
        currentGpsStatus = "permission_denied"
        emitState(interrupted, currentGpsStatus)
        stopForegroundCompat()
        stopSelf()
    }

    override fun onLocationChanged(location: Location) {
        val session = coordinator.currentSession() ?: return
        if (session.status != "recording") return

        val nowMs = System.currentTimeMillis()
        val fixTimeMs = if (location.time > 0L) location.time else nowMs
        val accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null
        val elevation = if (location.hasAltitude()) location.altitude else null

        lastFixElapsedMs = nowMs
        val candidate = LocationRecordingPolicy.RecordedPoint(
            lat = location.latitude,
            lon = location.longitude,
            elevationM = elevation,
            accuracyM = accuracy,
            recordedAtMs = fixTimeMs,
            segmentIndex = session.segmentIndex,
        )
        val recorded = coordinator.recordLocationPoint(candidate) ?: return
        val updated = recorded.session
        currentGpsStatus = LocationRecordingPolicy.classifyGpsSignal(
            status = updated.status,
            locationServicesEnabled = true,
            hasLocationPermission = true,
            lastAccuracyM = accuracy,
            lastFixAgeMs = 0L,
        )
        updateNotification(updated, currentGpsStatus, nowMs)
        emitState(updated, currentGpsStatus)
    }

    override fun onProviderDisabled(provider: String) {
        val session = coordinator.currentSession() ?: return
        if (!isLocationServicesEnabled(this)) {
            currentGpsStatus = "disabled"
            updateNotification(session, currentGpsStatus, System.currentTimeMillis())
            emitState(session, currentGpsStatus)
        }
    }

    override fun onProviderEnabled(provider: String) {
        val session = coordinator.currentSession() ?: return
        if (session.status == "recording" && hasFineLocationPermission()) {
            // Re-register location listeners when device location is re-enabled mid-run.
            unsubscribeLocationUpdates()
            subscribeLocationUpdates()
            currentGpsStatus = "acquiring"
            updateNotification(session, currentGpsStatus, System.currentTimeMillis())
            emitState(session, currentGpsStatus)
        }
    }

    @Deprecated("Deprecated in Android API 29")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {
        // Handled via heartbeat watchdog and onProviderEnabled/onProviderDisabled.
    }

    override fun onDestroy() {
        unsubscribeLocationUpdates()
        mainHandler.removeCallbacks(heartbeatRunnable)
        coordinator.markInterrupted("service_destroyed", System.currentTimeMillis())
        if (runningInstance === this) {
            runningInstance = null
        }
        isServiceRunning = false
        currentGpsStatus = "inactive"
        super.onDestroy()
    }

    private fun subscribeLocationUpdates() {
        if (locationSubscribed) return
        val lm = locationManager ?: return
        if (!hasFineLocationPermission()) return
        try {
            val providers = mutableListOf<String>()
            if (lm.allProviders.contains(LocationManager.GPS_PROVIDER)) {
                providers.add(LocationManager.GPS_PROVIDER)
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                lm.allProviders.contains(LocationManager.FUSED_PROVIDER)
            ) {
                providers.add(LocationManager.FUSED_PROVIDER)
            }
            for (provider in providers) {
                lm.requestLocationUpdates(provider, GPS_UPDATE_INTERVAL_MS, 0f, this, Looper.getMainLooper())
            }
            locationSubscribed = true
        } catch (_: SecurityException) {
            handlePermissionRevokedMidRun(System.currentTimeMillis())
        } catch (ex: Exception) {
            Logger.warn("RunNoteRecorder", "Failed to request location updates: ${ex.javaClass.simpleName}")
        }
    }

    private fun unsubscribeLocationUpdates() {
        if (!locationSubscribed) return
        try {
            locationManager?.removeUpdates(this)
        } catch (_: Exception) {
            // Ignore cleanup errors on teardown.
        }
        locationSubscribed = false
    }

    private fun scheduleHeartbeat() {
        mainHandler.removeCallbacks(heartbeatRunnable)
        mainHandler.postDelayed(heartbeatRunnable, HEARTBEAT_INTERVAL_MS)
    }

    private fun hasFineLocationPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun promoteToForeground(
        session: LocationRecordingPolicy.SessionRecord,
        gpsStatus: String,
        nowMs: Long,
    ): Boolean {
        return try {
            val notification = buildNotification(session, gpsStatus, nowMs)
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                LocationRecordingPolicy.foregroundServiceTypeForApi(Build.VERSION.SDK_INT),
            )
            true
        } catch (ex: SecurityException) {
            Logger.warn("RunNoteRecorder", "Foreground service denied by OS security policy")
            false
        } catch (ex: IllegalStateException) {
            Logger.warn("RunNoteRecorder", "Foreground service start blocked in background state")
            false
        }
    }

    private fun updateNotification(
        session: LocationRecordingPolicy.SessionRecord,
        gpsStatus: String,
        nowMs: Long,
    ) {
        if (!isServiceRunning) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        try {
            nm.notify(NOTIFICATION_ID, buildNotification(session, gpsStatus, nowMs))
        } catch (_: SecurityException) {
            // Notification permission denied on API 33+; foreground service still runs cleanly.
        }
    }

    private fun buildNotification(
        session: LocationRecordingPolicy.SessionRecord,
        gpsStatus: String,
        nowMs: Long,
    ): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val pendingIntent = PendingIntent.getActivity(this, 0, openIntent, pendingFlags)

        val elapsedLabel = LocationRecordingPolicy.formatDurationClock(session.effectiveActiveDurationMs(nowMs))
        val kmLabel = LocationRecordingPolicy.formatPreviewKm(session.previewDistanceM)

        val titleRes = if (session.status == "paused") {
            R.string.recording_notification_paused_title
        } else {
            R.string.recording_notification_title
        }
        val contentText = when (gpsStatus) {
            "disabled" -> getString(R.string.recording_notification_location_off)
            "lost" -> getString(R.string.recording_notification_gps_lost, elapsedLabel)
            "acquiring" -> getString(R.string.recording_notification_acquiring, elapsedLabel)
            else -> getString(R.string.recording_notification_progress, kmLabel, elapsedLabel)
        }

        // Redacted lockscreen version hides distance/elapsed stats until device is unlocked.
        val publicNotification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(titleRes))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setContentIntent(pendingIntent)
            .build()

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(titleRes))
            .setContentText(contentText)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicNotification)
            .setContentIntent(pendingIntent)
            .build()
    }

    private fun ensureNotificationChannel() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.recording_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.recording_channel_desc)
            setShowBadge(false)
        }
        nm.createNotificationChannel(channel)
    }

    private fun stopForegroundCompat() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    }

    private fun emitState(session: LocationRecordingPolicy.SessionRecord?, gpsStatus: String) {
        stateListener?.invoke(session, gpsStatus)
    }
}
