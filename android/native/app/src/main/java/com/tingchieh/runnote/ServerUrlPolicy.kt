package com.tingchieh.runnote

import java.net.URI
import java.net.URISyntaxException
import java.util.Locale

/**
 * Validates and normalizes the RunNote server URL injected at build time.
 *
 * Release builds strictly require HTTPS on a non-loopback host. Debug builds also require
 * HTTPS for any non-loopback host and only permit HTTP on loopback addresses for local development.
 */
object ServerUrlPolicy {

    const val EXPECTED_APP_ID: String = "com.tingchieh.runnote"

    class ValidationResult private constructor(
        @JvmField val valid: Boolean,
        @JvmField val normalizedUrl: String?,
        @JvmField val reason: String?,
    ) {
        companion object {
            @JvmStatic
            fun ok(normalizedUrl: String): ValidationResult = ValidationResult(true, normalizedUrl, null)

            @JvmStatic
            fun invalid(reason: String): ValidationResult = ValidationResult(false, null, reason)
        }
    }

    @JvmStatic
    fun isLoopbackHost(host: String?): Boolean {
        if (host == null) {
            return false
        }
        val lower = host.trimLikeJava().lowercase(Locale.ROOT)
        return lower == "localhost" || lower == "127.0.0.1" || lower == "10.0.2.2"
    }

    @JvmStatic
    fun validate(rawUrl: String?, allowDebugLoopbackHttp: Boolean): ValidationResult {
        if (rawUrl == null || rawUrl.trimLikeJava().isEmpty()) {
            return ValidationResult.invalid("empty_server_url")
        }
        val trimmed = rawUrl.trimLikeJava().trimEnd('/')
        val uri = try {
            URI(trimmed)
        } catch (_: URISyntaxException) {
            return ValidationResult.invalid("malformed_url")
        }
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: ""
        val host = uri.host?.lowercase(Locale.ROOT) ?: ""
        if (host.isEmpty()) {
            return ValidationResult.invalid("missing_host")
        }
        if (uri.rawUserInfo != null || uri.rawFragment != null || uri.rawQuery != null) {
            return ValidationResult.invalid("disallowed_url_components")
        }
        val rawPath: String? = uri.rawPath
        if (rawPath != null && rawPath.isNotEmpty()) {
            return ValidationResult.invalid("server_url_must_be_origin_only")
        }
        val port = uri.port
        if (port < -1 || port == 0 || port > 65535) {
            return ValidationResult.invalid("invalid_port")
        }
        val loopback = isLoopbackHost(host)
        if (scheme == "https") {
            if (!allowDebugLoopbackHttp && loopback) {
                return ValidationResult.invalid("release_loopback_forbidden")
            }
            return ValidationResult.ok(formatOrigin(scheme, host, port))
        }
        if (allowDebugLoopbackHttp && scheme == "http" && loopback) {
            return ValidationResult.ok(formatOrigin(scheme, host, port))
        }
        return ValidationResult.invalid("https_required")
    }

    private fun formatOrigin(scheme: String, host: String, port: Int): String {
        if (port == -1 || (scheme == "https" && port == 443) || (scheme == "http" && port == 80)) {
            return "$scheme://$host"
        }
        return "$scheme://$host:$port"
    }
}
