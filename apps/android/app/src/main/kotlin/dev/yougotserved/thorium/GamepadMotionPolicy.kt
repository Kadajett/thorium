package dev.yougotserved.thorium

import android.view.InputDevice
import android.view.MotionEvent

data class GamepadAxes(val horizontal: Float, val vertical: Float)

object GamepadMotionPolicy {
    fun recognizes(source: Int, action: Int): Boolean =
        action == MotionEvent.ACTION_MOVE &&
            (source and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK ||
                source and InputDevice.SOURCE_GAMEPAD == InputDevice.SOURCE_GAMEPAD ||
                source and InputDevice.SOURCE_DPAD == InputDevice.SOURCE_DPAD)

    fun axes(x: Float, y: Float, hatX: Float, hatY: Float): GamepadAxes {
        val horizontalHat = normalized(hatX)
        val verticalHat = normalized(hatY)
        return if (horizontalHat != 0f || verticalHat != 0f) {
            GamepadAxes(horizontalHat, verticalHat)
        } else {
            GamepadAxes(normalized(x), normalized(y))
        }
    }

    private fun normalized(value: Float): Float =
        if (value.isFinite()) value.coerceIn(-1f, 1f) else 0f
}

object AndroidGamepadMotion {
    fun read(event: MotionEvent): GamepadAxes? {
        if (!GamepadMotionPolicy.recognizes(event.source, event.action)) return null
        return GamepadMotionPolicy.axes(
            centered(event, MotionEvent.AXIS_X),
            centered(event, MotionEvent.AXIS_Y),
            centered(event, MotionEvent.AXIS_HAT_X),
            centered(event, MotionEvent.AXIS_HAT_Y),
        )
    }

    private fun centered(event: MotionEvent, axis: Int): Float {
        val value = event.getAxisValue(axis)
        val flat = event.device?.getMotionRange(axis, event.source)?.flat ?: 0f
        return if (kotlin.math.abs(value) > flat) value else 0f
    }
}
