package dev.yougotserved.thorium

object AndroidCatalogKeyCode {
    const val DPAD_UP = 19
    const val DPAD_DOWN = 20
    const val DPAD_LEFT = 21
    const val DPAD_RIGHT = 22
    const val BUTTON_A = 96
    const val BUTTON_B = 97
    const val BUTTON_X = 99
    const val BUTTON_Y = 100
}

object AndroidCatalogKeyAction {
    const val DOWN = 0
    const val UP = 1
}

enum class CatalogControllerCommand {
    MOVE_UP,
    MOVE_DOWN,
    MOVE_LEFT,
    MOVE_RIGHT,
    ACTIVATE,
    SEARCH,
    REFRESH,
    BACK_OR_CLEAR,
}

object CatalogAndroidKeyPolicy {
    fun recognizes(keyCode: Int): Boolean = keyCode in KEY_COMMANDS

    fun command(keyCode: Int, action: Int, repeatCount: Int): CatalogControllerCommand? {
        if (action != AndroidCatalogKeyAction.DOWN || repeatCount < 0) return null
        val command = KEY_COMMANDS[keyCode] ?: return null
        return command.takeIf { repeatCount == 0 || it.isMovement() }
    }

    private fun CatalogControllerCommand.isMovement(): Boolean = when (this) {
        CatalogControllerCommand.MOVE_UP,
        CatalogControllerCommand.MOVE_DOWN,
        CatalogControllerCommand.MOVE_LEFT,
        CatalogControllerCommand.MOVE_RIGHT,
        -> true
        else -> false
    }

    private val KEY_COMMANDS = mapOf(
        AndroidCatalogKeyCode.DPAD_UP to CatalogControllerCommand.MOVE_UP,
        AndroidCatalogKeyCode.DPAD_DOWN to CatalogControllerCommand.MOVE_DOWN,
        AndroidCatalogKeyCode.DPAD_LEFT to CatalogControllerCommand.MOVE_LEFT,
        AndroidCatalogKeyCode.DPAD_RIGHT to CatalogControllerCommand.MOVE_RIGHT,
        AndroidCatalogKeyCode.BUTTON_A to CatalogControllerCommand.ACTIVATE,
        AndroidCatalogKeyCode.BUTTON_X to CatalogControllerCommand.SEARCH,
        AndroidCatalogKeyCode.BUTTON_Y to CatalogControllerCommand.REFRESH,
        AndroidCatalogKeyCode.BUTTON_B to CatalogControllerCommand.BACK_OR_CLEAR,
    )
}

enum class CatalogFocusTarget {
    CARD,
    SEARCH,
    REFRESH,
}

data class CatalogFocus(
    val target: CatalogFocusTarget = CatalogFocusTarget.CARD,
    val cardIndex: Int = 0,
) {
    init {
        require(cardIndex >= 0)
    }
}

enum class CatalogActivation {
    ACTIVATE_CARD,
    FOCUS_SEARCH,
    REFRESH,
}

enum class CatalogBackDecision {
    CLEAR_SEARCH,
    NAVIGATE_BACK,
}

object CatalogFocusPolicy {
    fun move(
        focus: CatalogFocus,
        command: CatalogControllerCommand,
        itemCount: Int,
        columnCount: Int,
    ): CatalogFocus {
        require(itemCount >= 0)
        require(columnCount > 0)
        val current = focus.copy(
            cardIndex = if (itemCount == 0) 0 else focus.cardIndex.coerceAtMost(itemCount - 1),
        )
        return when (current.target) {
            CatalogFocusTarget.CARD -> moveFromCard(current, command, itemCount, columnCount)
            CatalogFocusTarget.SEARCH -> when (command) {
                CatalogControllerCommand.MOVE_RIGHT -> current.copy(
                    target = CatalogFocusTarget.REFRESH,
                )
                CatalogControllerCommand.MOVE_DOWN -> current.toCardIfPresent(itemCount)
                else -> current
            }
            CatalogFocusTarget.REFRESH -> when (command) {
                CatalogControllerCommand.MOVE_LEFT -> current.copy(
                    target = CatalogFocusTarget.SEARCH,
                )
                CatalogControllerCommand.MOVE_DOWN -> current.toCardIfPresent(itemCount)
                else -> current
            }
        }
    }

    fun activation(focus: CatalogFocus, itemCount: Int): CatalogActivation? = when (focus.target) {
        CatalogFocusTarget.CARD -> if (focus.cardIndex in 0 until itemCount) {
            CatalogActivation.ACTIVATE_CARD
        } else {
            null
        }
        CatalogFocusTarget.SEARCH -> CatalogActivation.FOCUS_SEARCH
        CatalogFocusTarget.REFRESH -> CatalogActivation.REFRESH
    }

    fun backDecision(query: String, searchInputFocused: Boolean): CatalogBackDecision =
        if (query.isNotEmpty() || searchInputFocused) {
            CatalogBackDecision.CLEAR_SEARCH
        } else {
            CatalogBackDecision.NAVIGATE_BACK
        }

    fun normalized(focus: CatalogFocus, itemCount: Int): CatalogFocus {
        require(itemCount >= 0)
        return focus.copy(
            cardIndex = if (itemCount == 0) 0 else focus.cardIndex.coerceAtMost(itemCount - 1),
        )
    }

    private fun moveFromCard(
        focus: CatalogFocus,
        command: CatalogControllerCommand,
        itemCount: Int,
        columnCount: Int,
    ): CatalogFocus {
        if (itemCount == 0) {
            return if (command == CatalogControllerCommand.MOVE_UP) {
                focus.copy(target = CatalogFocusTarget.SEARCH)
            } else {
                focus
            }
        }
        val current = focus.cardIndex
        val next = when (command) {
            CatalogControllerCommand.MOVE_UP -> {
                if (current < columnCount) return focus.copy(target = CatalogFocusTarget.SEARCH)
                current - columnCount
            }
            CatalogControllerCommand.MOVE_DOWN ->
                (current + columnCount).takeIf { it < itemCount } ?: current
            CatalogControllerCommand.MOVE_LEFT ->
                if (current % columnCount == 0) current else current - 1
            CatalogControllerCommand.MOVE_RIGHT ->
                if (current % columnCount == columnCount - 1 || current == itemCount - 1) {
                    current
                } else {
                    current + 1
                }
            else -> current
        }
        return focus.copy(cardIndex = next)
    }

    private fun CatalogFocus.toCardIfPresent(itemCount: Int): CatalogFocus =
        if (itemCount == 0) this else copy(target = CatalogFocusTarget.CARD)
}
