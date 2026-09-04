package dev.yougotserved.thorium

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HostBridgePolicyTest {
    @Test
    fun acceptsBootstrapRequestAndMatchingReady() {
        val policy = policy(SurfaceRole.MAIN)

        assertEquals(
            HostAction.BootstrapRequested("bootstrap-1"),
            policy.parse("""{"kind":"bootstrap-request","requestId":"bootstrap-1"}"""),
        )
        assertEquals(
            HostAction.Ready,
            policy.parse("""{"kind":"ready","surface":"main"}"""),
        )
    }

    @Test
    fun rejectsMissingOrUnsafeBootstrapRequestIds() {
        val policy = policy(SurfaceRole.MAIN)

        assertNull(policy.parse("""{"kind":"bootstrap-request"}"""))
        assertNull(
            policy.parse("""{"kind":"bootstrap-request","requestId":"<script>"}"""),
        )
    }

    @Test
    fun bootstrapUsesLeasedSlotsAndReleasePeerLimit() {
        val response = JSONObject(
            GameBootstrapMessage.create(
                launch(localPlayerSlots = setOf(1), maxPeerBytes = 23),
                SurfaceRole.COMPANION,
                "bootstrap-7",
            ),
        )
        val bootstrap = response.getJSONObject("bootstrap")

        assertEquals("bootstrap", response.getString("kind"))
        assertEquals("bootstrap-7", response.getString("requestId"))
        assertEquals("companion", bootstrap.getString("surface"))
        assertEquals(1, bootstrap.getJSONArray("players").length())
        assertEquals(1, bootstrap.getJSONArray("players").getJSONObject(0).getInt("slot"))
        assertEquals(1, bootstrap.getJSONArray("controlledPlayerSlots").length())
        assertEquals(1, bootstrap.getJSONArray("controlledPlayerSlots").getInt(0))
        assertEquals(
            23,
            bootstrap.getJSONObject("limits").getInt("maxLocalPeerMessageBytes"),
        )
        assertEquals(
            2.25,
            bootstrap.getJSONObject("render").getDouble("maximumDevicePixelRatio"),
            0.0,
        )
    }

    @Test
    fun normalizesAllowedControlOnlyForALocallyLeasedPlayerSlot() {
        val policy = policy(SurfaceRole.COMPANION, localPlayerSlots = setOf(1))
        val raw = control(player = 1, sequence = 4)

        val action = policy.parse(raw)

        assertTrue(action is HostAction.RouteToPeer)
        val routed = JSONObject((action as HostAction.RouteToPeer).message)
        assertEquals("control", routed.getString("kind"))
        assertEquals(1, routed.getJSONObject("event").getInt("player"))
        assertNull(policy.parse(control(player = 0, sequence = 5)))
    }

    @Test
    fun authorizesOnlyThePlayerSlotsControlledByThisSurface() {
        val launch = launch(localPlayerSlots = setOf(0, 1)).copy(
            controlledPlayerSlots = mapOf(
                SurfaceRole.MAIN to setOf(0),
                SurfaceRole.COMPANION to setOf(1),
            ),
        )
        val main = HostBridgePolicy.forSurface(launch, SurfaceRole.MAIN)
        val companion = HostBridgePolicy.forSurface(launch, SurfaceRole.COMPANION)

        assertTrue(main.parse(control(player = 0, sequence = 0)) is HostAction.RouteToPeer)
        assertNull(main.parse(control(player = 1, sequence = 1)))
        assertTrue(companion.parse(control(player = 1, sequence = 0)) is HostAction.RouteToPeer)
        assertNull(companion.parse(control(player = 0, sequence = 1)))
    }

    @Test
    fun rejectsUnknownControlsAndForgedPeerSources() {
        val policy = policy(
            SurfaceRole.COMPANION,
            capabilities = setOf("same-device-peer"),
        )

        assertNull(
            policy.parse(
                """{"kind":"control","event":{"control":"admin","player":0,"phase":"pressed","value":1,"sequence":0}}""",
            ),
        )
        assertNull(
            policy.parse(
                """{"kind":"control","event":{"control":"tap","player":"0","phase":"pressed","value":1,"sequence":0}}""",
            ),
        )
        assertNull(
            policy.parse("""{"kind":"peer","channel":"score","payload":{},"source":"main"}"""),
        )
    }

    @Test
    fun peerRoutingRequiresCapabilityAndEnforcesSerializedUtf8Bytes() {
        val messageAtLimit = """{"kind":"peer","channel":"score","payload":"éé","source":"main"}"""
        val messageOverLimit = """{"kind":"peer","channel":"score","payload":"ééx","source":"main"}"""

        assertNull(
            policy(SurfaceRole.MAIN, maxPeerBytes = 6).parse(messageAtLimit),
        )
        val capable = policy(
            SurfaceRole.MAIN,
            capabilities = setOf("same-device-peer"),
            maxPeerBytes = 6,
        )
        assertTrue(capable.parse(messageAtLimit) is HostAction.RouteToPeer)
        assertNull(capable.parse(messageOverLimit))
    }

    @Test
    fun controlSequencesIncreaseStrictlyPerWebSurfacePolicyInstance() {
        val main = policy(SurfaceRole.MAIN)
        val companion = policy(SurfaceRole.COMPANION)

        assertTrue(main.parse(control(player = 0, sequence = 4)) is HostAction.RouteToPeer)
        assertNull(main.parse(control(player = 0, sequence = 4)))
        assertNull(main.parse(control(player = 0, sequence = 3)))
        assertNull(
            main.parse(
                """{"kind":"control","event":{"control":"unknown","player":0,"phase":"pressed","value":1,"sequence":10}}""",
            ),
        )
        assertTrue(main.parse(control(player = 0, sequence = 5)) is HostAction.RouteToPeer)
        assertTrue(companion.parse(control(player = 1, sequence = 4)) is HostAction.RouteToPeer)
    }

    @Test
    fun rejectsGrosslyOversizedInputWithoutAdvancingControlSequence() {
        val policy = policy(SurfaceRole.MAIN, maxPeerBytes = 1)

        assertTrue(policy.parse(control(player = 0, sequence = 4)) is HostAction.RouteToPeer)
        assertNull(policy.parse("x".repeat(32 * 1024)))
        assertTrue(policy.parse(control(player = 0, sequence = 5)) is HostAction.RouteToPeer)
    }

    private fun policy(
        role: SurfaceRole,
        localPlayerSlots: Set<Int> = setOf(0, 1),
        capabilities: Set<String> = emptySet(),
        maxPeerBytes: Int = 4096,
    ): HostBridgePolicy = HostBridgePolicy.forSurface(
        launch(localPlayerSlots, capabilities, maxPeerBytes),
        role,
    )

    private fun launch(
        localPlayerSlots: Set<Int> = setOf(0, 1),
        capabilities: Set<String> = emptySet(),
        maxPeerBytes: Int = 4096,
    ): GameLaunch = GameLaunch(
        packageId = "dev.yougotserved.tap-race",
        version = "0.1.0",
        sessionId = "bridge-policy",
        mainEntrypoint = "main/index.html",
        companionEntrypoint = "companion/index.html",
        runtimeFiles = setOf("main/index.html", "companion/index.html", "dist/game.js"),
        logicalWidth = 960,
        logicalHeight = 540,
        maximumDevicePixelRatio = 1.5,
        companionLogicalWidth = 960,
        companionLogicalHeight = 540,
        companionMaximumDevicePixelRatio = 2.25,
        controls = listOf(ReleaseControl("tap", "Tap", "button")),
        southButtonBinding = null,
        maxLocalSlots = 2,
        localPlayerSlots = localPlayerSlots,
        maxLocalPeerMessageBytes = maxPeerBytes,
        contentDigest = null,
        capabilities = capabilities,
        controlledPlayerSlots = mapOf(
            SurfaceRole.MAIN to localPlayerSlots.filterTo(mutableSetOf()) { it == 0 },
            SurfaceRole.COMPANION to localPlayerSlots.filterTo(mutableSetOf()) { it != 0 },
        ),
    )

    private fun control(player: Int, sequence: Long): String = JSONObject()
        .put("kind", "control")
        .put(
            "event",
            JSONObject()
                .put("control", "tap")
                .put("player", player)
                .put("phase", "pressed")
                .put("value", 1)
                .put("sequence", sequence),
        )
        .toString()
}
