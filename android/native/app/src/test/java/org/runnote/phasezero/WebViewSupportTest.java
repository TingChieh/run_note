package org.runnote.phasezero;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class WebViewSupportTest {

    @Test
    public void parsesChromiumMajorVersions() {
        assertEquals(Integer.valueOf(74), WebViewSupport.parseMajorVersion("74.0.3729.185"));
        assertEquals(Integer.valueOf(133), WebViewSupport.parseMajorVersion("133.0.6943.137"));
        assertNull(WebViewSupport.parseMajorVersion(null));
        assertNull(WebViewSupport.parseMajorVersion(""));
        assertNull(WebViewSupport.parseMajorVersion("unknown"));
    }

    @Test
    public void rejectsStockApi29WebView74AndAccepts116Plus() {
        WebViewSupport.Status stock = WebViewSupport.evaluate("com.google.android.webview", "74.0.3729.185", 116);
        assertFalse(stock.supported);
        assertEquals(Integer.valueOf(74), stock.majorVersion);
        assertEquals(116, stock.minRequiredMajor);

        WebViewSupport.Status boundary = WebViewSupport.evaluate("com.google.android.webview", "116.0.5845.172", 116);
        assertTrue(boundary.supported);

        WebViewSupport.Status modern = WebViewSupport.evaluate("com.google.android.webview", "133.0.6943.137", 116);
        assertTrue(modern.supported);
    }

    @Test
    public void rejectsMissingPackageOrVersion() {
        assertFalse(WebViewSupport.evaluate(null, null, 116).supported);
        assertFalse(WebViewSupport.evaluate("com.google.android.webview", null, 116).supported);
    }

    @Test
    public void resolvesFallbackStorePackage() {
        assertEquals("com.google.android.webview", WebViewSupport.resolveUpdatePackage(null));
        assertEquals("com.google.android.webview", WebViewSupport.resolveUpdatePackage("  "));
        assertEquals("com.android.chrome", WebViewSupport.resolveUpdatePackage("com.android.chrome"));
    }
}
