package dev.yougotserved.thorium

sealed interface CatalogLibraryEvent {
    data class Controller(val command: CatalogControllerCommand) : CatalogLibraryEvent
    data class Focused(val focus: CatalogFocus) : CatalogLibraryEvent
    data class UtilityFocused(val target: CatalogFocusTarget) : CatalogLibraryEvent
    data class QueryChanged(val query: String) : CatalogLibraryEvent
    data class OpenCard(val index: Int) : CatalogLibraryEvent
    data object BeginSearch : CatalogLibraryEvent
    data object SubmitSearch : CatalogLibraryEvent
}

fun reduceCatalogEvent(
    state: CatalogLibraryState,
    event: CatalogLibraryEvent,
    layout: CatalogGridLayout,
): CatalogLibraryTransition = when (event) {
    is CatalogLibraryEvent.Controller -> reduceCatalogCommand(state, event.command, layout)
    is CatalogLibraryEvent.Focused -> CatalogLibraryTransition(state.copy(focus = event.focus))
    is CatalogLibraryEvent.UtilityFocused -> CatalogLibraryTransition(
        state.copy(focus = state.focus.copy(target = event.target)),
    )
    is CatalogLibraryEvent.QueryChanged -> CatalogLibraryTransition(state.copy(query = event.query))
    is CatalogLibraryEvent.OpenCard -> openCatalogCard(state, event.index, layout.itemCount)
    CatalogLibraryEvent.BeginSearch -> CatalogLibraryTransition(beginCatalogSearch(state))
    CatalogLibraryEvent.SubmitSearch -> CatalogLibraryTransition(
        state.copy(searchEditing = false), CatalogLibraryEffect.Search(state.query),
    )
}

private fun openCatalogCard(
    state: CatalogLibraryState,
    index: Int,
    itemCount: Int,
): CatalogLibraryTransition {
    if (index !in 0 until itemCount) return CatalogLibraryTransition(state)
    return CatalogLibraryTransition(
        state.copy(focus = CatalogFocus(CatalogFocusTarget.CARD, index)), CatalogLibraryEffect.OpenCard(index),
    )
}
