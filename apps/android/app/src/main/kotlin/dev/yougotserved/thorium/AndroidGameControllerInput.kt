package dev.yougotserved.thorium

import android.view.KeyEvent
import android.view.MotionEvent

data class ControllerMotionAxes(
    val values: Map<Int, Double>,
    val flats: Map<Int, Double> = emptyMap(),
)

object AndroidGameControllerInput {
    private const val HAT_THRESHOLD = 0.5

    fun motion(deviceId: Int, source: Int, action: Int, readings: ControllerMotionAxes): ControllerDeviceInput? {
        if (!GamepadMotionPolicy.recognizes(source, action)) return null
        fun sample(primary: Int, fallback: Int = primary): ControllerAxisSample {
            val selected = if (primary in readings.values) primary else fallback
            return ControllerAxisPolicy.sample(readings.values[selected] ?: 0.0, readings.flats[selected] ?: 0.0)
        }
        fun axis(primary: Int, fallback: Int = primary): Double =
            ControllerAxisPolicy.scalar(sample(primary, fallback))
        val left = ControllerAxisPolicy.stick(sample(MotionEvent.AXIS_X), sample(MotionEvent.AXIS_Y))
        val right = ControllerAxisPolicy.stick(
            sample(MotionEvent.AXIS_Z, MotionEvent.AXIS_RX), sample(MotionEvent.AXIS_RZ, MotionEvent.AXIS_RY),
        )
        val hatX = axis(MotionEvent.AXIS_HAT_X)
        val hatY = axis(MotionEvent.AXIS_HAT_Y)
        return ControllerDeviceInput(
            deviceId,
            buttons = mapOf(
                "dpad-left" to (hatX <= -HAT_THRESHOLD), "dpad-right" to (hatX >= HAT_THRESHOLD),
                "dpad-up" to (hatY <= -HAT_THRESHOLD), "dpad-down" to (hatY >= HAT_THRESHOLD),
            ),
            axes = mapOf(
                "left-x" to left.x, "left-y" to left.y,
                "right-x" to right.x, "right-y" to right.y,
                "left-trigger" to axis(MotionEvent.AXIS_LTRIGGER, MotionEvent.AXIS_BRAKE),
                "right-trigger" to axis(MotionEvent.AXIS_RTRIGGER, MotionEvent.AXIS_GAS),
            ),
            buttonSource = "hat",
        )
    }

    fun motion(event: MotionEvent): ControllerDeviceInput? = motion(
        event.deviceId, event.source, event.actionMasked,
        ControllerMotionAxes(
            motionAxes.mapNotNull { axis ->
                event.device?.getMotionRange(axis, event.source)?.let { axis to event.getAxisValue(axis).toDouble() }
            }.toMap(),
            motionAxes.mapNotNull { axis ->
                event.device?.getMotionRange(axis, event.source)?.let { axis to it.flat.toDouble() }
            }.toMap(),
        ),
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
        return buttons[keyCode]?.let { button ->
            ControllerDeviceInput(deviceId, buttons = mapOf(button to (action == KeyEvent.ACTION_DOWN)))
        }
    }
}
