package dev.yougotserved.thorium

import android.view.InputDevice
import android.view.MotionEvent
import org.junit.Assert.assertEquals
import org.junit.Test

class GameControllerDirectionTest {
    @Test
    fun shallowStickDirectionSurvivesTheNativeBridge() {
        listOf(0.1, -0.1).forEach { y ->
            val input = motion(mapOf(MotionEvent.AXIS_X to 0.5, MotionEvent.AXIS_Y to y))
            assertEquals(0.5, input.axes["left-x"])
            assertEquals(y, input.axes["left-y"])
        }
    }

    @Test
    fun diagonalOutsideCircularDeadzoneIsNotLostToSeparateAxisThresholds() {
        val input = motion(mapOf(MotionEvent.AXIS_X to 0.12, MotionEvent.AXIS_Y to 0.12))
        assertEquals(0.12, input.axes["left-x"])
        assertEquals(0.12, input.axes["left-y"])
    }

    @Test
    fun rightStickFallbackPreservesShallowDirectionsToo() {
        val input = motion(mapOf(MotionEvent.AXIS_RX to -0.1, MotionEvent.AXIS_RY to -0.8))
        assertEquals(-0.1, input.axes["right-x"])
        assertEquals(-0.8, input.axes["right-y"])
    }

    @Test
    fun centerNoiseStillBecomesNeutral() {
        val input = motion(mapOf(MotionEvent.AXIS_X to 0.05, MotionEvent.AXIS_Y to -0.05))
        assertEquals(0.0, input.axes["left-x"])
        assertEquals(0.0, input.axes["left-y"])
    }

    private fun motion(axes: Map<Int, Double>): ControllerDeviceInput = requireNotNull(
        AndroidGameControllerInput.motion(
            1, InputDevice.SOURCE_JOYSTICK, MotionEvent.ACTION_MOVE, ControllerMotionAxes(axes),
        ),
    )
}
