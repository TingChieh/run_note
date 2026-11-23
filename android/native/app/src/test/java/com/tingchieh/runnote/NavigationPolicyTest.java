package com.tingchieh.runnote;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class NavigationPolicyTest {

    private static final String ORIGIN = "https://run.example.test";

    @Test
    public void keepsSameOriginNavigationInsideWebView() {
        assertEquals(
            NavigationPolicy.Decision.ALLOW_IN_WEBVIEW,
            NavigationPolicy.classify("https://run.example.test/dashboard", ORIGIN)
        );
        assertEquals(
            NavigationPolicy.Decision.ALLOW_IN_WEBVIEW,
            NavigationPolicy.classify("https://RUN.EXAMPLE.TEST:443/activities/123?tab=route", ORIGIN)
        );
        assertEquals(
            NavigationPolicy.Decision.ALLOW_IN_WEBVIEW,
            NavigationPolicy.classify("http://localhost:15297/workspace/footprints", "http://localhost:15297")
        );
    }

    @Test
    public void routesExternalHttpAndHttpsToExternalBrowser() {
        assertEquals(
            NavigationPolicy.Decision.OPEN_EXTERNAL_BROWSER,
            NavigationPolicy.classify("https://github.com/TingChieh/run_note", ORIGIN)
        );
        // Scheme downgrade or subdomain/port mismatch is treated as external, never same-origin.
        assertEquals(
            NavigationPolicy.Decision.OPEN_EXTERNAL_BROWSER,
            NavigationPolicy.classify("http://run.example.test/dashboard", ORIGIN)
        );
        assertEquals(
            NavigationPolicy.Decision.OPEN_EXTERNAL_BROWSER,
            NavigationPolicy.classify("https://evil.run.example.test/phish", ORIGIN)
        );
        assertEquals(
            NavigationPolicy.Decision.OPEN_EXTERNAL_BROWSER,
            NavigationPolicy.classify("https://run.example.test.evil.test/", ORIGIN)
        );
        assertEquals(
            NavigationPolicy.Decision.OPEN_EXTERNAL_BROWSER,
            NavigationPolicy.classify("https://run.example.test:8443/dashboard", ORIGIN)
        );
    }

    @Test
    public void delegatesValidMailtoToSystemAction() {
        assertEquals(
            NavigationPolicy.Decision.OPEN_SYSTEM_ACTION,
            NavigationPolicy.classify("mailto:runner@example.test", ORIGIN)
        );
        assertEquals(
            NavigationPolicy.Decision.BLOCK,
            NavigationPolicy.classify("mailto:", ORIGIN)
        );
    }

    @Test
    public void blocksDangerousAndUnknownSchemes() {
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("javascript:alert(1)", ORIGIN));
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("file:///sdcard/Download/a.gpx", ORIGIN));
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("content://com.android.providers/1", ORIGIN));
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("data:text/html,<h1>x</h1>", ORIGIN));
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("blob:https://run.example.test/abc", ORIGIN));
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("intent://scan/#Intent;end", ORIGIN));
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("about:blank", ORIGIN));
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("customapp://open", ORIGIN));
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("https://user:pass@github.com/", ORIGIN));
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify("", ORIGIN));
        assertEquals(NavigationPolicy.Decision.BLOCK, NavigationPolicy.classify(null, ORIGIN));
    }
}
