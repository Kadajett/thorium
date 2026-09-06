package dev.yougotserved.thorium

import kotlin.math.abs
import kotlin.math.hypot

data class ControllerAxisSample(val value: Double, val flat: Double)
data class ControllerStickSample(val x: Double, val y: Double)

/** Hardware noise filtering must not flatten an active stick's shallow diagonal. */
object ControllerAxisPolicy {
    private const val MIN_DEADZONE = 0.15

    fun sample(value: Double, flat: Double): ControllerAxisSample = ControllerAxisSample(
        value.takeIf { it.isFinite() }?.coerceIn(-1.0, 1.0) ?: 0.0,
        maxOf(MIN_DEADZONE, flat.takeIf { it.isFinite() }?.coerceIn(0.0, 1.0) ?: 0.0),
    )

    fun scalar(sample: ControllerAxisSample): Double =
        if (abs(sample.value) <= sample.flat) 0.0 else sample.value

    fun stick(x: ControllerAxisSample, y: ControllerAxisSample): ControllerStickSample =
        if (hypot(x.value, y.value) <= maxOf(x.flat, y.flat)) {
            ControllerStickSample(0.0, 0.0)
        } else {
            ControllerStickSample(x.value, y.value)
        }
}
