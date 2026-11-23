package com.tingchieh.runnote;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/**
 * Validates and normalizes the RunNote server URL injected at build time.
 *
 * <p>Release builds strictly require HTTPS on a non-loopback host. Debug builds also require
 * HTTPS for any non-loopback host and only permit HTTP on loopback addresses for local development.
 */
public final class ServerUrlPolicy {

    public static final String EXPECTED_APP_ID = "com.tingchieh.runnote";

    private ServerUrlPolicy() {}

    public static final class ValidationResult {

        public final boolean valid;
        public final String normalizedUrl;
        public final String reason;

        private ValidationResult(boolean valid, String normalizedUrl, String reason) {
            this.valid = valid;
            this.normalizedUrl = normalizedUrl;
            this.reason = reason;
        }

        public static ValidationResult ok(String normalizedUrl) {
            return new ValidationResult(true, normalizedUrl, null);
        }

        public static ValidationResult invalid(String reason) {
            return new ValidationResult(false, null, reason);
        }
    }

    public static boolean isLoopbackHost(String host) {
        if (host == null) {
            return false;
        }
        String lower = host.trim().toLowerCase(Locale.ROOT);
        return "localhost".equals(lower) || "127.0.0.1".equals(lower) || "10.0.2.2".equals(lower);
    }

    public static ValidationResult validate(String rawUrl, boolean allowDebugLoopbackHttp) {
        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            return ValidationResult.invalid("empty_server_url");
        }
        String trimmed = rawUrl.trim();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        URI uri;
        try {
            uri = new URI(trimmed);
        } catch (URISyntaxException ex) {
            return ValidationResult.invalid("malformed_url");
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        if (host.isEmpty()) {
            return ValidationResult.invalid("missing_host");
        }
        if (uri.getRawUserInfo() != null || uri.getRawFragment() != null || uri.getRawQuery() != null) {
            return ValidationResult.invalid("disallowed_url_components");
        }
        if (uri.getRawPath() != null && !uri.getRawPath().isEmpty()) {
            return ValidationResult.invalid("server_url_must_be_origin_only");
        }
        int port = uri.getPort();
        if (port < -1 || port == 0 || port > 65535) {
            return ValidationResult.invalid("invalid_port");
        }
        boolean loopback = isLoopbackHost(host);
        if ("https".equals(scheme)) {
            if (!allowDebugLoopbackHttp && loopback) {
                return ValidationResult.invalid("release_loopback_forbidden");
            }
            return ValidationResult.ok(formatOrigin(scheme, host, port));
        }
        if (allowDebugLoopbackHttp && "http".equals(scheme) && loopback) {
            return ValidationResult.ok(formatOrigin(scheme, host, port));
        }
        return ValidationResult.invalid("https_required");
    }

    private static String formatOrigin(String scheme, String host, int port) {
        if (port == -1 || ("https".equals(scheme) && port == 443) || ("http".equals(scheme) && port == 80)) {
            return scheme + "://" + host;
        }
        return scheme + "://" + host + ":" + port;
    }
}
