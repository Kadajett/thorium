package dev.yougotserved.thorium

import android.view.KeyEvent

data class SouthButtonBinding(
    val playerSlot: Int,
    val controlId: String,
) {
    init {
        require(playerSlot in 0..15) { "Invalid PlayerSlot" }
        require(GameLaunchPolicy.isValidControlId(controlId)) { "Invalid semantic control" }
    }
}

enum class ControllerKeyPhase {
    DOWN,
    UP,
}

data class ControllerKeyInput(
    val phase: ControllerKeyPhase,
    val repeatCount: Int,
)

data class SemanticControlInput(
    val controlId: String,
    val playerSlot: Int,
    val phase: String,
    val value: Int,
    val sequence: Long,
)

data class ControllerInputDecision(
    val handled: Boolean,
    val control: SemanticControlInput? = null,
)

class ControllerInputPolicy(private val southButton: SouthButtonBinding?) {
    private var southPressed = false
    private var nextSequence = 0L

    fun acceptSouth(input: ControllerKeyInput): ControllerInputDecision {
        val binding = southButton ?: return ControllerInputDecision(handled = false)
        return when (input.phase) {
            ControllerKeyPhase.DOWN -> {
                if (input.repeatCount > 0 || southPressed) {
                    ControllerInputDecision(handled = true)
                } else {
                    southPressed = true
                    ControllerInputDecision(
                        handled = true,
                        control = SemanticControlInput(
                            controlId = binding.controlId,
                            playerSlot = binding.playerSlot,
                            phase = "pressed",
                            value = 1,
                            sequence = nextSequence++,
                        ),
                    )
                }
            }
            ControllerKeyPhase.UP -> {
                if (!southPressed) {
                    ControllerInputDecision(handled = true)
                } else {
                    southPressed = false
                    ControllerInputDecision(
                        handled = true,
                        control = SemanticControlInput(
                            controlId = binding.controlId,
                            playerSlot = binding.playerSlot,
                            phase = "released",
                            value = 0,
                            sequence = nextSequence++,
                        ),
                    )
                }
            }
        }
    }
}

object AndroidControllerInput {
    fun translate(keyCode: Int, action: Int, repeatCount: Int): ControllerKeyInput? {
        if (keyCode != KeyEvent.KEYCODE_BUTTON_A) return null
        val phase = when (action) {
            KeyEvent.ACTION_DOWN -> ControllerKeyPhase.DOWN
            KeyEvent.ACTION_UP -> ControllerKeyPhase.UP
            else -> return null
        }
        return ControllerKeyInput(phase = phase, repeatCount = repeatCount.coerceAtLeast(0))
    }
}
