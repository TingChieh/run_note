package com.tingchieh.runnote

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Native Capacitor transport bridge for RunNote's local-bundled mobile shell.
 * Keeps Bearer access/refresh tokens strictly inside Android Keystore and executes API calls
 * through OkHttp with system TLS verification and disabled redirect Authorization forwarding.
 */
@CapacitorPlugin(name = "RunNoteTransport")
class RunNoteTransportPlugin : Plugin() {

    private val executor: ExecutorService = Executors.newCachedThreadPool()
    private lateinit var core: RunNoteTransportCore

    override fun load() {
        super.load()
        val vault = EncryptedPrefsTransportVault(context)
        core = RunNoteTransportCore(
            vault = vault,
            defaultServerUrl = BuildConfig.RUNNOTE_SERVER_URL,
            allowDebugLoopbackHttp = BuildConfig.DEBUG,
            appVersion = BuildConfig.VERSION_NAME,
        )
    }

    override fun handleOnDestroy() {
        executor.shutdownNow()
        super.handleOnDestroy()
    }

    @PluginMethod
    fun getServerConfig(call: PluginCall) {
        executor.execute {
            val cfg = core.getServerConfig()
            val out = JSObject()
                .put("serverUrl", cfg.serverUrl)
                .put("defaultServerUrl", cfg.defaultServerUrl)
                .put("valid", cfg.valid)
                .put("reason", cfg.reason)
            call.resolve(out)
        }
    }

    @PluginMethod
    fun getSessionState(call: PluginCall) {
        executor.execute {
            val state = core.getPublicSessionState()
            val out = JSObject()
                .put("state", state.state.wireValue)
                .put("serverUrl", state.serverUrl)
                .put("serverOriginHash", state.serverOriginHash)
                .put("accountId", state.accountId)
            val userJson = state.userJson
            if (!userJson.isNullOrBlank()) {
                try {
                    out.put("user", JSObject(userJson))
                } catch (_: Exception) {
                    out.put("user", JSObject.NULL)
                }
            } else {
                out.put("user", JSObject.NULL)
            }
            call.resolve(out)
        }
    }

    @PluginMethod
    fun checkCapabilities(call: PluginCall) {
        executor.execute {
            val res = core.checkCapabilities()
            val out = JSObject()
                .put("ok", res.ok)
                .put("status", res.status)
                .put("errorCode", res.errorCode)
                .put("errorMessage", res.errorMessage)
            if (!res.capabilitiesJson.isNullOrBlank()) {
                try {
                    out.put("capabilities", JSObject(res.capabilitiesJson))
                } catch (_: Exception) {
                    out.put("capabilities", JSObject.NULL)
                }
            }
            call.resolve(out)
        }
    }

    @PluginMethod
    fun login(call: PluginCall) {
        val email = call.getString("email") ?: ""
        val password = call.getString("password") ?: ""
        val deviceLabel = call.getString("deviceLabel") ?: "RunNote Android"
        val clientVersion = call.getString("clientVersion") ?: BuildConfig.VERSION_NAME
        executor.execute {
            val outcome = core.login(
                email = email,
                password = password,
                deviceLabel = deviceLabel,
                clientVersion = clientVersion,
            )
            val out = JSObject()
                .put("ok", outcome.ok)
                .put("status", outcome.status)
                .put("errorCode", outcome.errorCode)
                .put("errorMessage", outcome.errorMessage)
                .put("retryAfterSeconds", outcome.retryAfterSeconds)
            if (!outcome.userJson.isNullOrBlank()) {
                try {
                    out.put("user", JSObject(outcome.userJson))
                } catch (_: Exception) {
                    out.put("user", JSObject.NULL)
                }
            }
            call.resolve(out)
        }
    }

    @PluginMethod
    fun logout(call: PluginCall) {
        val revokeAll = call.getBoolean("revokeAllDevices", false) ?: false
        executor.execute {
            val (ok, status) = core.logout(revokeAllDevices = revokeAll)
            call.resolve(JSObject().put("ok", ok).put("status", status))
        }
    }

    @PluginMethod
    fun request(call: PluginCall) {
        val method = call.getString("method") ?: "GET"
        val path = call.getString("path") ?: ""
        val body = call.getString("body")
        val timeoutMs = call.getInt("timeoutMs")?.toLong() ?: RunNoteTransportCore.DEFAULT_TIMEOUT_MS
        val headersObj = call.getObject("headers")
        val headers = LinkedHashMap<String, String>()
        if (headersObj != null) {
            val keys = headersObj.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val value = headersObj.optString(key, "")
                if (value.isNotEmpty()) {
                    headers[key] = value
                }
            }
        }
        executor.execute {
            val response = core.executeApiRequest(
                method = method,
                path = path,
                headers = headers,
                body = body,
                timeoutMs = timeoutMs,
            )
            val headerObj = JSObject()
            for ((k, v) in response.headers) {
                headerObj.put(k, v)
            }
            val out = JSObject()
                .put("status", response.status)
                .put("ok", response.ok)
                .put("headers", headerObj)
                .put("body", response.body)
                .put("sessionState", response.sessionState.wireValue)
                .put("errorCode", response.errorCode)
                .put("errorMessage", response.errorMessage)
            call.resolve(out)
        }
    }
}
