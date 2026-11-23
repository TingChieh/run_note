package com.tingchieh.runnote;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Enforces the Phase 1 WebView navigation allowlist:
 * <ul>
 *   <li>Same-origin http(s) URLs stay inside the WebView.</li>
 *   <li>External http(s) URLs open in the system browser / Chrome Custom Tab.</li>
 *   <li>mailto: links delegate safely to the system mail handler.</li>
 *   <li>javascript:, file:, content:, data:, blob:, intent:, and unknown schemes are blocked.</li>
 * </ul>
 */
public final class NavigationPolicy {

    public enum Decision {
        ALLOW_IN_WEBVIEW,
        OPEN_EXTERNAL_BROWSER,
        OPEN_SYSTEM_ACTION,
        BLOCK,
    }

    private static final Set<String> BLOCKED_SCHEMES = new HashSet<>(
        Arrays.asList("javascript", "file", "content", "data", "blob", "vbscript", "intent", "about")
    );

    private NavigationPolicy() {}

    public static Decision classify(String targetUrl, String allowedOriginUrl) {
        if (targetUrl == null || targetUrl.trim().isEmpty()) {
            return Decision.BLOCK;
        }
        URI target;
        try {
            target = new URI(targetUrl.trim());
        } catch (URISyntaxException ex) {
            return Decision.BLOCK;
        }

        String scheme = target.getScheme() == null ? "" : target.getScheme().toLowerCase(Locale.ROOT);
        if (scheme.isEmpty() || BLOCKED_SCHEMES.contains(scheme)) {
            return Decision.BLOCK;
        }

        if ("mailto".equals(scheme)) {
            String ssp = target.getSchemeSpecificPart();
            return (ssp != null && !ssp.trim().isEmpty()) ? Decision.OPEN_SYSTEM_ACTION : Decision.BLOCK;
        }

        if (!"https".equals(scheme) && !"http".equals(scheme)) {
            return Decision.BLOCK;
        }

        String targetHost = target.getHost() == null ? "" : target.getHost().toLowerCase(Locale.ROOT);
        if (targetHost.isEmpty() || target.getRawUserInfo() != null) {
            return Decision.BLOCK;
        }

        if (isSameOrigin(target, allowedOriginUrl)) {
            return Decision.ALLOW_IN_WEBVIEW;
        }
        return Decision.OPEN_EXTERNAL_BROWSER;
    }

    public static boolean isSameOrigin(URI target, String allowedOriginUrl) {
        if (target == null || allowedOriginUrl == null || allowedOriginUrl.trim().isEmpty()) {
            return false;
        }
        URI allowed;
        try {
            allowed = new URI(allowedOriginUrl.trim());
        } catch (URISyntaxException ex) {
            return false;
        }
        String allowedScheme = allowed.getScheme() == null ? "" : allowed.getScheme().toLowerCase(Locale.ROOT);
        String targetScheme = target.getScheme() == null ? "" : target.getScheme().toLowerCase(Locale.ROOT);
        if (!allowedScheme.equals(targetScheme)) {
            return false;
        }
        String allowedHost = allowed.getHost() == null ? "" : allowed.getHost().toLowerCase(Locale.ROOT);
        String targetHost = target.getHost() == null ? "" : target.getHost().toLowerCase(Locale.ROOT);
        if (allowedHost.isEmpty() || !allowedHost.equals(targetHost)) {
            return false;
        }
        return effectivePort(allowedScheme, allowed.getPort()) == effectivePort(targetScheme, target.getPort());
    }

    private static int effectivePort(String scheme, int port) {
        if (port > 0) {
            return port;
        }
        if ("https".equals(scheme)) {
            return 443;
        }
        if ("http".equals(scheme)) {
            return 80;
        }
        return -1;
    }
}
