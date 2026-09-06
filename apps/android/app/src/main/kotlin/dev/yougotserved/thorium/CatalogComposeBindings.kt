package dev.yougotserved.thorium

import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.focus.FocusRequester

@Composable
internal fun rememberCatalogFocus(items: List<CatalogItem>): CatalogScreenFocus {
    val toolbar = remember { CatalogToolbarFocus(FocusRequester(), FocusRequester(), FocusRequester()) }
    val keys = items.map(::catalogItemKey)
    val cards = remember(keys) { List(keys.size) { FocusRequester() } }
    return CatalogScreenFocus(toolbar, cards)
}

@Composable
internal fun rememberCatalogDispatch(
    library: MutableState<CatalogLibraryState>,
    items: List<CatalogItem>,
    actions: CatalogLibraryActions,
    layout: CatalogGridLayout,
): (CatalogLibraryEvent) -> Unit {
    val currentItems by rememberUpdatedState(items)
    val currentActions by rememberUpdatedState(actions)
    val currentLayout by rememberUpdatedState(layout)
    return remember(library) {
        { event ->
            val transition = reduceCatalogEvent(library.value, event, currentLayout)
            library.value = transition.state
            executeCatalogEffect(transition.effect, currentItems, currentActions)
        }
    }
}
