package dev.yougotserved.thorium

import android.view.KeyEvent
import android.view.InputDevice
import android.view.MotionEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AndroidGameControllerInputTest {
    @Test
    fun respectsTheLargerOfHardwareFlatAndContractDeadzone() {
        val input = AndroidGameControllerInput.motion(1, InputDevice.SOURCE_GAMEPAD, MotionEvent.ACTION_MOVE,
            ControllerMotionAxes(
                mapOf(MotionEvent.AXIS_X to 0.24, MotionEvent.AXIS_Y to 0.14, MotionEvent.AXIS_Z to 0.5),
                mapOf(MotionEvent.AXIS_X to 0.3, MotionEvent.AXIS_Y to 0.05, MotionEvent.AXIS_Z to 0.3),
            ),
        )!!
        assertEquals(0.0, input.axes.getValue("left-x"), 0.0)
        assertEquals(0.0, input.axes.getValue("left-y"), 0.0)
        assertEquals(0.5, input.axes.getValue("right-x"), 0.0)
    }

    @Test
    fun motionKeepsBothSticksTriggersAndHatSeparateAndUsesStandardFallbackAxes() {
        val readings = ControllerMotionAxes(mapOf(
            0 to -0.75, 1 to 0.5, 11 to 0.25, 14 to -0.4,
            23 to 0.8, 22 to 0.9, 15 to -1.0, 16 to 1.0,
        ))
        val input = AndroidGameControllerInput.motion(
            9, InputDevice.SOURCE_JOYSTICK, MotionEvent.ACTION_MOVE, readings,
        )!!
        assertEquals(mapOf("left-x" to -0.75, "left-y" to 0.5, "right-x" to 0.25, "right-y" to -0.4,
            "left-trigger" to 0.8, "right-trigger" to 0.9), input.axes)
        val expectedButtons = mapOf("dpad-up" to false, "dpad-down" to true, "dpad-left" to true, "dpad-right" to false)
        assertEquals(expectedButtons, input.buttons)
        assertEquals("hat", input.buttonSource)
        assertNull(AndroidGameControllerInput.motion(
            9, InputDevice.SOURCE_MOUSE, MotionEvent.ACTION_MOVE, ControllerMotionAxes(emptyMap()),
        ))
    }

    @Test
    fun translatesEveryPortableButtonAndPreservesDeviceIdentity() {
        val buttons = mapOf(
            96 to "south", 97 to "east", 99 to "west", 100 to "north",
            19 to "dpad-up", 20 to "dpad-down", 21 to "dpad-left", 22 to "dpad-right",
            102 to "left-shoulder", 103 to "right-shoulder", 106 to "left-stick",
            107 to "right-stick", 108 to "start", 109 to "select",
        )
        buttons.forEach { (key, button) ->
            val press = AndroidGameControllerInput.key(42, key, KeyEvent.ACTION_DOWN)
            assertEquals(mapOf(button to true), press?.buttons)
            assertEquals(42, press?.deviceId)
            assertEquals(mapOf(button to false), AndroidGameControllerInput.key(42, key, KeyEvent.ACTION_UP)?.buttons)
        }
        assertNull(AndroidGameControllerInput.key(42, KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.ACTION_DOWN))
    }
}
