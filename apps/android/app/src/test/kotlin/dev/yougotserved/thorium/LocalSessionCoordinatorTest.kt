package dev.yougotserved.thorium

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalSessionCoordinatorTest {
    @Test
    fun routesControllerInputToMainExactlyOnceAcrossFocusChanges() {
        val launch = launch("controller-routing")
        val main = RecordingEndpoint()
        val companion = RecordingEndpoint()
        LocalSessionCoordinator.register(launch, SurfaceRole.MAIN, main)
        LocalSessionCoordinator.register(launch, SurfaceRole.COMPANION, companion)
        try {
            assertTrue(
                LocalSessionCoordinator.handleSouthButton(
                    launch,
                    SurfaceRole.COMPANION,
                    ControllerKeyInput(ControllerKeyPhase.DOWN, 0),
                ),
            )
            assertTrue(
                LocalSessionCoordinator.handleSouthButton(
                    launch,
                    SurfaceRole.MAIN,
                    ControllerKeyInput(ControllerKeyPhase.DOWN, 2),
                ),
            )
            assertTrue(
                LocalSessionCoordinator.handleSouthButton(
                    launch,
                    SurfaceRole.MAIN,
                    ControllerKeyInput(ControllerKeyPhase.UP, 0),
                ),
            )

            assertEquals(2, main.messages.size)
            assertTrue(companion.messages.isEmpty())
            val pressed = JSONObject(main.messages[0]).getJSONObject("event")
            val released = JSONObject(main.messages[1]).getJSONObject("event")
            assertEquals("tap", pressed.getString("control"))
            assertEquals(0, pressed.getInt("player"))
            assertEquals("pressed", pressed.getString("phase"))
            assertEquals(0L, pressed.getLong("sequence"))
            assertEquals("released", released.getString("phase"))
            assertEquals(1L, released.getLong("sequence"))
        } finally {
            LocalSessionCoordinator.unregister(launch, SurfaceRole.MAIN, main)
            LocalSessionCoordinator.unregister(launch, SurfaceRole.COMPANION, companion)
        }
    }

    @Test
    fun routesTheSouthButtonToTheReleaseAuthoredCompanionSeatOwner() {
        val launch = launch("companion-controller-routing").copy(
            southButtonBinding = SouthButtonBinding(
                playerSlot = 0,
                controlId = "tap",
                surfaceRole = SurfaceRole.COMPANION,
            ),
            maxLocalSlots = 1,
            localPlayerSlots = setOf(0),
            controlledPlayerSlots = mapOf(
                SurfaceRole.MAIN to emptySet(),
                SurfaceRole.COMPANION to setOf(0),
            ),
        )
        val main = RecordingEndpoint()
        val companion = RecordingEndpoint()
        LocalSessionCoordinator.register(launch, SurfaceRole.MAIN, main)
        LocalSessionCoordinator.register(launch, SurfaceRole.COMPANION, companion)
        try {
            assertTrue(
                LocalSessionCoordinator.handleSouthButton(
                    launch,
                    SurfaceRole.MAIN,
                    ControllerKeyInput(ControllerKeyPhase.DOWN, 0),
                ),
            )
            assertTrue(main.messages.isEmpty())
            assertEquals(1, companion.messages.size)
        } finally {
            LocalSessionCoordinator.unregister(launch, SurfaceRole.MAIN, main)
            LocalSessionCoordinator.unregister(launch, SurfaceRole.COMPANION, companion)
        }
    }

    @Test
    fun terminatingASessionNotifiesEveryRemainingSurfaceAndRemovesRouting() {
        val launch = launch("terminate-session")
        val main = RecordingEndpoint()
        val companion = RecordingEndpoint()
        LocalSessionCoordinator.register(launch, SurfaceRole.MAIN, main)
        LocalSessionCoordinator.register(launch, SurfaceRole.COMPANION, companion)

        LocalSessionCoordinator.terminate(launch)
        LocalSessionCoordinator.route(launch, SurfaceRole.MAIN, "after-termination")

        assertEquals(1, main.terminations)
        assertEquals(1, companion.terminations)
        assertTrue(companion.messages.isEmpty())
    }

    private fun launch(sessionId: String): GameLaunch = GameLaunch(
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
        southButtonBinding = SouthButtonBinding(playerSlot = 0, controlId = "tap"),
        maxLocalSlots = 2,
        localPlayerSlots = setOf(0, 1),
        maxLocalPeerMessageBytes = 4096,
        contentDigest = DIGEST,
        capabilities = emptySet(),
        controlledPlayerSlots = mapOf(
            SurfaceRole.MAIN to setOf(0),
            SurfaceRole.COMPANION to setOf(1),
        ),
    )

    private class RecordingEndpoint : LocalSessionCoordinator.Endpoint {
        val messages = mutableListOf<String>()
        var terminations = 0

        override fun deliver(message: String) {
            messages += message
        }

        override fun terminateGameSession() {
            terminations += 1
        }
    }

    companion object {
        private const val DIGEST =
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
}
