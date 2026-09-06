package dev.yougotserved.thorium

import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color

@Composable
internal fun CatalogGrid(
    content: CatalogScreenContent,
    state: CatalogLibraryState,
    binding: CatalogGridBinding,
    send: (CatalogLibraryEvent) -> Unit,
) {
    if (!content.loading && content.items.isEmpty()) {
        CatalogEmptyState(state.query)
    } else {
        LazyVerticalGrid(
            columns = GridCells.Fixed(binding.columnCount), state = binding.grid,
            modifier = Modifier.fillMaxSize().focusGroup(),
            horizontalArrangement = Arrangement.spacedBy(CATALOG_GRID_SPACING),
            verticalArrangement = Arrangement.spacedBy(CATALOG_GRID_SPACING), userScrollEnabled = true,
        ) {
            itemsIndexed(items = content.items, key = { _, item -> catalogItemKey(item) }) { index, item ->
                GameCoverCard(item, catalogCardInteraction(state.focus, binding, index, send))
            }
        }
    }
}

private fun catalogCardInteraction(
    focus: CatalogFocus,
    binding: CatalogGridBinding,
    index: Int,
    send: (CatalogLibraryEvent) -> Unit,
): CatalogCardInteraction = CatalogCardInteraction(
    selected = focus.target == CatalogFocusTarget.CARD && focus.cardIndex == index,
    focusRequester = binding.requesters[index],
    onFocused = { send(CatalogLibraryEvent.Focused(CatalogFocus(CatalogFocusTarget.CARD, index))) },
    onAction = { send(CatalogLibraryEvent.OpenCard(index)) },
)

@Composable
private fun CatalogEmptyState(query: String) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(
            text = if (query.isBlank()) "No games are available right now." else "No games match your search.",
            color = Color(CatalogPalette.MUTED),
        )
    }
}
