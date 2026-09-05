package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeControllerRouterTest {
    @Test
    fun triggersAreUnsignedAndMalformedAxisValuesReturnToNeutral() {
        val router = NativeControllerRouter(
            ControllerBindings(bindings = listOf(ControllerBinding("axis", "left-trigger", "throttle"))), setOf(0),
        )
        assertTrue(router.accept(ControllerDeviceInput(1, axes = mapOf("left-trigger" to -0.8))).isEmpty())
        assertEquals(1.0, router.accept(ControllerDeviceInput(1, axes = mapOf("left-trigger" to 4.0))).single().value, 0.0)
        assertEquals(0.0, router.accept(ControllerDeviceInput(1, axes = mapOf("left-trigger" to Double.NaN))).single().value, 0.0)
    }

    @Test
    fun multipleControllersRequireExplicitLeasedSlotsAndDisconnectIndependently() {
        val router = NativeControllerRouter(
            ControllerBindings(bindings = listOf(ControllerBinding("button", "south", "boost"))), setOf(2, 5),
        )
        assertTrue(router.needsAssignment(11))
        assertTrue(router.accept(ControllerDeviceInput(11, buttons = mapOf("south" to true))).isEmpty())
        router.assign(11, 5)
        router.assign(22, 2)
        assertEquals(5, router.accept(ControllerDeviceInput(11, buttons = mapOf("south" to true))).single().playerSlot)
        assertEquals(2, router.accept(ControllerDeviceInput(22, buttons = mapOf("south" to true))).single().playerSlot)
        val release = router.disconnect(11).single()
        assertEquals(5, release.playerSlot)
        assertEquals("released", release.phase)
        assertTrue(router.accept(ControllerDeviceInput(22, buttons = mapOf("south" to true))).isEmpty())
        assertEquals(2, router.releaseAll().single().playerSlot)
        assertTrue(router.releaseAll().isEmpty())
        assertThrows(IllegalArgumentException::class.java) { router.assign(33, 0) }
    }

    @Test
    fun neutralHatDoesNotReleaseAHeldKeyDpadAndDuplicateSourcesReleaseOnce() {
        val router = NativeControllerRouter(
            ControllerBindings(bindings = listOf(ControllerBinding("button", "dpad-left", "left"))), setOf(0),
        )
        assertEquals("pressed", router.accept(ControllerDeviceInput(1, buttons = mapOf("dpad-left" to true))).single().phase)
        assertTrue(router.accept(ControllerDeviceInput(1, buttons = mapOf("dpad-left" to false), buttonSource = "hat")).isEmpty())
        assertTrue(router.accept(ControllerDeviceInput(1, buttons = mapOf("dpad-left" to true), buttonSource = "hat")).isEmpty())
        assertTrue(router.accept(ControllerDeviceInput(1, buttons = mapOf("dpad-left" to false))).isEmpty())
        assertEquals("released", router.accept(ControllerDeviceInput(1, buttons = mapOf("dpad-left" to false), buttonSource = "hat")).single().phase)
    }

    @Test
    fun stickDirectionUsesHysteresisAndAggregatesWithTheDpad() {
        val router = NativeControllerRouter(
            ControllerBindings(bindings = listOf(
                ControllerBinding("axis-button", "left-x", "left", -1),
                ControllerBinding("button", "dpad-left", "left"),
            )), setOf(0),
        )
        assertTrue(router.accept(ControllerDeviceInput(1, axes = mapOf("left-x" to -0.59))).isEmpty())
        assertEquals("pressed", router.accept(ControllerDeviceInput(1, axes = mapOf("left-x" to -0.6))).single().phase)
        assertTrue(router.accept(ControllerDeviceInput(1, axes = mapOf("left-x" to -0.4))).isEmpty())
        assertTrue(router.accept(ControllerDeviceInput(1, buttons = mapOf("dpad-left" to true))).isEmpty())
        assertTrue(router.accept(ControllerDeviceInput(1, axes = mapOf("left-x" to -0.35))).isEmpty())
        assertEquals("released", router.accept(ControllerDeviceInput(1, buttons = mapOf("dpad-left" to false))).single().phase)
    }

    @Test
    fun analogValuesPreserveFractionsAndReturnToNeutralThroughTheDeadzone() {
        val router = NativeControllerRouter(
            ControllerBindings(bindings = listOf(ControllerBinding("axis", "left-x", "steer-x"))),
            setOf(0),
        )
        assertTrue(router.accept(ControllerDeviceInput(21, axes = mapOf("left-x" to 0.1))).isEmpty())
        val moved = router.accept(ControllerDeviceInput(21, axes = mapOf("left-x" to -0.75))).single()
        assertEquals(-0.75, moved.value, 0.0)
        assertEquals("changed", moved.phase)
        assertEquals(0.0, router.accept(ControllerDeviceInput(21, axes = mapOf("left-x" to 0.14))).single().value, 0.0)
    }

    @Test
    fun authoredEastButtonReachesTheOnlyAdmittedSlotWithoutGuessingItsNumber() {
        val router = NativeControllerRouter(
            ControllerBindings(bindings = listOf(ControllerBinding("button", "east", "cancel"))),
            setOf(4),
        )
        val press = router.accept(ControllerDeviceInput(21, buttons = mapOf("east" to true)))
        assertEquals(listOf("cancel"), press.map { it.controlId })
        assertEquals(4, press.single().playerSlot)
        assertEquals("pressed", press.single().phase)
        assertTrue(router.accept(ControllerDeviceInput(21, buttons = mapOf("east" to true))).isEmpty())
        assertEquals("released", router.accept(ControllerDeviceInput(21, buttons = mapOf("east" to false))).single().phase)
    }
}
