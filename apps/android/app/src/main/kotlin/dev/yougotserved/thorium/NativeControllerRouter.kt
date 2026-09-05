package dev.yougotserved.thorium

import kotlin.math.abs

data class ControllerDeviceInput(
    val deviceId: Int,
    val buttons: Map<String, Boolean> = emptyMap(),
    val axes: Map<String, Double> = emptyMap(),
    val buttonSource: String = "key",
)

class NativeControllerRouter(
    private val profile: ControllerBindings,
    private val localSlots: Set<Int>,
) {
    private data class Device(
        val buttons: MutableMap<Pair<String, String>, Boolean> = mutableMapOf(),
        val axes: MutableMap<String, Double> = mutableMapOf(),
        val digitalAxes: MutableMap<ControllerBinding, Boolean> = mutableMapOf(),
    )
    private val devices = mutableMapOf<Int, Device>()
    private val assignments = mutableMapOf<Int, Int>()
    private val values = mutableMapOf<Pair<Int, String>, Double>()
    private val sortedSlots = localSlots.sorted()
    private val bindingsByControl = profile.bindings.groupBy { it.control }
    private val digitalBindings = profile.bindings.filter { it.kind == "axis-button" }
    private var sequence = 0L

    init {
        require(localSlots.isNotEmpty() && localSlots.all { it in 0..15 })
    }

    fun assign(deviceId: Int, slot: Int): List<SemanticControlInput> {
        require(slot in localSlots) { "Controller must target a locally admitted PlayerSlot" }
        devices.remove(deviceId)
        assignments[deviceId] = slot
        return changes()
    }

    fun disconnect(deviceId: Int): List<SemanticControlInput> {
        devices.remove(deviceId)
        assignments.remove(deviceId)
        return changes()
    }

    /** Keep player assignments while releasing all physical state on genuine background. */
    fun releaseAll(): List<SemanticControlInput> {
        devices.clear()
        return changes()
    }
    fun needsAssignment(deviceId: Int): Boolean = localSlots.size > 1 && deviceId !in assignments

    fun accept(input: ControllerDeviceInput): List<SemanticControlInput> {
        if (assignments[input.deviceId] == null) {
            val onlySlot = localSlots.singleOrNull() ?: return emptyList()
            assignments[input.deviceId] = onlySlot
        }
        val device = devices.getOrPut(input.deviceId) { Device() }
        require(input.buttonSource == "key" || input.buttonSource == "hat")
        input.buttons.forEach { (button, held) ->
            if (button in ControllerBindings.BUTTONS) device.buttons[input.buttonSource to button] = held
        }
        input.axes.forEach { (axis, raw) ->
            if (axis in ControllerBindings.AXES) {
                val minimum = if (axis.endsWith("-trigger")) 0.0 else -1.0
                device.axes[axis] = if (!raw.isFinite() || abs(raw) <= 0.15) 0.0 else raw.coerceIn(minimum, 1.0)
            }
        }
        digitalBindings.forEach { binding ->
            val directed = (device.axes[binding.input] ?: 0.0) * binding.direction!!
            device.digitalAxes[binding] = if (device.digitalAxes[binding] == true) directed > 0.35 else directed >= 0.6
        }
        return changes()
    }

    private fun changes(): List<SemanticControlInput> = buildList {
        sortedSlots.forEach { slot ->
            bindingsByControl.forEach { (control, bindings) ->
                val analog = bindings.first().kind == "axis"
                // Largest magnitude wins for multiple analog sources; stable insertion order breaks ties.
                var value = 0.0
                for ((id, device) in devices) {
                    if (assignments[id] != slot) continue
                    for (binding in bindings) {
                        val contribution = if (analog) device.axes[binding.input] ?: 0.0
                        else if (binding.kind == "axis-button") {
                            if (device.digitalAxes[binding] == true) 1.0 else 0.0
                        } else if (
                            device.buttons["key" to binding.input] == true ||
                            device.buttons["hat" to binding.input] == true
                        ) 1.0 else 0.0
                        if (abs(contribution) > abs(value)) value = contribution
                    }
                }
                val key = slot to control
                if (value != (values[key] ?: 0.0)) {
                    values[key] = value
                    val phase = if (analog) "changed" else if (value > 0.0) "pressed" else "released"
                    add(SemanticControlInput(control, slot, phase, value, sequence++))
                }
            }
        }
    }
}
