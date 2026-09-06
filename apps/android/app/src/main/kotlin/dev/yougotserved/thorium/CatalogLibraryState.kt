package dev.yougotserved.thorium

data class CatalogLibraryState(
    val query: String = "",
    val focus: CatalogFocus = CatalogFocus(),
    val searchEditing: Boolean = false,
)

data class CatalogGridLayout(val itemCount: Int, val columnCount: Int) {
    init {
        require(itemCount >= 0)
        require(columnCount > 0)
    }
}

sealed interface CatalogLibraryEffect {
    data object None : CatalogLibraryEffect
    data object NavigateBack : CatalogLibraryEffect
    data class OpenCard(val index: Int) : CatalogLibraryEffect
    data class Search(val query: String) : CatalogLibraryEffect
}

data class CatalogLibraryTransition(
    val state: CatalogLibraryState,
    val effect: CatalogLibraryEffect = CatalogLibraryEffect.None,
)

fun reduceCatalogCommand(
    state: CatalogLibraryState,
    command: CatalogControllerCommand,
    layout: CatalogGridLayout,
): CatalogLibraryTransition = when (command) {
    CatalogControllerCommand.ACTIVATE -> activateCatalogSelection(state, layout.itemCount)
    CatalogControllerCommand.SEARCH -> CatalogLibraryTransition(beginCatalogSearch(state))
    CatalogControllerCommand.REFRESH -> searchCatalog(state)
    CatalogControllerCommand.BACK_OR_CLEAR -> backFromCatalog(state)
    CatalogControllerCommand.MOVE_UP,
    CatalogControllerCommand.MOVE_DOWN,
    CatalogControllerCommand.MOVE_LEFT,
    CatalogControllerCommand.MOVE_RIGHT,
    -> moveCatalogSelection(state, command, layout)
}

fun beginCatalogSearch(state: CatalogLibraryState): CatalogLibraryState = state.copy(
    focus = state.focus.copy(target = CatalogFocusTarget.SEARCH),
    searchEditing = true,
)

private fun moveCatalogSelection(
    state: CatalogLibraryState,
    command: CatalogControllerCommand,
    layout: CatalogGridLayout,
): CatalogLibraryTransition {
    if (state.searchEditing) return CatalogLibraryTransition(state)
    val focus = CatalogFocusPolicy.move(state.focus, command, layout.itemCount, layout.columnCount)
    return CatalogLibraryTransition(state.copy(focus = focus))
}

private fun activateCatalogSelection(
    state: CatalogLibraryState,
    itemCount: Int,
): CatalogLibraryTransition = when (CatalogFocusPolicy.activation(state.focus, itemCount)) {
    CatalogActivation.ACTIVATE_CARD -> CatalogLibraryTransition(
        state, CatalogLibraryEffect.OpenCard(state.focus.cardIndex),
    )
    CatalogActivation.FOCUS_SEARCH -> CatalogLibraryTransition(state.copy(searchEditing = true))
    CatalogActivation.REFRESH -> searchCatalog(state)
    null -> CatalogLibraryTransition(state)
}

private fun searchCatalog(state: CatalogLibraryState): CatalogLibraryTransition =
    CatalogLibraryTransition(state, CatalogLibraryEffect.Search(state.query))

private fun backFromCatalog(state: CatalogLibraryState): CatalogLibraryTransition =
    when (CatalogFocusPolicy.backDecision(state.query, state.searchEditing)) {
        CatalogBackDecision.CLEAR_SEARCH -> CatalogLibraryTransition(
            state.copy(query = "", searchEditing = false), CatalogLibraryEffect.Search(""),
        )
        CatalogBackDecision.NAVIGATE_BACK -> CatalogLibraryTransition(
            state, CatalogLibraryEffect.NavigateBack,
        )
    }
