package dev.yougotserved.thorium

import org.json.JSONArray
import org.json.JSONObject

/** Portable release-authored inputs; Android key/axis numbers never enter a Game Package. */
data class ControllerBinding(
    val kind: String,
    val input: String,
    val control: String,
    val direction: Int? = null,
)

data class ControllerBindings(val schema: Int = 1, val bindings: List<ControllerBinding>) {
    fun validate(controls: List<ReleaseControl>) {
        require(schema == 1 && bindings.size in 1..64) { "Invalid controller binding schema/count" }
        val sources = mutableSetOf<String>()
        bindings.forEach { binding ->
            val expectedKind = when (binding.kind) {
                "button" -> {
                    require(binding.input in BUTTONS && binding.direction == null)
                    "button"
                }
                "axis" -> {
                    require(binding.input in AXES && binding.direction == null)
                    "axis"
                }
                "axis-button" -> {
                    require(binding.input in AXES && binding.direction in setOf(-1, 1))
                    "button"
                }
                else -> error("Unknown controller binding kind")
            }
            require(controls.any { it.id == binding.control && it.kind == expectedKind }) {
                "Controller binding references an unknown control or wrong kind"
            }
            require(sources.add("${binding.kind}/${binding.input}/${binding.direction}")) {
                "Duplicate physical controller source"
            }
        }
        val analog = bindings.filter { it.kind == "axis" }.map { it.input }.toSet()
        require(bindings.none { it.kind == "axis-button" && it.input in analog }) {
            "An axis cannot be both analog and digital"
        }
    }

    fun toJson(): JSONObject = JSONObject().put("schema", schema).put(
        "bindings",
        JSONArray(bindings.map { binding ->
            JSONObject().put("kind", binding.kind).put("input", binding.input)
                .put("control", binding.control).also { value ->
                    binding.direction?.let { value.put("direction", it) }
                }
        }),
    )

    companion object {
        val BUTTONS = setOf(
            "south", "east", "west", "north", "dpad-up", "dpad-down", "dpad-left", "dpad-right",
            "left-shoulder", "right-shoulder", "left-stick", "right-stick", "start", "select",
        )
        val AXES = setOf("left-x", "left-y", "right-x", "right-y", "left-trigger", "right-trigger")

        fun parse(value: Any?, controls: List<ReleaseControl>): ControllerBindings = try {
            require(value is JSONObject && value.keys().asSequence().toSet() == setOf("schema", "bindings"))
            require(value.opt("schema") is Int)
            val entries = value.optJSONArray("bindings") ?: error("Missing controller bindings")
            require(entries.length() in 1..64)
            ControllerBindings(value.getInt("schema"), (0 until entries.length()).map { index ->
                val entry = entries.optJSONObject(index) ?: error("Invalid controller binding")
                val kind = entry.opt("kind") as? String ?: error("Missing binding kind")
                val fields = setOf("kind", "input", "control") +
                    if (kind == "axis-button") setOf("direction") else emptySet()
                require(entry.keys().asSequence().toSet() == fields)
                ControllerBinding(
                    kind, entry.opt("input") as? String ?: error("Missing input"),
                    entry.opt("control") as? String ?: error("Missing control"),
                    if (kind == "axis-button") entry.opt("direction") as? Int
                        ?: error("Invalid direction") else null,
                )
            }).also { it.validate(controls) }
        } catch (_: RuntimeException) {
            throw CatalogParseException("controllerBindings is invalid")
        }
    }
}
