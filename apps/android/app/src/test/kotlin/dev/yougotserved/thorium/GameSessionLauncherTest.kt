package dev.yougotserved.thorium

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class GameSessionLauncherTest {
    @Test
    fun absentAccountAuthorizationStartsLocalWithSafeSurfaceDefaults() {
        val launcher = GameSessionLauncher(
            authority = GameSessionAuthorityPort { _, _ -> error("authority must not be called") },
            accountAuthorization = AccountAuthorizationPort { null },
            releaseIntegrity = GameReleaseIntegrityPort { true },
            nowEpochMs = { NOW },
            newId = { LOCAL_SESSION_ID },
        )

        val result = launcher.start(onlineGame()) as GameSessionStartResult.Ready

        assertEquals(LOCAL_SESSION_ID, result.launch.sessionId)
        assertEquals(setOf(0, 1), result.launch.localPlayerSlots)
        assertEquals(setOf(0), result.launch.controlledPlayerSlots(SurfaceRole.MAIN))
        assertEquals(setOf(1), result.launch.controlledPlayerSlots(SurfaceRole.COMPANION))
        assertTrue(result.launch.surfaceCapabilities.isEmpty())
        assertFalse("colyseus-session" in result.launch.capabilities)
    }

    @Test
    fun singleSlotAccountPolicyDoesNotLeaseACompanionPlayer() {
        val launcher = GameSessionLauncher(
            authority = GameSessionAuthorityPort { _, _ -> error("authority must not be called") },
            accountAuthorization = AccountAuthorizationPort { null },
            releaseIntegrity = GameReleaseIntegrityPort { true },
            nowEpochMs = { NOW },
            newId = { LOCAL_SESSION_ID },
        )
        val game = onlineGame().copy(
            minPlayers = 1,
            maxPlayers = 2,
            maxLocalSlots = 1,
            sameAccountMultipleSlots = false,
        )

        val launch = (launcher.start(game) as GameSessionStartResult.Ready).launch

        assertEquals(setOf(0), launch.localPlayerSlots)
        assertEquals(setOf(0), launch.controlledPlayerSlots(SurfaceRole.MAIN))
        assertTrue(launch.controlledPlayerSlots(SurfaceRole.COMPANION).isEmpty())
    }

    @Test
    fun failsBeforeAuthorityWhenOneAccountCannotSatisfyMinimumPlayers() {
        val launcher = GameSessionLauncher(
            authority = GameSessionAuthorityPort { _, _ -> error("authority must not be called") },
            accountAuthorization = AccountAuthorizationPort {
                AccountAuthorization(ACCOUNT_TOKEN)
            },
            releaseIntegrity = GameReleaseIntegrityPort { true },
            nowEpochMs = { NOW },
            newId = { LOCAL_SESSION_ID },
        )
        val game = onlineGame().copy(
            minPlayers = 2,
            maxPlayers = 2,
            maxLocalSlots = 1,
            sameAccountMultipleSlots = false,
        )

        val result = launcher.start(game) as GameSessionStartResult.Failed

        assertEquals(GameSessionStartFailure.LOCAL_PLAYER_POLICY, result.reason)
    }

    @Test
    fun installedIntegrityFailureStopsBeforeCredentialsOrAuthority() {
        var accountAuthorizationRequested = false
        val launcher = GameSessionLauncher(
            authority = GameSessionAuthorityPort { _, _ -> error("authority must not be called") },
            accountAuthorization = AccountAuthorizationPort {
                accountAuthorizationRequested = true
                AccountAuthorization(ACCOUNT_TOKEN)
            },
            releaseIntegrity = GameReleaseIntegrityPort { false },
            nowEpochMs = { NOW },
            newId = { LOCAL_SESSION_ID },
        )

        val result = launcher.start(onlineGame()) as GameSessionStartResult.Failed

        assertEquals(GameSessionStartFailure.RELEASE_INTEGRITY, result.reason)
        assertFalse(accountAuthorizationRequested)
    }

    @Test
    fun offlineManifestWithColyseusCapabilityDoesNotContactAuthority() {
        val launcher = GameSessionLauncher(
            authority = GameSessionAuthorityPort { _, _ -> error("authority must not be called") },
            accountAuthorization = AccountAuthorizationPort {
                AccountAuthorization(ACCOUNT_TOKEN)
            },
            releaseIntegrity = GameReleaseIntegrityPort { true },
            nowEpochMs = { NOW },
            newId = { LOCAL_SESSION_ID },
        )

        val launch = (
            launcher.start(onlineGame().copy(multiplayerOnline = false))
                as GameSessionStartResult.Ready
            ).launch

        assertTrue(launch.surfaceCapabilities.isEmpty())
        assertFalse("colyseus-session" in launch.capabilities)
    }

    @Test
    fun platformUnavailabilityFallsBackButContractMismatchFailsClosed() {
        val unavailable = launcherWithAuthority {
            throw GameSessionAuthorityUnavailableException()
        }
        assertTrue(unavailable.start(onlineGame()) is GameSessionStartResult.Ready)

        val mismatched = launcherWithAuthority { request ->
            validSession(request).copy(
                joinOptions = validSession(request).joinOptions.copy(
                    packageDigest = "b".repeat(64),
                ),
            )
        }
        assertEquals(
            GameSessionStartFailure.AUTHORITY_RESPONSE_MISMATCH,
            (mismatched.start(onlineGame()) as GameSessionStartResult.Failed).reason,
        )
    }

    @Test
    fun onlineSessionMapsEachSeatLeaseAndCapabilityToOnlyItsSurface() {
        var observed: GameSessionStartRequest? = null
        val launcher = launcherWithAuthority { request ->
            observed = request
            validSession(request)
        }

        val launch = (launcher.start(onlineGame()) as GameSessionStartResult.Ready).launch

        assertEquals(ONLINE_SESSION_ID, launch.sessionId)
        assertEquals(setOf(0, 1), launch.localPlayerSlots)
        assertEquals(setOf(0), launch.controlledPlayerSlots(SurfaceRole.MAIN))
        assertEquals(setOf(1), launch.controlledPlayerSlots(SurfaceRole.COMPANION))
        assertEquals(setOf(SurfaceRole.MAIN, SurfaceRole.COMPANION), launch.surfaceCapabilities.keys)
        assertEquals("main-ticket", launch.sessionCapability(SurfaceRole.MAIN)?.ticket)
        assertEquals("companion-ticket", launch.sessionCapability(SurfaceRole.COMPANION)?.ticket)
        assertEquals(DIGEST, observed?.release?.contentDigest)
        assertEquals("00000000-0000-0000-0000-000000000001", observed?.requestId)

        val mainBootstrap = bootstrap(launch, SurfaceRole.MAIN)
        val companionBootstrap = bootstrap(launch, SurfaceRole.COMPANION)
        assertEquals(listOf(0), mainBootstrap.intArray("controlledPlayerSlots"))
        assertEquals(listOf(1), companionBootstrap.intArray("controlledPlayerSlots"))
        assertEquals("main-ticket", mainBootstrap.getJSONObject("colyseus").getString("ticket"))
        assertEquals(
            "companion-ticket",
            companionBootstrap.getJSONObject("colyseus").getString("ticket"),
        )
        assertEquals(2, mainBootstrap.getJSONArray("players").length())
    }

    @Test
    fun eachOnlineStartGetsOneDistinctRequestId() {
        val observed = mutableListOf<GameSessionStartRequest>()
        val launcher = launcherWithAuthority { request ->
            observed += request
            validSession(request)
        }

        assertTrue(launcher.start(onlineGame()) is GameSessionStartResult.Ready)
        assertTrue(launcher.start(onlineGame()) is GameSessionStartResult.Ready)

        assertEquals(
            listOf(
                "00000000-0000-0000-0000-000000000001",
                "00000000-0000-0000-0000-000000000004",
            ),
            observed.map(GameSessionStartRequest::requestId),
        )
    }

    @Test
    fun httpAdapterSendsExactReleaseAndNumericSlotsWithoutPuttingAccountTokenInBody() {
        val request = request()
        val response = responseJson(request)
        val connection = SessionHttpConnection(
            URI("https://games.yougotserved.dev/v1/game-sessions").toURL(),
            response.toByteArray(),
        )
        val adapter = HttpGameSessionAuthorityAdapter(
            baseUrl = "https://games.yougotserved.dev",
            openConnection = { uri ->
                assertEquals("https://games.yougotserved.dev/v1/game-sessions", uri.toString())
                connection
            },
            nowEpochMs = { NOW },
        )

        val session = adapter.start(request, AccountAuthorization(ACCOUNT_TOKEN))

        val sent = connection.output.toString(Charsets.UTF_8.name())
        val body = JSONObject(sent)
        assertEquals(REQUEST_ID, body.getString("requestId"))
        assertEquals(DIGEST, body.getJSONObject("release").getString("contentDigest"))
        assertEquals(0, body.getJSONArray("surfaces").getJSONObject(0)
            .getJSONArray("playerSlots").getInt(0))
        assertFalse(sent.contains(ACCOUNT_TOKEN))
        assertEquals("Bearer $ACCOUNT_TOKEN", connection.getRequestProperty("Authorization"))
        assertEquals(ONLINE_SESSION_ID, session.gameSessionId)
        assertTrue(connection.disconnected)
    }

    @Test
    fun httpAdapterAcceptsCreatedAndIdempotentReplayResponses() {
        listOf(HttpURLConnection.HTTP_CREATED, HttpURLConnection.HTTP_OK).forEach { status ->
            val request = request()
            val connection = SessionHttpConnection(
                URI("https://games.yougotserved.dev/v1/game-sessions").toURL(),
                responseJson(request).toByteArray(),
                status = status,
            )
            val adapter = HttpGameSessionAuthorityAdapter(
                baseUrl = "https://games.yougotserved.dev",
                openConnection = { connection },
                nowEpochMs = { NOW },
            )

            assertEquals(
                ONLINE_SESSION_ID,
                adapter.start(request, AccountAuthorization(ACCOUNT_TOKEN)).gameSessionId,
            )
            assertTrue("HTTP $status connection must be disconnected", connection.disconnected)
        }
    }

    @Test
    fun httpAdapterRejectsStatusesOtherThanCreatedOrIdempotentReplay() {
        listOf(HttpURLConnection.HTTP_ACCEPTED, HttpURLConnection.HTTP_CONFLICT).forEach { status ->
            val request = request()
            val connection = SessionHttpConnection(
                URI("https://games.yougotserved.dev/v1/game-sessions").toURL(),
                responseJson(request).toByteArray(),
                status = status,
            )
            val adapter = HttpGameSessionAuthorityAdapter(
                baseUrl = "https://games.yougotserved.dev",
                openConnection = { connection },
                nowEpochMs = { NOW },
            )

            assertThrows(GameSessionAuthorityRejectedException::class.java) {
                adapter.start(request, AccountAuthorization(ACCOUNT_TOKEN))
            }
            assertTrue("HTTP $status connection must be disconnected", connection.disconnected)
        }

        val request = request()
        val unavailable = SessionHttpConnection(
            URI("https://games.yougotserved.dev/v1/game-sessions").toURL(),
            responseJson(request).toByteArray(),
            status = HttpURLConnection.HTTP_UNAVAILABLE,
        )
        val adapter = HttpGameSessionAuthorityAdapter(
            baseUrl = "https://games.yougotserved.dev",
            openConnection = { unavailable },
            nowEpochMs = { NOW },
        )

        assertThrows(GameSessionAuthorityUnavailableException::class.java) {
            adapter.start(request, AccountAuthorization(ACCOUNT_TOKEN))
        }
        assertTrue(unavailable.disconnected)
    }

    @Test
    fun malformedRuntimeResponseValuesBecomeAuthorityMismatchFailures() {
        val base = JSONObject(responseJson(request()))
        val malformed = listOf(
            JSONObject(base.toString()).put("endpoint", "relative-endpoint"),
            JSONObject(base.toString()).put(
                "expiresAt",
                "+1000000000-12-31T23:59:59.999999999Z",
            ),
            JSONObject(base.toString()).apply {
                put("gameSessionId", "1-1-1-1-1")
                getJSONObject("joinOptions").put("gameSessionId", "1-1-1-1-1")
            },
        )

        malformed.forEach { response ->
            val connection = SessionHttpConnection(
                URI("https://games.yougotserved.dev/v1/game-sessions").toURL(),
                response.toString().toByteArray(),
            )
            val launcher = GameSessionLauncher(
                authority = HttpGameSessionAuthorityAdapter(
                    baseUrl = "https://games.yougotserved.dev",
                    openConnection = { connection },
                    nowEpochMs = { NOW },
                ),
                accountAuthorization = AccountAuthorizationPort {
                    AccountAuthorization(ACCOUNT_TOKEN)
                },
                releaseIntegrity = GameReleaseIntegrityPort { true },
                nowEpochMs = { NOW },
                newId = { "client" },
            )

            val result = launcher.start(onlineGame()) as GameSessionStartResult.Failed

            assertEquals(GameSessionStartFailure.AUTHORITY_RESPONSE_MISMATCH, result.reason)
            assertTrue(connection.disconnected)
        }
    }

    @Test
    fun manifestCapabilityWithoutAnIssuedSurfaceCapabilityDoesNotGrantNetworkEgress() {
        val launch = GameLaunch.from(
            game = onlineGame(),
            sessionId = LOCAL_SESSION_ID,
            localPlayerSlots = setOf(0, 1),
            controlledPlayerSlots = mapOf(
                SurfaceRole.MAIN to setOf(0),
                SurfaceRole.COMPANION to setOf(1),
            ),
            surfaceCapabilities = emptyMap(),
        )

        val policy = GameRequestPolicy.create(launch, SurfaceRole.MAIN)

        assertEquals(
            GameRequestDecision.BLOCKED,
            policy.decide("wss://games.yougotserved.dev/game_session"),
        )
        assertTrue(policy.contentSecurityPolicy.contains("connect-src 'none'"))
    }

    private fun launcherWithAuthority(
        start: (GameSessionStartRequest) -> AuthorityGameSession,
    ): GameSessionLauncher {
        var sequence = 0
        return GameSessionLauncher(
            authority = GameSessionAuthorityPort { request, authorization ->
                assertEquals(ACCOUNT_TOKEN, authorization.bearerToken)
                start(request)
            },
            accountAuthorization = AccountAuthorizationPort {
                AccountAuthorization(ACCOUNT_TOKEN)
            },
            releaseIntegrity = GameReleaseIntegrityPort { true },
            nowEpochMs = { NOW },
            newId = { "00000000-0000-0000-0000-${(++sequence).toString().padStart(12, '0')}" },
        )
    }

    private fun onlineGame(): CatalogGame = DemoCatalog.games.single().copy(
        contentDigest = DIGEST,
    )

    private fun request(): GameSessionStartRequest = GameSessionStartRequest(
        requestId = REQUEST_ID,
        release = ExactGameRelease(
            packageId = "dev.yougotserved.tap-race",
            version = "0.1.0",
            contentDigest = DIGEST,
        ),
        surfaces = listOf(
            RequestedSurface("main-client", SurfaceRole.MAIN, setOf(0)),
            RequestedSurface("companion-client", SurfaceRole.COMPANION, setOf(1)),
        ),
    )

    private fun validSession(request: GameSessionStartRequest): AuthorityGameSession =
        AuthorityGameSession(
            endpoint = "https://games.yougotserved.dev",
            gameSessionId = ONLINE_SESSION_ID,
            roomName = "game_session",
            expiresAtEpochMs = NOW + 60_000,
            joinOptions = AuthorityJoinOptions(
                gameSessionId = ONLINE_SESSION_ID,
                packageId = request.release.packageId,
                packageVersion = request.release.version,
                packageDigest = request.release.contentDigest,
            ),
            surfaces = request.surfaces.map { surface ->
                AuthoritySurfaceTicket(
                    surfaceId = surface.surfaceId,
                    role = surface.role,
                    playerSlots = surface.playerSlots,
                    ticket = "${surface.role.wireValue}-ticket",
                )
            },
        )

    private fun responseJson(request: GameSessionStartRequest): String {
        val session = validSession(request)
        return JSONObject()
            .put("endpoint", session.endpoint)
            .put("gameSessionId", session.gameSessionId)
            .put("roomName", session.roomName)
            .put("expiresAt", "2030-01-01T00:00:00Z")
            .put("joinOptions", JSONObject(session.joinOptions.asMap()))
            .put(
                "surfaces",
                JSONArray(session.surfaces.map { surface ->
                    JSONObject()
                        .put("surfaceId", surface.surfaceId)
                        .put("role", surface.role.wireValue)
                        .put("playerSlots", JSONArray(surface.playerSlots.sorted()))
                        .put("ticket", surface.ticket)
                }),
            )
            .toString()
    }

    private fun bootstrap(launch: GameLaunch, role: SurfaceRole): JSONObject =
        JSONObject(GameBootstrapMessage.create(launch, role, "request"))
            .getJSONObject("bootstrap")

    private fun JSONObject.intArray(name: String): List<Int> {
        val array = getJSONArray(name)
        return (0 until array.length()).map(array::getInt)
    }

    companion object {
        private const val DIGEST =
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        private const val ACCOUNT_TOKEN = "native-account-secret"
        private const val LOCAL_SESSION_ID = "local-session"
        private const val ONLINE_SESSION_ID = "123e4567-e89b-12d3-a456-426614174000"
        private const val REQUEST_ID = "123e4567-e89b-12d3-a456-426614174001"
        private const val NOW = 1_700_000_000_000L
    }
}

private class SessionHttpConnection(
    url: URL,
    private val response: ByteArray,
    private val status: Int = HttpURLConnection.HTTP_CREATED,
) : HttpURLConnection(url) {
    val output = ByteArrayOutputStream()
    var disconnected = false
        private set

    override fun getResponseCode(): Int = status
    override fun getContentLengthLong(): Long = response.size.toLong()
    override fun getInputStream(): InputStream = ByteArrayInputStream(response)
    override fun getOutputStream(): OutputStream = output

    override fun disconnect() {
        disconnected = true
    }

    override fun usingProxy(): Boolean = false
    override fun connect() = Unit
}
