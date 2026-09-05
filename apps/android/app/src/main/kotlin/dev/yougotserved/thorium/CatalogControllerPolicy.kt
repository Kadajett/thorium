package dev.yougotserved.thorium

enum class CatalogControllerKey {
    DPAD_UP,
    DPAD_DOWN,
    DPAD_LEFT,
    DPAD_RIGHT,
    BUTTON_A,
    BUTTON_X,
    BUTTON_Y,
    BUTTON_B,
}

data class CatalogControllerInput(
    val key: CatalogControllerKey,
    val phase: ControllerKeyPhase,
    val repeatCount: Int,
) {
    init {
        require(repeatCount >= 0)
    }
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

enum class CatalogBackDecision {
    CLEAR_SEARCH,
    NAVIGATE_BACK,
}

object CatalogControllerPolicy {
    fun command(input: CatalogControllerInput): CatalogControllerCommand? {
        if (input.phase != ControllerKeyPhase.DOWN) return null
        val command = when (input.key) {
            CatalogControllerKey.DPAD_UP -> CatalogControllerCommand.MOVE_UP
            CatalogControllerKey.DPAD_DOWN -> CatalogControllerCommand.MOVE_DOWN
            CatalogControllerKey.DPAD_LEFT -> CatalogControllerCommand.MOVE_LEFT
            CatalogControllerKey.DPAD_RIGHT -> CatalogControllerCommand.MOVE_RIGHT
            CatalogControllerKey.BUTTON_A -> CatalogControllerCommand.ACTIVATE
            CatalogControllerKey.BUTTON_X -> CatalogControllerCommand.SEARCH
            CatalogControllerKey.BUTTON_Y -> CatalogControllerCommand.REFRESH
            CatalogControllerKey.BUTTON_B -> CatalogControllerCommand.BACK_OR_CLEAR
        }
        return command.takeIf { input.repeatCount == 0 || it.isMovement() }
    }

    fun moveSelection(
        selected: Int,
        itemCount: Int,
        columnCount: Int,
        command: CatalogControllerCommand,
    ): Int {
        if (itemCount <= 0) return 0
        require(columnCount > 0)
        val current = selected.coerceIn(0, itemCount - 1)
        return when (command) {
            CatalogControllerCommand.MOVE_UP -> (current - columnCount).coerceAtLeast(0)
            CatalogControllerCommand.MOVE_DOWN ->
                (current + columnCount).coerceAtMost(itemCount - 1)
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
    }

    fun backDecision(query: String, searchFocused: Boolean): CatalogBackDecision =
        if (query.isNotEmpty() || searchFocused) {
            CatalogBackDecision.CLEAR_SEARCH
        } else {
            CatalogBackDecision.NAVIGATE_BACK
        }

    fun isCardFocused(selected: Int, index: Int, searchFocused: Boolean): Boolean =
        !searchFocused && index == selected

    private fun CatalogControllerCommand.isMovement(): Boolean = this in setOf(
        CatalogControllerCommand.MOVE_UP,
        CatalogControllerCommand.MOVE_DOWN,
        CatalogControllerCommand.MOVE_LEFT,
        CatalogControllerCommand.MOVE_RIGHT,
    )
}
