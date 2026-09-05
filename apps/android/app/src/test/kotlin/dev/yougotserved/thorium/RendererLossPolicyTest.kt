package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Test

class RendererLossPolicyTest {
    @Test
    fun recreatesLocalSurfacesButTerminatesSurfacesHoldingOneUseTickets() {
        val game = TestPackages.installedGame().copy(contentDigest = DIGEST)
        val controlled = mapOf(
            SurfaceRole.MAIN to setOf(0),
            SurfaceRole.COMPANION to setOf(1),
        )
        val local = GameLaunch.from(
            game = game,
            sessionId = "local-session",
            localPlayerSlots = setOf(0, 1),
            controlledPlayerSlots = controlled,
            grantedCapabilities = game.capabilities - "colyseus-session",
        )
        val online = GameLaunch.from(
            game = game,
            sessionId = SESSION_ID,
            localPlayerSlots = setOf(0, 1),
            controlledPlayerSlots = controlled,
            surfaceCapabilities = SurfaceRole.entries.associateWith { role -> capability(role, game) },
        )

        SurfaceRole.entries.forEach { role ->
            assertEquals(
                RendererLossRecovery.RECREATE_LOCAL_SURFACE,
                RendererLossPolicy.recovery(local, role),
            )
            assertEquals(
                RendererLossRecovery.TERMINATE_ONLINE_SESSION,
                RendererLossPolicy.recovery(online, role),
            )
        }
    }

    private fun capability(role: SurfaceRole, game: CatalogGame): ColyseusSessionCapability =
        ColyseusSessionCapability(
            endpoint = "https://games.yougotserved.dev",
            roomName = "game_session",
            ticket = "${role.wireValue}-ticket",
            expiresAtEpochMs = Long.MAX_VALUE,
            joinOptions = mapOf(
                "gameSessionId" to SESSION_ID,
                "packageId" to game.packageId,
                "packageVersion" to game.version,
                "packageDigest" to DIGEST,
            ),
        )

    companion object {
        private const val SESSION_ID = "123e4567-e89b-12d3-a456-426614174000"
        private const val DIGEST =
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
}
