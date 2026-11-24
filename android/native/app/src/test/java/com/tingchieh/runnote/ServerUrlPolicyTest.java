package com.tingchieh.runnote;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ServerUrlPolicyTest {

    @Test
    public void verifiesFinalAppIdentityAndVersion() {
        assertEquals("com.tingchieh.runnote", ServerUrlPolicy.EXPECTED_APP_ID);
        assertEquals("com.tingchieh.runnote", BuildConfig.APPLICATION_ID);
        assertEquals("com.tingchieh.runnote", BuildConfig.RUNNOTE_APP_ID);
        assertEquals("2.5.0", BuildConfig.VERSION_NAME);
        assertEquals(20500, BuildConfig.VERSION_CODE);
    }

    @Test
    public void acceptsValidHttpsOriginsAndNormalizesDefaultPort() {
        ServerUrlPolicy.ValidationResult res = ServerUrlPolicy.validate("https://Run.Example.Test:443///", false);
        assertTrue(res.valid);
        assertEquals("https://run.example.test", res.normalizedUrl);

        ServerUrlPolicy.ValidationResult customPort = ServerUrlPolicy.validate("https://run.example.test:8443", false);
        assertTrue(customPort.valid);
        assertEquals("https://run.example.test:8443", customPort.normalizedUrl);
    }

    @Test
    public void rejectsInsecureAndLoopbackUrlsInReleaseMode() {
        assertFalse(ServerUrlPolicy.validate("", false).valid);
        assertFalse(ServerUrlPolicy.validate("http://run.example.test", false).valid);
        assertFalse(ServerUrlPolicy.validate("http://localhost:15297", false).valid);
        assertFalse(ServerUrlPolicy.validate("https://localhost:15443", false).valid);
        assertFalse(ServerUrlPolicy.validate("https://127.0.0.1:15443", false).valid);
        assertFalse(ServerUrlPolicy.validate("javascript:alert(1)", false).valid);
        assertFalse(ServerUrlPolicy.validate("file:///etc/passwd", false).valid);
    }

    @Test
    public void permitsLoopbackHttpOnlyInDebugModeAndRejectsExtraComponents() {
        ServerUrlPolicy.ValidationResult debugLocal = ServerUrlPolicy.validate("http://localhost:15297/", true);
        assertTrue(debugLocal.valid);
        assertEquals("http://localhost:15297", debugLocal.normalizedUrl);

        // Non-loopback HTTP is rejected even in debug builds.
        assertFalse(ServerUrlPolicy.validate("http://run.example.test", true).valid);
        // Credentials, query, path, and fragment are rejected.
        assertFalse(ServerUrlPolicy.validate("https://user:pass@run.example.test", true).valid);
        assertFalse(ServerUrlPolicy.validate("https://run.example.test/dashboard", true).valid);
        assertFalse(ServerUrlPolicy.validate("https://run.example.test?next=/", true).valid);
        assertFalse(ServerUrlPolicy.validate("https://run.example.test#frag", true).valid);
    }
}
