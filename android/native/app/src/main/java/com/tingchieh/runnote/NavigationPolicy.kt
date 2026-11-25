package com.tingchieh.runnote

import java.net.URI
import java.net.URISyntaxException
import java.util.Locale

/**
 * Enforces the Phase 1 WebView navigation allowlist:
 * - Same-origin http(s) URLs stay inside the WebView.
 * - External http(s) URLs open in the system browser / Chrome Custom Tab.
 * - mailto: links delegate safely to the system mail handler.
 * - javascript:, file:, content:, data:, blob:, intent:, and unknown schemes are blocked.
 */
object NavigationPolicy {

    enum class Decision {
        ALLOW_IN_WEBVIEW,
        OPEN_EXTERNAL_BROWSER,
        OPEN_SYSTEM_ACTION,
        BLOCK,
    }

    private val BLOCKED_SCHEMES: Set<String> =
        hashSetOf("javascript", "file", "content", "data", "blob", "vbscript", "intent", "about")

    @JvmStatic
    fun classify(targetUrl: String?, allowedOriginUrl: String?): Decision {
        if (targetUrl == null || targetUrl.trimLikeJava().isEmpty()) {
            return Decision.BLOCK
        }
        val target = try {
            URI(targetUrl.trimLikeJava())
        } catch (_: URISyntaxException) {
            return Decision.BLOCK
        }

        val scheme = target.scheme?.lowercase(Locale.ROOT) ?: ""
        if (scheme.isEmpty() || scheme in BLOCKED_SCHEMES) {
            return Decision.BLOCK
        }

        if (scheme == "mailto") {
            val ssp: String? = target.schemeSpecificPart
            return if (ssp != null && ssp.trimLikeJava().isNotEmpty()) {
                Decision.OPEN_SYSTEM_ACTION
            } else {
                Decision.BLOCK
            }
        }

        if (scheme != "https" && scheme != "http") {
            return Decision.BLOCK
        }

        val targetHost = target.host?.lowercase(Locale.ROOT) ?: ""
        if (targetHost.isEmpty() || target.rawUserInfo != null) {
            return Decision.BLOCK
        }

        if (isSameOrigin(target, allowedOriginUrl)) {
            return Decision.ALLOW_IN_WEBVIEW
        }
        return Decision.OPEN_EXTERNAL_BROWSER
    }

    @JvmStatic
    fun isSameOrigin(target: URI?, allowedOriginUrl: String?): Boolean {
        if (target == null || allowedOriginUrl == null || allowedOriginUrl.trimLikeJava().isEmpty()) {
            return false
        }
        val allowed = try {
            URI(allowedOriginUrl.trimLikeJava())
        } catch (_: URISyntaxException) {
            return false
        }
        val allowedScheme = allowed.scheme?.lowercase(Locale.ROOT) ?: ""
        val targetScheme = target.scheme?.lowercase(Locale.ROOT) ?: ""
        if (allowedScheme != targetScheme) {
            return false
        }
        val allowedHost = allowed.host?.lowercase(Locale.ROOT) ?: ""
        val targetHost = target.host?.lowercase(Locale.ROOT) ?: ""
        if (allowedHost.isEmpty() || allowedHost != targetHost) {
            return false
        }
        return effectivePort(allowedScheme, allowed.port) == effectivePort(targetScheme, target.port)
    }

    private fun effectivePort(scheme: String, port: Int): Int {
        if (port > 0) {
            return port
        }
        if (scheme == "https") {
            return 443
        }
        if (scheme == "http") {
            return 80
        }
        return -1
    }
}
