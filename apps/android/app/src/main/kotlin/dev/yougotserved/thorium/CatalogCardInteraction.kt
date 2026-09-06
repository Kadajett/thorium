package dev.yougotserved.thorium

import androidx.compose.ui.focus.FocusRequester

internal data class CatalogCardInteraction(
    val selected: Boolean,
    val focusRequester: FocusRequester,
    val onFocused: () -> Unit,
    val onAction: () -> Unit,
)
