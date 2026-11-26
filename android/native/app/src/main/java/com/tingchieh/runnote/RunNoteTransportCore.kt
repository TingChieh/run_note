package com.tingchieh.runnote

import okhttp3.ConnectionSpec
import okhttp3.CookieJar
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.time.Clock
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.Locale
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

data class ServerConfigView(
    val serverUrl: String?,
    val defaultServerUrl: String?,
    val valid: Boolean,
    val reason: String?,
)

data class PublicSessionStateView(
    val state: SessionLifecycleState,
    val serverUrl: String?,
    val serverOriginHash: String?,
    val accountId: String?,
    val userJson: String?,
)

data class LoginOutcome(
    val ok: Boolean,
    val status: Int,
    val userJson: String? = null,
    val errorCode: String? = null,
    val errorMessage: String? = null,
    val retryAfterSeconds: Int? = null,
)

data class CapabilitiesOutcome(
    val ok: Boolean,
    val status: Int,
    val capabilitiesJson: String? = null,
    val errorCode: String? = null,
    val errorMessage: String? = null,
)

data class TransportHttpResponse(
    val status: Int,
    val ok: Boolean,
    val headers: Map<String, String>,
    val body: String,
    val sessionState: SessionLifecycleState,
    val errorCode: String? = null,
    val errorMessage: String? = null,
)

/**
 * Pure Kotlin authenticated HTTP transport for the local-bundled mobile shell:
 * - Strict system TLS (TLS 1.2/1.3) with zero certificate bypass.
 * - Automatic redirect following disabled so Authorization headers never cross redirect hops.
 * - CookieJar disabled so WebView and native transport never mix cookies with Bearer auth.
 * - Single-flight refresh rotation serialized with logout via monotonic session epochs so an
 *   in-flight refresh or login can never resurrect a logged-out session.
 * - Access and refresh tokens remain inside [TransportVault] and are never returned to WebView JS.
 */
class RunNoteTransportCore(
    private val vault: TransportVault,
    private val defaultServerUrl: String?,
    private val allowDebugLoopbackHttp: Boolean,
    private val appVersion: String,
    private val clock: Clock = Clock.systemUTC(),
    clientOverride: OkHttpClient? = null,
) {
    private val client: OkHttpClient = clientOverride ?: buildHardenedClient(allowDebugLoopbackHttp)
    private val refreshLock = Any()
    private val vaultMutationLock = Any()
    private val sessionEpoch = AtomicLong(0L)
    private var supersededRefreshAccessToken: String? = null
    private var supersededRefreshServerUrl: String? = null

    fun getServerConfig(): ServerConfigView {
        val stored = vault.read().serverUrl
        val candidate = stored ?: defaultServerUrl
        val validated = ServerUrlPolicy.validate(candidate, allowDebugLoopbackHttp)
        val defaultValidated = ServerUrlPolicy.validate(defaultServerUrl, allowDebugLoopbackHttp)
        return ServerConfigView(
            serverUrl = if (validated.valid) validated.normalizedUrl else null,
            defaultServerUrl = if (defaultValidated.valid) defaultValidated.normalizedUrl else null,
            valid = validated.valid,
            reason = validated.reason,
        )
    }

    fun getPublicSessionState(): PublicSessionStateView {
        val snap = vault.read()
        val effectiveServer = snap.serverUrl ?: getServerConfig().serverUrl
        return PublicSessionStateView(
            state = snap.state,
            serverUrl = effectiveServer,
            serverOriginHash = snap.serverOriginHash ?: effectiveServer?.let { sha256Hex(it) },
            accountId = snap.accountId,
            userJson = snap.userJson,
        )
    }

    fun checkCapabilities(): CapabilitiesOutcome {
        val server = requireValidatedServerUrl()
            ?: return CapabilitiesOutcome(
                ok = false,
                status = 0,
                errorCode = "SERVER_URL_INVALID",
                errorMessage = "未配置有效的 RunNote 服务器地址",
            )
        val request = Request.Builder()
            .url(server + CAPABILITIES_PATH)
            .get()
            .header("Accept", "application/json")
            .build()
        return try {
            client.newCall(request).execute().use { response ->
                val rawBody = response.body?.string().orEmpty()
                if (response.code == 404) {
                    return CapabilitiesOutcome(
                        ok = false,
                        status = 404,
                        errorCode = "SERVER_TOO_OLD",
                        errorMessage = "该服务器版本过旧，请升级 RunNote 服务端后再试",
                    )
                }
                val parsed = parseJsonObjectOrNull(rawBody)
                val data = parsed?.optJSONObject("data")
                if (response.isSuccessful && data != null) {
                    CapabilitiesOutcome(
                        ok = true,
                        status = response.code,
                        capabilitiesJson = data.toString(),
                    )
                } else {
                    val err = parsed?.optJSONObject("error")
                    CapabilitiesOutcome(
                        ok = false,
                        status = response.code,
                        errorCode = err?.optString("code")?.takeIf { it.isNotBlank() } ?: "REQUEST_FAILED",
                        errorMessage = err?.optString("message")?.takeIf { it.isNotBlank() } ?: "无法读取服务端能力",
                    )
                }
            }
        } catch (_: IOException) {
            CapabilitiesOutcome(
                ok = false,
                status = 503,
                errorCode = "NETWORK_ERROR",
                errorMessage = "无法连接 RunNote 服务，请检查网络后重试",
            )
        }
    }

    fun login(
        email: String,
        password: String,
        deviceLabel: String = "RunNote Android",
        clientVersion: String = appVersion,
    ): LoginOutcome {
        val server = requireValidatedServerUrl()
            ?: return LoginOutcome(
                ok = false,
                status = 0,
                errorCode = "SERVER_URL_INVALID",
                errorMessage = "未配置有效的 RunNote 服务器地址",
            )

        val loginEpoch = sessionEpoch.incrementAndGet()
        val payload = JSONObject()
            .put("email", email)
            .put("password", password)
            .put("device_label", deviceLabel.take(80))
            .put("client_version", clientVersion.take(32))
            .toString()

        val request = Request.Builder()
            .url(server + LOGIN_PATH)
            .post(payload.toRequestBody(JSON_MEDIA_TYPE))
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .build()

        return try {
            client.newCall(request).execute().use { response ->
                val rawBody = response.body?.string().orEmpty()
                val parsed = parseJsonObjectOrNull(rawBody)
                if (!response.isSuccessful) {
                    val err = parsed?.optJSONObject("error")
                    val retryAfter = response.header("Retry-After")?.trim()?.toIntOrNull()
                    return LoginOutcome(
                        ok = false,
                        status = response.code,
                        errorCode = err?.optString("code")?.takeIf { it.isNotBlank() } ?: "LOGIN_FAILED",
                        errorMessage = err?.optString("message")?.takeIf { it.isNotBlank() }
                            ?: "登录失败，请检查邮箱与密码",
                        retryAfterSeconds = retryAfter,
                    )
                }
                val data = parsed?.optJSONObject("data")
                val accessToken = data?.optString("access_token")?.takeIf { it.isNotBlank() }
                val refreshToken = data?.optString("refresh_token")?.takeIf { it.isNotBlank() }
                val accessExpiresAt = data?.optString("access_expires_at")?.takeIf { it.isNotBlank() }
                val refreshExpiresAt = data?.optString("refresh_expires_at")?.takeIf { it.isNotBlank() }
                val userObj = data?.optJSONObject("user")
                val accountId = userObj?.optString("id")?.takeIf { it.isNotBlank() }
                if (accessToken == null || refreshToken == null || accessExpiresAt == null ||
                    refreshExpiresAt == null || userObj == null || accountId == null
                ) {
                    return LoginOutcome(
                        ok = false,
                        status = 502,
                        errorCode = "INVALID_RESPONSE",
                        errorMessage = "认证服务返回了无效响应",
                    )
                }
                val saved = synchronized(vaultMutationLock) {
                    if (sessionEpoch.get() != loginEpoch) {
                        false
                    } else {
                        vault.saveActiveSession(
                            serverUrl = server,
                            accountId = accountId,
                            accessToken = accessToken,
                            accessExpiresAtIso = accessExpiresAt,
                            refreshToken = refreshToken,
                            refreshExpiresAtIso = refreshExpiresAt,
                            userJson = userObj.toString(),
                        )
                        true
                    }
                }
                if (!saved) {
                    sendServerLogout(server, accessToken, revokeAllDevices = false)
                    return LoginOutcome(
                        ok = false,
                        status = 409,
                        errorCode = "SESSION_SUPERSEDED",
                        errorMessage = "登录已被取消，请重试",
                    )
                }
                LoginOutcome(
                    ok = true,
                    status = response.code,
                    userJson = userObj.toString(),
                )
            }
        } catch (_: IOException) {
            LoginOutcome(
                ok = false,
                status = 503,
                errorCode = "NETWORK_ERROR",
                errorMessage = "无法连接 RunNote 服务，请检查网络后重试",
            )
        }
    }

    fun logout(revokeAllDevices: Boolean = false): Pair<Boolean, Int> {
        // Bump epoch BEFORE waiting on refreshLock so any in-flight refresh discards its vault write.
        sessionEpoch.incrementAndGet()
        synchronized(refreshLock) {
            val snap: TransportSessionSnapshot
            val server: String?
            val supersededAccess: String?
            synchronized(vaultMutationLock) {
                snap = vault.read()
                server = snap.serverUrl?.let {
                    ServerUrlPolicy.validate(it, allowDebugLoopbackHttp).normalizedUrl
                } ?: requireValidatedServerUrl()
                supersededAccess = if (supersededRefreshServerUrl == server) {
                    supersededRefreshAccessToken
                } else {
                    null
                }
                supersededRefreshAccessToken = null
                supersededRefreshServerUrl = null
                // Clear local credentials immediately so logout succeeds even when offline.
                vault.clearSession(preserveServerUrl = server)
            }

            if (server == null) {
                return true to 200
            }

            val refreshToken = snap.refreshToken
            var accessToken = supersededAccess ?: snap.accessToken
            var refreshedDuringLogout = supersededAccess != null

            // If the stored access token is already expired (>30m idle), rotate once via refresh
            // (without writing back to the vault) so server-side logout actually revokes the family.
            if (!refreshedDuringLogout && needsProactiveRefresh(snap) && !refreshToken.isNullOrBlank()) {
                val exchanged = exchangeRefreshForLogout(server, refreshToken)
                if (exchanged != null) {
                    accessToken = exchanged
                    refreshedDuringLogout = true
                }
            }

            if (accessToken.isNullOrBlank()) {
                return true to 200
            }

            var status = sendServerLogout(server, accessToken, revokeAllDevices)
            if (status == 401 && !refreshedDuringLogout && !refreshToken.isNullOrBlank()) {
                val exchanged = exchangeRefreshForLogout(server, refreshToken)
                if (exchanged != null) {
                    status = sendServerLogout(server, exchanged, revokeAllDevices)
                }
            }
            return true to status
        }
    }

    fun executeApiRequest(
        method: String,
        path: String,
        headers: Map<String, String> = emptyMap(),
        body: String? = null,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS,
    ): TransportHttpResponse {
        val normalizedMethod = method.trim().uppercase(Locale.ROOT)
        if (normalizedMethod !in ALLOWED_METHODS) {
            return errorResponse(400, "INVALID_METHOD", "不支持的 HTTP 方法", vault.read().state)
        }
        if (!isValidApiPath(path)) {
            return errorResponse(400, "INVALID_API_PATH", "仅允许请求本站 /api/ 路径", vault.read().state)
        }
        val server = requireValidatedServerUrl()
            ?: return errorResponse(0, "SERVER_URL_INVALID", "未配置有效的 RunNote 服务器地址", vault.read().state)

        val isPublic = path == CAPABILITIES_PATH || path.startsWith("$CAPABILITIES_PATH?")
        var usedAccessToken: String? = null
        val startEpoch = sessionEpoch.get()

        if (!isPublic) {
            var snap = vault.read()
            if (snap.state == SessionLifecycleState.ACTIVE && needsProactiveRefresh(snap)) {
                val outcome = refreshSingleFlight(server, expectedAccessToken = snap.accessToken, expectedEpoch = startEpoch)
                if (outcome == RefreshOutcome.REAUTH_REQUIRED || outcome == RefreshOutcome.SIGNED_OUT) {
                    return errorResponse(401, "AUTH_REQUIRED", "登录已过期，请重新登录", vault.read().state)
                }
                snap = vault.read()
            }
            if (snap.state == SessionLifecycleState.ACTIVE) {
                usedAccessToken = snap.accessToken
            }
        }

        val first = performSingleCall(server, normalizedMethod, path, headers, body, usedAccessToken, timeoutMs)
            ?: return errorResponse(503, "NETWORK_ERROR", "无法连接 RunNote 服务，请检查网络后重试", vault.read().state)

        if (!isPublic && first.status == 401 && usedAccessToken != null) {
            return when (refreshSingleFlight(server, expectedAccessToken = usedAccessToken, expectedEpoch = startEpoch)) {
                RefreshOutcome.REFRESHED -> {
                    val freshToken = vault.read().accessToken
                    val retry = performSingleCall(server, normalizedMethod, path, headers, body, freshToken, timeoutMs)
                        ?: return errorResponse(503, "NETWORK_ERROR", "无法连接 RunNote 服务，请检查网络后重试", vault.read().state)
                    retry
                }
                RefreshOutcome.REAUTH_REQUIRED, RefreshOutcome.SIGNED_OUT -> {
                    errorResponse(401, "AUTH_REQUIRED", "登录已过期，请重新登录", vault.read().state)
                }
                RefreshOutcome.TRANSIENT_FAILURE -> {
                    errorResponse(503, "NETWORK_ERROR", "无法刷新登录会话，请检查网络后重试", vault.read().state)
                }
            }
        }

        return first
    }

    private enum class RefreshOutcome {
        REFRESHED,
        REAUTH_REQUIRED,
        SIGNED_OUT,
        TRANSIENT_FAILURE,
    }

    private fun refreshSingleFlight(
        server: String,
        expectedAccessToken: String?,
        expectedEpoch: Long,
    ): RefreshOutcome {
        synchronized(refreshLock) {
            if (sessionEpoch.get() != expectedEpoch) {
                return RefreshOutcome.SIGNED_OUT
            }
            val current = vault.read()
            if (current.state != SessionLifecycleState.ACTIVE) {
                return if (current.state == SessionLifecycleState.SIGNED_OUT) {
                    RefreshOutcome.SIGNED_OUT
                } else {
                    RefreshOutcome.REAUTH_REQUIRED
                }
            }
            if (!current.accessToken.isNullOrBlank() &&
                current.accessToken != expectedAccessToken &&
                !needsProactiveRefresh(current)
            ) {
                // Another concurrent request already rotated the tokens cleanly.
                return RefreshOutcome.REFRESHED
            }
            val refreshToken = current.refreshToken
            if (refreshToken.isNullOrBlank()) {
                synchronized(vaultMutationLock) {
                    if (sessionEpoch.get() == expectedEpoch) {
                        vault.markReauthRequired(current.serverUrl ?: server, current.accountId)
                    }
                }
                return RefreshOutcome.REAUTH_REQUIRED
            }
            val payload = JSONObject()
                .put("refresh_token", refreshToken)
                .put("client_version", appVersion.take(32))
                .toString()
            val req = Request.Builder()
                .url(server + REFRESH_PATH)
                .post(payload.toRequestBody(JSON_MEDIA_TYPE))
                .header("Accept", "application/json")
                .header("Content-Type", "application/json")
                .build()
            return try {
                client.newCall(req).execute().use { resp ->
                    val rawBody = resp.body?.string().orEmpty()
                    if (resp.code == 401 || resp.code == 403) {
                        synchronized(vaultMutationLock) {
                            if (sessionEpoch.get() != expectedEpoch) {
                                return RefreshOutcome.SIGNED_OUT
                            }
                            vault.markReauthRequired(current.serverUrl ?: server, current.accountId)
                        }
                        return RefreshOutcome.REAUTH_REQUIRED
                    }
                    if (!resp.isSuccessful) {
                        return RefreshOutcome.TRANSIENT_FAILURE
                    }
                    val parsed = parseJsonObjectOrNull(rawBody)
                    val data = parsed?.optJSONObject("data")
                    val nextAccess = data?.optString("access_token")?.takeIf { it.isNotBlank() }
                    val nextRefresh = data?.optString("refresh_token")?.takeIf { it.isNotBlank() }
                    val nextAccessExp = data?.optString("access_expires_at")?.takeIf { it.isNotBlank() }
                    val nextRefreshExp = data?.optString("refresh_expires_at")?.takeIf { it.isNotBlank() }
                    val userObj = data?.optJSONObject("user")
                    val nextAccountId = userObj?.optString("id")?.takeIf { it.isNotBlank() } ?: current.accountId
                    if (nextAccess == null || nextRefresh == null || nextAccessExp == null ||
                        nextRefreshExp == null || nextAccountId == null
                    ) {
                        return RefreshOutcome.TRANSIENT_FAILURE
                    }
                    synchronized(vaultMutationLock) {
                        if (sessionEpoch.get() != expectedEpoch) {
                            // Logout ran while this refresh was in flight: do not restore the
                            // session; hand off the fresh access token so logout revokes it.
                            supersededRefreshAccessToken = nextAccess
                            supersededRefreshServerUrl = server
                            return RefreshOutcome.SIGNED_OUT
                        }
                        vault.saveActiveSession(
                            serverUrl = server,
                            accountId = nextAccountId,
                            accessToken = nextAccess,
                            accessExpiresAtIso = nextAccessExp,
                            refreshToken = nextRefresh,
                            refreshExpiresAtIso = nextRefreshExp,
                            userJson = userObj?.toString() ?: current.userJson.orEmpty(),
                        )
                    }
                    RefreshOutcome.REFRESHED
                }
            } catch (_: IOException) {
                RefreshOutcome.TRANSIENT_FAILURE
            }
        }
    }

    private fun exchangeRefreshForLogout(server: String, refreshToken: String): String? {
        val payload = JSONObject()
            .put("refresh_token", refreshToken)
            .put("client_version", appVersion.take(32))
            .toString()
        val req = Request.Builder()
            .url(server + REFRESH_PATH)
            .post(payload.toRequestBody(JSON_MEDIA_TYPE))
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .build()
        return try {
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return null
                val parsed = parseJsonObjectOrNull(resp.body?.string().orEmpty())
                parsed?.optJSONObject("data")?.optString("access_token")?.takeIf { it.isNotBlank() }
            }
        } catch (_: IOException) {
            null
        }
    }

    private fun sendServerLogout(server: String, accessToken: String, revokeAllDevices: Boolean): Int {
        val payload = JSONObject().put("revoke_all_devices", revokeAllDevices).toString()
        val req = Request.Builder()
            .url(server + LOGOUT_PATH)
            .post(payload.toRequestBody(JSON_MEDIA_TYPE))
            .header("Authorization", "Bearer $accessToken")
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .build()
        return try {
            client.newCall(req).execute().use { resp -> resp.code }
        } catch (_: IOException) {
            0
        }
    }

    private fun performSingleCall(
        server: String,
        method: String,
        path: String,
        callerHeaders: Map<String, String>,
        body: String?,
        accessToken: String?,
        timeoutMs: Long,
    ): TransportHttpResponse? {
        val builder = Request.Builder().url(server + path)
        for ((k, v) in callerHeaders) {
            val lower = k.trim().lowercase(Locale.ROOT)
            if (lower.isEmpty() || lower in BLOCKED_CALLER_HEADERS) continue
            builder.header(k.trim(), v)
        }
        if (callerHeaders.keys.none { it.equals("Accept", ignoreCase = true) }) {
            builder.header("Accept", "application/json")
        }
        if (!accessToken.isNullOrBlank()) {
            builder.header("Authorization", "Bearer $accessToken")
        }

        val requestBody = when (method) {
            "GET", "HEAD" -> null
            "DELETE" -> body?.toRequestBody(JSON_MEDIA_TYPE)
            else -> (body ?: "").toRequestBody(JSON_MEDIA_TYPE)
        }
        builder.method(method, requestBody)

        val boundedTimeout = timeoutMs.coerceIn(1000L, 60_000L)
        val callClient = if (boundedTimeout == DEFAULT_TIMEOUT_MS) {
            client
        } else {
            client.newBuilder()
                .callTimeout(boundedTimeout, TimeUnit.MILLISECONDS)
                .build()
        }

        return try {
            callClient.newCall(builder.build()).execute().use { response ->
                val rawBody = response.body?.string().orEmpty()
                val safeHeaders = LinkedHashMap<String, String>()
                for (i in 0 until response.headers.size) {
                    val name = response.headers.name(i)
                    val lower = name.lowercase(Locale.ROOT)
                    if (lower == "set-cookie" || lower == "set-cookie2") continue
                    safeHeaders[lower] = response.headers.value(i)
                }
                TransportHttpResponse(
                    status = response.code,
                    ok = response.isSuccessful,
                    headers = safeHeaders,
                    body = rawBody,
                    sessionState = vault.read().state,
                )
            }
        } catch (_: IOException) {
            null
        }
    }

    private fun needsProactiveRefresh(snap: TransportSessionSnapshot): Boolean {
        if (snap.accessToken.isNullOrBlank()) return true
        val raw = snap.accessExpiresAtIso ?: return true
        val expiresAt = try {
            Instant.parse(raw)
        } catch (_: DateTimeParseException) {
            return true
        }
        return !clock.instant().plusSeconds(PROACTIVE_REFRESH_SKEW_SECONDS).isBefore(expiresAt)
    }

    private fun requireValidatedServerUrl(): String? {
        val candidate = vault.read().serverUrl ?: defaultServerUrl
        val check = ServerUrlPolicy.validate(candidate, allowDebugLoopbackHttp)
        return if (check.valid) check.normalizedUrl else null
    }

    private fun errorResponse(
        status: Int,
        code: String,
        message: String,
        sessionState: SessionLifecycleState,
    ): TransportHttpResponse {
        val envelope = JSONObject()
            .put("data", JSONObject.NULL)
            .put(
                "error",
                JSONObject()
                    .put("code", code)
                    .put("message", message),
            )
            .toString()
        return TransportHttpResponse(
            status = status,
            ok = false,
            headers = mapOf("content-type" to "application/json"),
            body = envelope,
            sessionState = sessionState,
            errorCode = code,
            errorMessage = message,
        )
    }

    companion object {
        const val CAPABILITIES_PATH = "/api/v1/client/capabilities"
        const val LOGIN_PATH = "/api/v1/mobile/auth/login"
        const val REFRESH_PATH = "/api/v1/mobile/auth/refresh"
        const val LOGOUT_PATH = "/api/v1/mobile/auth/logout"
        const val DEFAULT_TIMEOUT_MS = 12_000L
        private const val PROACTIVE_REFRESH_SKEW_SECONDS = 60L

        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        private val ALLOWED_METHODS = setOf("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD")
        private val BLOCKED_CALLER_HEADERS = setOf("authorization", "cookie", "x-csrf-token", "host", "origin", "referer")

        @JvmStatic
        fun isValidApiPath(path: String?): Boolean {
            if (path.isNullOrEmpty()) return false
            if (!path.startsWith("/api/") || path.startsWith("//")) return false
            if (path.contains("..")) return false
            for (ch in path) {
                if (ch.code < 0x21 || ch.code == 0x7F) return false
            }
            return true
        }

        @JvmStatic
        fun buildHardenedClient(allowDebugLoopbackHttp: Boolean): OkHttpClient {
            val specs = if (allowDebugLoopbackHttp) {
                listOf(ConnectionSpec.MODERN_TLS, ConnectionSpec.CLEARTEXT)
            } else {
                listOf(ConnectionSpec.MODERN_TLS)
            }
            return OkHttpClient.Builder()
                .connectionSpecs(specs)
                .followRedirects(false)
                .followSslRedirects(false)
                .cookieJar(CookieJar.NO_COOKIES)
                .connectTimeout(8, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .writeTimeout(15, TimeUnit.SECONDS)
                .callTimeout(DEFAULT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                .build()
        }

        private fun parseJsonObjectOrNull(raw: String): JSONObject? {
            if (raw.isBlank()) return null
            return try {
                JSONObject(raw)
            } catch (_: Exception) {
                null
            }
        }
    }
}
