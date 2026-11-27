package com.tingchieh.runnote

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerUrlPolicyTest {

    private fun readRootVersion(): String {
        var dir: File? = File(System.getProperty("user.dir") ?: ".").canonicalFile
        while (dir != null) {
            val candidate = File(dir, "VERSION")
            if (candidate.isFile) {
                return candidate.readText(Charsets.UTF_8).trim()
            }
            dir = dir.parentFile
        }
        throw AssertionError("Repository root VERSION file not found from ${System.getProperty("user.dir")}")
    }

    private fun expectedVersionCode(version: String): Int {
        val pattern = Regex("""^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.([1-9]\d*))?$""")
        val match = pattern.matchEntire(version)
        assertNotNull("VERSION must be valid SemVer: $version", match)
        val major = match!!.groupValues[1].toInt()
        val minor = match.groupValues[2].toInt()
        val patch = match.groupValues[3].toInt()
        val stage = match.groupValues[4]
        val preNum = match.groupValues[5].toIntOrNull()
        val stageCode = when (stage) {
            "" -> 999
            "alpha" -> 100 + preNum!!
            "beta" -> 200 + preNum!!
            "rc" -> 300 + preNum!!
            else -> throw AssertionError("Unsupported prerelease stage: $stage")
        }
        return major * 10_000_000 + minor * 100_000 + patch * 1_000 + stageCode
    }

    @Test
    fun verifiesFinalAppIdentityAndVersion() {
        val rootVersion = readRootVersion()
        assertEquals("com.tingchieh.runnote", ServerUrlPolicy.EXPECTED_APP_ID)
        assertEquals("com.tingchieh.runnote", BuildConfig.APPLICATION_ID)
        assertEquals("com.tingchieh.runnote", BuildConfig.RUNNOTE_APP_ID)
        assertEquals(rootVersion, BuildConfig.VERSION_NAME)
        assertEquals(expectedVersionCode(rootVersion), BuildConfig.VERSION_CODE)
    }

    @Test
    fun acceptsValidHttpsOriginsAndNormalizesDefaultPort() {
        val res = ServerUrlPolicy.validate("https://Run.Example.Test:443///", false)
        assertTrue(res.valid)
        assertEquals("https://run.example.test", res.normalizedUrl)

        val customPort = ServerUrlPolicy.validate("https://run.example.test:8443", false)
        assertTrue(customPort.valid)
        assertEquals("https://run.example.test:8443", customPort.normalizedUrl)
    }

    @Test
    fun rejectsInsecureAndLoopbackUrlsInReleaseMode() {
        assertFalse(ServerUrlPolicy.validate("", false).valid)
        assertFalse(ServerUrlPolicy.validate("http://run.example.test", false).valid)
        assertFalse(ServerUrlPolicy.validate("http://localhost:15297", false).valid)
        assertFalse(ServerUrlPolicy.validate("https://localhost:15443", false).valid)
        assertFalse(ServerUrlPolicy.validate("https://127.0.0.1:15443", false).valid)
        assertFalse(ServerUrlPolicy.validate("javascript:alert(1)", false).valid)
        assertFalse(ServerUrlPolicy.validate("file:///etc/passwd", false).valid)
    }

    @Test
    fun permitsLoopbackHttpOnlyInDebugModeAndRejectsExtraComponents() {
        val debugLocal = ServerUrlPolicy.validate("http://localhost:15297/", true)
        assertTrue(debugLocal.valid)
        assertEquals("http://localhost:15297", debugLocal.normalizedUrl)

        // Non-loopback HTTP is rejected even in debug builds.
        assertFalse(ServerUrlPolicy.validate("http://run.example.test", true).valid)
        // Credentials, query, path, and fragment are rejected.
        assertFalse(ServerUrlPolicy.validate("https://user:pass@run.example.test", true).valid)
        assertFalse(ServerUrlPolicy.validate("https://run.example.test/dashboard", true).valid)
        assertFalse(ServerUrlPolicy.validate("https://run.example.test?next=/", true).valid)
        assertFalse(ServerUrlPolicy.validate("https://run.example.test#frag", true).valid)
    }
}
