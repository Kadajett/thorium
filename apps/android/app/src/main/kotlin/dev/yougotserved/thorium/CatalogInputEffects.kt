package dev.yougotserved.thorium

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.platform.LocalInputModeManager
import kotlinx.coroutines.flow.Flow

@Composable
internal fun CatalogInputEffects(
    binding: CatalogInputBinding,
    layout: CatalogGridLayout,
    commands: Flow<CatalogControllerCommand>,
    send: (CatalogLibraryEvent) -> Unit,
) {
    val state = binding.library.value
    val inputMode = LocalInputModeManager.current
    LaunchedEffect(layout.itemCount) {
        val current = binding.library.value
        binding.library.value = current.copy(focus = CatalogFocusPolicy.normalized(current.focus, layout.itemCount))
    }
    LaunchedEffect(state.searchEditing) {
        if (state.searchEditing) binding.focus.toolbar.searchEditor.requestFocus()
    }
    LaunchedEffect(state.focus, binding.focus.cards, state.searchEditing) {
        if (!state.searchEditing) requestCatalogFocus(binding, state.focus)
    }
    LaunchedEffect(commands, inputMode, send) {
        commands.collect { command ->
            inputMode.requestInputMode(InputMode.Keyboard)
            send(CatalogLibraryEvent.Controller(command))
        }
    }
}

private suspend fun requestCatalogFocus(binding: CatalogInputBinding, focus: CatalogFocus) {
    when (focus.target) {
        CatalogFocusTarget.CARD -> requestCatalogCardFocus(binding, focus.cardIndex)
        CatalogFocusTarget.SEARCH -> binding.focus.toolbar.searchTile.requestFocus()
        CatalogFocusTarget.REFRESH -> binding.focus.toolbar.refresh.requestFocus()
    }
}

private suspend fun requestCatalogCardFocus(binding: CatalogInputBinding, index: Int) {
    val requester = binding.focus.cards.getOrNull(index) ?: return
    if (binding.grid.layoutInfo.visibleItemsInfo.none { it.index == index }) binding.grid.scrollToItem(index)
    // Lazy items must be composed before Android can focus their card.
    withFrameNanos { }
    requester.requestFocus()
}
