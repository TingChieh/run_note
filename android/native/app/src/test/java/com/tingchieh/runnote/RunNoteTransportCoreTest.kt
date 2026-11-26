package com.tingchieh.runnote

import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class RunNoteTransportCoreTest {

    private lateinit var server: MockWebServer
    private lateinit var vault: InMemoryTransportVault
    private val fixedNow = Instant.parse("2026-11-26T10:00:00Z")
    private val fixedClock: Clock = Clock.fixed(fixedNow, ZoneOffset.UTC)

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        vault = InMemoryTransportVault()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun serverOrigin(): String = "http://127.0.0.1:${server.port}"

    private fun buildCore(
        defaultUrl: String? = serverOrigin(),
        allowDebugLoopbackHttp: Boolean = true,
        clock: Clock = fixedClock,
    ): RunNoteTransportCore = RunNoteTransportCore(
        vault = vault,
        defaultServerUrl = defaultUrl,
        allowDebugLoopbackHttp = allowDebugLoopbackHttp,
        appVersion = "2.6.0",
        clock = clock,
    )

    private fun sampleUserJson(id: String = "11111111-1111-4111-8111-111111111111"): JSONObject =
        JSONObject()
            .put("id", id)
            .put("email", "runner@example.test")
            .put("username", "runner")
            .put("display_name", "Runner")

    @Test
    fun loginStoresTokensInVaultAndNeverExposesTokensToBridgeResult() {
        val responseBody = JSONObject()
            .put(
                "data",
                JSONObject()
                    .put("token_type", "Bearer")
                    .put("access_token", "secret-access-token-1")
                    .put("access_expires_at", fixedNow.plusSeconds(1800).toString())
                    .put("refresh_token", "secret-refresh-token-1")
                    .put("refresh_expires_at", fixedNow.plusSeconds(86400 * 90L).toString())
                    .put("user", sampleUserJson()),
            )
            .toString()
        server.enqueue(MockResponse().setResponseCode(200).setBody(responseBody))

        val core = buildCore()
        val outcome = core.login("runner@example.test", "Synthetic-password-2026")
        assertTrue(outcome.ok)
        assertEquals(200, outcome.status)
        assertNotNull(outcome.userJson)
        assertFalse(outcome.userJson!!.contains("secret-access-token-1"))
        assertFalse(outcome.userJson!!.contains("secret-refresh-token-1"))

        val stored = vault.read()
        assertEquals(SessionLifecycleState.ACTIVE, stored.state)
        assertEquals("secret-access-token-1", stored.accessToken)
        assertEquals("secret-refresh-token-1", stored.refreshToken)

        val publicState = core.getPublicSessionState()
        assertEquals(SessionLifecycleState.ACTIVE, publicState.state)
        assertEquals(serverOrigin(), publicState.serverUrl)
        assertEquals("11111111-1111-4111-8111-111111111111", publicState.accountId)
        assertFalse(publicState.userJson.orEmpty().contains("secret-access-token-1"))
    }

    @Test
    fun authenticatedRequestSendsBearerOnlyStripsCallerAuthAndCookiesAndNeverFollowsRedirects() {
        vault.saveActiveSession(
            serverUrl = serverOrigin(),
            accountId = "user-1",
            accessToken = "bearer-tok-1",
            accessExpiresAtIso = fixedNow.plusSeconds(1800).toString(),
            refreshToken = "refresh-tok-1",
            refreshExpiresAtIso = fixedNow.plusSeconds(86400 * 90L).toString(),
            userJson = sampleUserJson("user-1").toString(),
        )
        server.enqueue(
            MockResponse()
                .setResponseCode(302)
                .addHeader("Location", "https://evil.example/steal")
                .addHeader("Set-Cookie", "run_session=forbidden")
                .setBody("{}"),
        )

        val core = buildCore()
        val res = core.executeApiRequest(
            method = "GET",
            path = "/api/v1/me",
            headers = mapOf(
                "Authorization" to "Bearer caller-spoof",
                "Cookie" to "run_session=spoof",
                "X-CSRF-Token" to "spoof",
                "X-Custom" to "ok",
            ),
        )

        assertEquals(302, res.status)
        assertFalse(res.headers.containsKey("set-cookie"))
        assertEquals(1, server.requestCount)
        val recorded = server.takeRequest()
        assertEquals("Bearer bearer-tok-1", recorded.getHeader("Authorization"))
        assertNull(recorded.getHeader("Cookie"))
        assertNull(recorded.getHeader("X-CSRF-Token"))
        assertEquals("ok", recorded.getHeader("X-Custom"))
    }

    @Test
    fun singleFlightRefreshCoalescesConcurrentExpiredRequestsIntoOneRefreshCall() {
        vault.saveActiveSession(
            serverUrl = serverOrigin(),
            accountId = "user-1",
            accessToken = "old-access-token",
            // Already expired relative to fixedNow -> forces refresh before or on 401.
            accessExpiresAtIso = fixedNow.minusSeconds(10).toString(),
            refreshToken = "old-refresh-token",
            refreshExpiresAtIso = fixedNow.plusSeconds(86400 * 90L).toString(),
            userJson = sampleUserJson("user-1").toString(),
        )

        val refreshCount = AtomicInteger(0)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                return when (request.path) {
                    RunNoteTransportCore.REFRESH_PATH -> {
                        val n = refreshCount.incrementAndGet()
                        Thread.sleep(60)
                        val body = JSONObject()
                            .put(
                                "data",
                                JSONObject()
                                    .put("token_type", "Bearer")
                                    .put("access_token", "new-access-token-$n")
                                    .put("access_expires_at", fixedNow.plusSeconds(1800).toString())
                                    .put("refresh_token", "new-refresh-token-$n")
                                    .put("refresh_expires_at", fixedNow.plusSeconds(86400 * 90L).toString())
                                    .put("user", sampleUserJson("user-1")),
                            )
                            .toString()
                        MockResponse().setResponseCode(200).setBody(body)
                    }
                    "/api/v1/me" -> {
                        if (request.getHeader("Authorization") == "Bearer new-access-token-1") {
                            MockResponse().setResponseCode(200).setBody("""{"data":{"ok":true}}""")
                        } else {
                            MockResponse().setResponseCode(401).setBody("""{"error":{"code":"AUTH_REQUIRED"}}""")
                        }
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }

        val core = buildCore()
        val pool = Executors.newFixedThreadPool(4)
        try {
            val futures = (1..4).map {
                pool.submit(Callable { core.executeApiRequest("GET", "/api/v1/me") })
            }
            val responses = futures.map { it.get() }
            assertEquals(1, refreshCount.get())
            assertTrue(responses.all { it.status == 200 && it.ok })
            assertEquals("new-access-token-1", vault.read().accessToken)
            assertEquals("new-refresh-token-1", vault.read().refreshToken)
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun refresh401TransitionsToReauthRequiredAndPreservesAccountAndServer() {
        vault.saveActiveSession(
            serverUrl = serverOrigin(),
            accountId = "user-keep",
            accessToken = "revoked-access",
            accessExpiresAtIso = fixedNow.plusSeconds(1800).toString(),
            refreshToken = "revoked-refresh",
            refreshExpiresAtIso = fixedNow.plusSeconds(86400 * 90L).toString(),
            userJson = sampleUserJson("user-keep").toString(),
        )
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":{"code":"AUTH_REQUIRED"}}"""))
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":{"code":"INVALID_REFRESH_TOKEN"}}"""))

        val core = buildCore()
        val res = core.executeApiRequest("GET", "/api/v1/me")
        assertEquals(401, res.status)
        assertEquals(SessionLifecycleState.REAUTH_REQUIRED, res.sessionState)

        val snap = vault.read()
        assertEquals(SessionLifecycleState.REAUTH_REQUIRED, snap.state)
        assertNull(snap.accessToken)
        assertNull(snap.refreshToken)
        assertEquals("user-keep", snap.accountId)
        assertEquals(serverOrigin(), snap.serverUrl)
    }

    @Test
    fun logoutRevokesWithBearerAndClearsVault() {
        vault.saveActiveSession(
            serverUrl = serverOrigin(),
            accountId = "user-1",
            accessToken = "tok-logout",
            accessExpiresAtIso = fixedNow.plusSeconds(1800).toString(),
            refreshToken = "ref-logout",
            refreshExpiresAtIso = fixedNow.plusSeconds(86400 * 90L).toString(),
            userJson = sampleUserJson("user-1").toString(),
        )
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"data":{"logged_out":true}}"""))

        val core = buildCore()
        val (ok, status) = core.logout(revokeAllDevices = true)
        assertTrue(ok)
        assertEquals(200, status)
        val recorded = server.takeRequest()
        assertEquals(RunNoteTransportCore.LOGOUT_PATH, recorded.path)
        assertEquals("Bearer tok-logout", recorded.getHeader("Authorization"))
        assertEquals(SessionLifecycleState.SIGNED_OUT, vault.read().state)
        assertNull(vault.read().accessToken)
        assertNull(vault.read().refreshToken)
    }

    @Test
    fun logoutRefreshesExpiredAccessTokenBeforeServerRevocation() {
        vault.saveActiveSession(
            serverUrl = serverOrigin(),
            accountId = "user-1",
            accessToken = "expired-access-token",
            accessExpiresAtIso = fixedNow.minusSeconds(3600).toString(),
            refreshToken = "still-valid-refresh",
            refreshExpiresAtIso = fixedNow.plusSeconds(86400 * 90L).toString(),
            userJson = sampleUserJson("user-1").toString(),
        )
        val refreshBody = JSONObject()
            .put(
                "data",
                JSONObject()
                    .put("token_type", "Bearer")
                    .put("access_token", "fresh-logout-access")
                    .put("access_expires_at", fixedNow.plusSeconds(1800).toString())
                    .put("refresh_token", "fresh-logout-refresh")
                    .put("refresh_expires_at", fixedNow.plusSeconds(86400 * 90L).toString())
                    .put("user", sampleUserJson("user-1")),
            )
            .toString()
        server.enqueue(MockResponse().setResponseCode(200).setBody(refreshBody))
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"data":{"logged_out":true}}"""))

        val core = buildCore()
        val (ok, status) = core.logout(revokeAllDevices = true)
        assertTrue(ok)
        assertEquals(200, status)

        val refreshReq = server.takeRequest()
        assertEquals(RunNoteTransportCore.REFRESH_PATH, refreshReq.path)
        assertTrue(refreshReq.body.readUtf8().contains("still-valid-refresh"))

        val logoutReq = server.takeRequest()
        assertEquals(RunNoteTransportCore.LOGOUT_PATH, logoutReq.path)
        assertEquals("Bearer fresh-logout-access", logoutReq.getHeader("Authorization"))
        assertTrue(logoutReq.body.readUtf8().contains("\"revoke_all_devices\":true"))

        assertEquals(SessionLifecycleState.SIGNED_OUT, vault.read().state)
        assertNull(vault.read().accessToken)
        assertNull(vault.read().refreshToken)
    }

    @Test
    fun inFlightRefreshCannotRestoreSessionAfterConcurrentLogout() {
        vault.saveActiveSession(
            serverUrl = serverOrigin(),
            accountId = "user-1",
            accessToken = "expired-access",
            accessExpiresAtIso = fixedNow.minusSeconds(60).toString(),
            refreshToken = "old-refresh",
            refreshExpiresAtIso = fixedNow.plusSeconds(86400 * 90L).toString(),
            userJson = sampleUserJson("user-1").toString(),
        )

        val refreshInFlight = CountDownLatch(1)
        val releaseRefresh = CountDownLatch(1)
        val logoutAuthHeader = AtomicReference<String?>(null)

        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                return when (request.path) {
                    RunNoteTransportCore.REFRESH_PATH -> {
                        refreshInFlight.countDown()
                        releaseRefresh.await(5, TimeUnit.SECONDS)
                        val body = JSONObject()
                            .put(
                                "data",
                                JSONObject()
                                    .put("token_type", "Bearer")
                                    .put("access_token", "rotated-during-logout")
                                    .put("access_expires_at", fixedNow.plusSeconds(1800).toString())
                                    .put("refresh_token", "rotated-refresh-during-logout")
                                    .put("refresh_expires_at", fixedNow.plusSeconds(86400 * 90L).toString())
                                    .put("user", sampleUserJson("user-1")),
                            )
                            .toString()
                        MockResponse().setResponseCode(200).setBody(body)
                    }
                    RunNoteTransportCore.LOGOUT_PATH -> {
                        logoutAuthHeader.set(request.getHeader("Authorization"))
                        MockResponse().setResponseCode(200).setBody("""{"data":{"logged_out":true}}""")
                    }
                    else -> MockResponse().setResponseCode(200).setBody("""{"data":{}}""")
                }
            }
        }

        val core = buildCore()
        val pool = Executors.newFixedThreadPool(2)
        try {
            val apiFuture = pool.submit(Callable { core.executeApiRequest("GET", "/api/v1/me") })
            assertTrue(refreshInFlight.await(5, TimeUnit.SECONDS))
            val logoutFuture = pool.submit(Callable { core.logout(revokeAllDevices = true) })
            // Give logout a brief moment to bump sessionEpoch and block on refreshLock.
            Thread.sleep(50)
            releaseRefresh.countDown()

            val apiRes = apiFuture.get(5, TimeUnit.SECONDS)
            val (logoutOk, logoutStatus) = logoutFuture.get(5, TimeUnit.SECONDS)

            assertTrue(logoutOk)
            assertEquals(200, logoutStatus)
            assertEquals(401, apiRes.status)
            assertEquals("Bearer rotated-during-logout", logoutAuthHeader.get())
            assertEquals(SessionLifecycleState.SIGNED_OUT, vault.read().state)
            assertNull(vault.read().accessToken)
            assertNull(vault.read().refreshToken)
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun enforcesServerUrlPolicyAndApiPathAllowlist() {
        val releaseCore = buildCore(defaultUrl = "http://127.0.0.1:${server.port}", allowDebugLoopbackHttp = false)
        assertFalse(releaseCore.getServerConfig().valid)
        val rejected = releaseCore.executeApiRequest("GET", "/api/v1/me")
        assertEquals("SERVER_URL_INVALID", rejected.errorCode)

        val debugCore = buildCore()
        for (badPath in listOf("https://evil.example/api/v1/me", "//evil.example/api/v1/me", "/login", "/api/../secret")) {
            assertFalse(RunNoteTransportCore.isValidApiPath(badPath))
            assertEquals(400, debugCore.executeApiRequest("GET", badPath).status)
        }
    }

    private class InMemoryTransportVault : TransportVault {
        private var snapshot = TransportSessionSnapshot.empty()

        @Synchronized
        override fun read(): TransportSessionSnapshot = snapshot

        @Synchronized
        override fun saveActiveSession(
            serverUrl: String,
            accountId: String,
            accessToken: String,
            accessExpiresAtIso: String,
            refreshToken: String,
            refreshExpiresAtIso: String,
            userJson: String,
        ) {
            snapshot = TransportSessionSnapshot(
                state = SessionLifecycleState.ACTIVE,
                serverUrl = serverUrl,
                serverOriginHash = sha256Hex(serverUrl),
                accountId = accountId,
                accessToken = accessToken,
                accessExpiresAtIso = accessExpiresAtIso,
                refreshToken = refreshToken,
                refreshExpiresAtIso = refreshExpiresAtIso,
                userJson = userJson,
            )
        }

        @Synchronized
        override fun markReauthRequired(preserveServerUrl: String?, preserveAccountId: String?) {
            snapshot = snapshot.copy(
                state = SessionLifecycleState.REAUTH_REQUIRED,
                serverUrl = preserveServerUrl ?: snapshot.serverUrl,
                serverOriginHash = (preserveServerUrl ?: snapshot.serverUrl)?.let { sha256Hex(it) },
                accountId = preserveAccountId ?: snapshot.accountId,
                accessToken = null,
                accessExpiresAtIso = null,
                refreshToken = null,
                refreshExpiresAtIso = null,
            )
        }

        @Synchronized
        override fun clearSession(preserveServerUrl: String?) {
            snapshot = TransportSessionSnapshot.empty(serverUrl = preserveServerUrl)
        }
    }
}
