package com.tingchieh.runnote

import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationPolicyTest {

    @Test
    fun keepsSameOriginNavigationInsideWebView() {
        assertEquals(
            NavigationPolicy.Decision.ALLOW_IN_WEBVIEW,
            NavigationPolicy.classify("https://run.example.test/dashboard", ORIGIN),
        )
        assertEquals(
            NavigationPolicy.Decision.ALLOW_IN_WEBVIEW,
            NavigationPolicy.classify("https://RUN.EXAMPLE.TEST:443/activities/123?tab=route", ORIGIN),
        )
        assertEquals(
            NavigationPolicy.Decision.ALLOW_IN_WEBVIEW,
            NavigationPolicy.classify("http://localhost:15297/workspace/footprints", "http://localhost:15297"),
        )
    }

    @Test
    fun keepsLocalBundleOriginInWebViewAndRoutesRemoteServerToExternalBrowser() {
        assertEquals(
            NavigationPolicy.Decision.ALLOW_IN_WEBVIEW,
            NavigationPolicy.classify("https://localhost/", NavigationPolicy.LOCAL_BUNDLE_ORIGIN),
        )
        assertEquals(
            NavigationPolicy.Decision.ALLOW_IN_WEBVIEW,
            NavigationPolicy.classify("https://localhost/login", NavigationPolicy.LOCAL_BUNDLE_ORIGIN),
        )
        // Remote RunNote server pages must never load in the local WebView (prevents bridge exposure).
        assertEquals(
            NavigationPolicy.Decision.OPEN_EXTERNAL_BROWSER,
            NavigationPolicy.classify("https://run.example.test/dashboard", NavigationPolicy.LOCAL_BUNDLE_ORIGIN),
        )
        assertEquals(
            NavigationPolicy.Decision.OPEN_EXTERNAL_BROWSER,
            NavigationPolicy.classify("http://localhost:15297/dashboard", NavigationPolicy.LOCAL_BUNDLE_ORIGIN),
        )
    }

    @Test
    fun routesExternalHttpAndHttpsToExternalBrowser() {
        assertEquals(
            NavigationPolicy.Decision.OPEN_EXTERNAL_BROWSER,
            NavigationPolicy.classify("https://github.com/TingChieh/run_note", ORIGIN),
        )
        // Scheme downgrade or subdomain/port mismatch is treated as external, never same-origin.
        assertEquals(
            NavigationPolicy.Decision.OPEN_EXTERNAL_BROWSER,
            NavigationPolicy.classify("http://run.example.test/dashboard", ORIGIN),
        )
        assertEquals(
            NavigationPolicy.Decision.OPEN_EXTERNAL_BROWSER,
            NavigationPolicy.classify("https://evil.run.example.test/phish", ORIGIN),
        )
        assertEquals(
            NavigationPolicy.Decision.OPEN_EXTERNAL_BROWSER,
            NavigationPolicy.classify("https://run.example.test.evil.test/", ORIGIN),
        )
        assertEquals(
            NavigationPolicy.Decision.OPEN_EXTERNAL_BROWSER,
            NavigationPolicy.classify("https://run.example.test:8443/dashboard", ORIGIN),
        )
    }

    @Test
    fun delegatesValidMailtoToSystemAction() {
        assertEquals(
            NavigationPolicy.Decision.OPEN_SYSTEM_ACTION,
            NavigationPolicy.classify("mailto:runner@example.test", ORIGIN),
        )
        assertEquals(
            NavigationPolicy.Decision.BLOCK,
            NavigationPolicy.classify("mailto:", ORIGIN),
        )
    }

    @Test
    fun blocksDangerousAndUnknownSchemes() {
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("javascript:alert(1)", ORIGIN))
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("file:///sdcard/Download/a.gpx", ORIGIN))
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("content://com.android.providers/1", ORIGIN))
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("data:text/html,<h1>x</h1>", ORIGIN))
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("blob:https://run.example.test/abc", ORIGIN))
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("intent://scan/#Intent;end", ORIGIN))
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("about:blank", ORIGIN))
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("customapp://open", ORIGIN))
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("https://user:pass@github.com/", ORIGIN))
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("", ORIGIN))
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify(null, ORIGIN))
    }

    private companion object {
        const val ORIGIN = "https://run.example.test"
    }
}
