package dev.yougotserved.thorium

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalSessionCoordinatorTest {
    @Test
    fun nativeProfilesRouteTwoAssignedDevicesToTheirActualOwnersAcrossFocusAndBackground() {
        val launch = launch("authored-controllers").copy(
            southButtonBinding = null,
            controllerBindings = ControllerBindings(bindings = listOf(ControllerBinding("button", "east", "tap"))),
        )
        val main = RecordingEndpoint()
        val companion = RecordingEndpoint()
        LocalSessionCoordinator.register(launch, SurfaceRole.MAIN, main)
        LocalSessionCoordinator.register(launch, SurfaceRole.COMPANION, companion)
        try {
            LocalSessionCoordinator.setSurfaceVisible(launch, SurfaceRole.MAIN, true)
            LocalSessionCoordinator.setSurfaceVisible(launch, SurfaceRole.COMPANION, true)
            LocalSessionCoordinator.assignController(launch, 11, 0)
            LocalSessionCoordinator.assignController(launch, 22, 1)
            assertTrue(LocalSessionCoordinator.handleController(launch, SurfaceRole.COMPANION, ControllerDeviceInput(11, buttons = mapOf("east" to true))))
            assertTrue(LocalSessionCoordinator.handleController(launch, SurfaceRole.MAIN, ControllerDeviceInput(22, buttons = mapOf("east" to true))))
            assertEquals(0, JSONObject(main.messages.single()).getJSONObject("event").getInt("player"))
            assertEquals(1, JSONObject(companion.messages.single()).getJSONObject("event").getInt("player"))
            LocalSessionCoordinator.setSurfaceVisible(launch, SurfaceRole.MAIN, false)
            assertEquals(1, companion.messages.size)
            LocalSessionCoordinator.setSurfaceVisible(launch, SurfaceRole.COMPANION, false)
            assertEquals("released", JSONObject(main.messages.last()).getJSONObject("event").getString("phase"))
            assertEquals("released", JSONObject(companion.messages.last()).getJSONObject("event").getString("phase"))
        } finally {
            LocalSessionCoordinator.unregister(launch, SurfaceRole.MAIN, main)
            LocalSessionCoordinator.unregister(launch, SurfaceRole.COMPANION, companion)
        }
    }

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

    @Test
    fun finishingMainClosesItsCompanionTaskAndRemovesRouting() {
        val launch = launch("main-finished")
        val main = RecordingEndpoint()
        val companion = RecordingEndpoint()
        LocalSessionCoordinator.register(launch, SurfaceRole.MAIN, main)
        LocalSessionCoordinator.register(launch, SurfaceRole.COMPANION, companion)
        try {
            LocalSessionCoordinator.onSurfaceDestroyed(launch, SurfaceRole.MAIN, isFinishing = true)
            LocalSessionCoordinator.onSurfaceDestroyed(launch, SurfaceRole.MAIN, isFinishing = true)
            LocalSessionCoordinator.route(launch, SurfaceRole.MAIN, "stale-peer")
            assertEquals(1, companion.terminations)
            assertEquals(1, main.terminations)
            assertTrue(companion.messages.isEmpty())
        } finally {
            LocalSessionCoordinator.unregister(launch, SurfaceRole.MAIN, main)
            LocalSessionCoordinator.unregister(launch, SurfaceRole.COMPANION, companion)
        }
    }

    @Test
    fun recreatingMainDoesNotTerminateTheLiveSessionOrItsCompanion() {
        val launch = launch("main-recreated")
        val main = RecordingEndpoint()
        val companion = RecordingEndpoint()
        LocalSessionCoordinator.register(launch, SurfaceRole.MAIN, main)
        LocalSessionCoordinator.register(launch, SurfaceRole.COMPANION, companion)
        try {
            LocalSessionCoordinator.onSurfaceDestroyed(launch, SurfaceRole.MAIN, isFinishing = false)
            LocalSessionCoordinator.route(launch, SurfaceRole.MAIN, "live-peer")
            assertEquals(0, main.terminations)
            assertEquals(0, companion.terminations)
            assertEquals(listOf("live-peer"), companion.messages)
        } finally {
            LocalSessionCoordinator.unregister(launch, SurfaceRole.MAIN, main)
            LocalSessionCoordinator.unregister(launch, SurfaceRole.COMPANION, companion)
        }
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
