package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Test

class GameRequestPolicyTest {
    @Test
    fun allowsOnlyVerifiedPackageAssetsWithoutNetworkCapability() {
        val policy = policy(emptySet())

        assertEquals(
            GameRequestDecision.PACKAGE_ASSET,
            policy.decide(
                "https://appassets.androidplatform.net/installed-games/releases/" +
                    "dev.yougotserved.tap-race/0.1.0/${"a".repeat(64)}/main/index.html",
            ),
        )
        assertEquals(
            GameRequestDecision.BLOCKED,
            policy.decide("https://games.yougotserved.dev/v1/sessions"),
        )
        assertEquals(true, policy.contentSecurityPolicy.contains("connect-src 'none'"))
        assertEquals(true, policy.contentSecurityPolicy.contains("worker-src 'none'"))
        assertEquals(
            GameRequestDecision.BLOCKED,
            policy.decide(
                "https://appassets.androidplatform.net/games/other.game/main/index.html",
            ),
        )
    }

    @Test
    fun colyseusCapabilityAllowsOnlyConfiguredPlatformAuthority() {
        val policy = policy(withSessionCapability = true)

        assertEquals(
            GameRequestDecision.PLATFORM_NETWORK,
            policy.decide("https://games.yougotserved.dev/v1/matchmake"),
        )
        assertEquals(
            GameRequestDecision.PLATFORM_NETWORK,
            policy.decide("wss://games.yougotserved.dev/game-session?id=1"),
        )
        assertEquals(
            GameRequestDecision.BLOCKED,
            policy.decide("https://evil.example/v1/matchmake"),
        )
        assertEquals(
            GameRequestDecision.BLOCKED,
            policy.decide("https://games.yougotserved.dev.evil.example/v1/matchmake"),
        )
        assertEquals(
            GameRequestDecision.BLOCKED,
            policy.decide("https://games.yougotserved.dev:444/v1/matchmake"),
        )
        assertEquals(
            GameRequestDecision.BLOCKED,
            policy.decide("http://games.yougotserved.dev/v1/matchmake"),
        )
        assertEquals(
            GameRequestDecision.BLOCKED,
            policy.decide("https://games.yougotserved.dev@evil.example/v1/matchmake"),
        )
        assertEquals(
            true,
            policy.contentSecurityPolicy.contains(
                "connect-src https://games.yougotserved.dev wss://games.yougotserved.dev",
            ),
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsAmbiguousConfiguredPlatformUrl() {
        GameRequestPolicy.create(
            launch(
                capabilities = setOf("colyseus-session"),
                capabilityEndpoint = "https://games.yougotserved.dev/#fragment",
            ),
            SurfaceRole.MAIN,
        )
    }

    private fun policy(
        capabilities: Set<String> = emptySet(),
        withSessionCapability: Boolean = false,
    ): GameRequestPolicy = GameRequestPolicy.create(
        launch(
            capabilities = capabilities + if (withSessionCapability) {
                setOf("colyseus-session")
            } else {
                emptySet()
            },
            capabilityEndpoint = if (withSessionCapability) {
                "https://games.yougotserved.dev"
            } else {
                null
            },
        ),
        SurfaceRole.MAIN,
    )

    private fun launch(
        capabilities: Set<String>,
        capabilityEndpoint: String? = null,
    ): GameLaunch {
        val digest = "a".repeat(64)
        val sessionId = "request-policy"
        val surfaceCapabilities = capabilityEndpoint?.let { endpoint ->
            mapOf(
                SurfaceRole.MAIN to ColyseusSessionCapability(
                    endpoint = endpoint,
                    roomName = "game_session",
                    ticket = "ticket",
                    expiresAtEpochMs = Long.MAX_VALUE,
                    joinOptions = mapOf(
                        "gameSessionId" to sessionId,
                        "packageId" to "dev.yougotserved.tap-race",
                        "packageVersion" to "0.1.0",
                        "packageDigest" to digest,
                    ),
                ),
            )
        }.orEmpty()
        return GameLaunch(
        packageId = "dev.yougotserved.tap-race",
        version = "0.1.0",
        sessionId = sessionId,
        mainEntrypoint = "main/index.html",
        companionEntrypoint = "companion/index.html",
        runtimeFiles = setOf("main/index.html", "companion/index.html", "dist/game.js"),
        logicalWidth = 960,
        logicalHeight = 540,
        maximumDevicePixelRatio = 2.0,
        companionLogicalWidth = 960,
        companionLogicalHeight = 540,
        companionMaximumDevicePixelRatio = 2.0,
        controls = listOf(ReleaseControl("tap", "Tap", "button")),
        southButtonBinding = SouthButtonBinding(0, "tap"),
        maxLocalSlots = 2,
        localPlayerSlots = setOf(0, 1),
        maxLocalPeerMessageBytes = 4096,
        contentDigest = digest,
        capabilities = capabilities,
        controlledPlayerSlots = mapOf(
            SurfaceRole.MAIN to setOf(0),
            SurfaceRole.COMPANION to setOf(1),
        ),
        surfaceCapabilities = surfaceCapabilities,
    )
    }
}
