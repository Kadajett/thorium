package dev.yougotserved.thorium

import android.view.KeyEvent
import android.view.MotionEvent

object AndroidGameControllerInput {
    fun motion(deviceId: Int, source: Int, action: Int, axes: Map<Int, Double>, flats: Map<Int, Double> = emptyMap()): ControllerDeviceInput? {
        if (!GamepadMotionPolicy.recognizes(source, action)) return null
        fun axis(primary: Int, fallback: Int = primary): Double {
            val selected = if (primary in axes) primary else fallback
            val value = axes[selected] ?: 0.0
            val flat = flats[selected]?.takeIf { it.isFinite() } ?: 0.0
            return if (!value.isFinite() || kotlin.math.abs(value) <= maxOf(0.15, flat)) 0.0 else value
        }
        val hatX = axis(MotionEvent.AXIS_HAT_X)
        val hatY = axis(MotionEvent.AXIS_HAT_Y)
        return ControllerDeviceInput(
            deviceId,
            buttons = mapOf(
                "dpad-left" to (hatX <= -0.5), "dpad-right" to (hatX >= 0.5),
                "dpad-up" to (hatY <= -0.5), "dpad-down" to (hatY >= 0.5),
            ),
            axes = mapOf(
                "left-x" to axis(MotionEvent.AXIS_X), "left-y" to axis(MotionEvent.AXIS_Y),
                "right-x" to axis(MotionEvent.AXIS_Z, MotionEvent.AXIS_RX),
                "right-y" to axis(MotionEvent.AXIS_RZ, MotionEvent.AXIS_RY),
                "left-trigger" to axis(MotionEvent.AXIS_LTRIGGER, MotionEvent.AXIS_BRAKE),
                "right-trigger" to axis(MotionEvent.AXIS_RTRIGGER, MotionEvent.AXIS_GAS),
            ),
            buttonSource = "hat",
        )
    }

    fun motion(event: MotionEvent): ControllerDeviceInput? = motion(
        event.deviceId, event.source, event.actionMasked,
        motionAxes.mapNotNull { axis ->
            event.device?.getMotionRange(axis, event.source)?.let { axis to event.getAxisValue(axis).toDouble() }
        }.toMap(),
        motionAxes.mapNotNull { axis ->
            event.device?.getMotionRange(axis, event.source)?.let { axis to it.flat.toDouble() }
        }.toMap(),
    )

    private val motionAxes = listOf(
        MotionEvent.AXIS_X, MotionEvent.AXIS_Y, MotionEvent.AXIS_Z, MotionEvent.AXIS_RZ,
        MotionEvent.AXIS_RX, MotionEvent.AXIS_RY, MotionEvent.AXIS_HAT_X, MotionEvent.AXIS_HAT_Y,
        MotionEvent.AXIS_LTRIGGER, MotionEvent.AXIS_RTRIGGER, MotionEvent.AXIS_BRAKE, MotionEvent.AXIS_GAS,
    )
    private val buttons = mapOf(
        KeyEvent.KEYCODE_BUTTON_A to "south", KeyEvent.KEYCODE_BUTTON_B to "east",
        KeyEvent.KEYCODE_BUTTON_X to "west", KeyEvent.KEYCODE_BUTTON_Y to "north",
        KeyEvent.KEYCODE_DPAD_UP to "dpad-up", KeyEvent.KEYCODE_DPAD_DOWN to "dpad-down",
        KeyEvent.KEYCODE_DPAD_LEFT to "dpad-left", KeyEvent.KEYCODE_DPAD_RIGHT to "dpad-right",
        KeyEvent.KEYCODE_BUTTON_L1 to "left-shoulder", KeyEvent.KEYCODE_BUTTON_R1 to "right-shoulder",
        KeyEvent.KEYCODE_BUTTON_THUMBL to "left-stick", KeyEvent.KEYCODE_BUTTON_THUMBR to "right-stick",
        KeyEvent.KEYCODE_BUTTON_START to "start", KeyEvent.KEYCODE_BUTTON_SELECT to "select",
    )

    fun key(deviceId: Int, keyCode: Int, action: Int): ControllerDeviceInput? {
        if (action != KeyEvent.ACTION_DOWN && action != KeyEvent.ACTION_UP) return null
        val button = buttons[keyCode] ?: return null
        return ControllerDeviceInput(deviceId, buttons = mapOf(button to (action == KeyEvent.ACTION_DOWN)))
    }
}
