package dev.yougotserved.thorium

import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.unit.Dp

internal data class CatalogToolbarLayout(
    val searchWidth: Dp,
    val loading: Boolean,
    val network: NetworkStatus = NetworkStatus.CHECKING,
)

internal data class CatalogToolbarFocus(
    val searchTile: FocusRequester,
    val searchEditor: FocusRequester,
    val refresh: FocusRequester,
)

internal data class CatalogUtilityView(val label: String, val selected: Boolean, val enabled: Boolean)

internal data class CatalogUtilityInteraction(
    val focusRequester: FocusRequester,
    val onFocused: (Boolean) -> Unit,
    val onClick: () -> Unit,
)
