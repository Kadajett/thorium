package dev.yougotserved.thorium

import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.MutableState
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

internal val CATALOG_GRID_SPACING = 12.dp
private val MINIMUM_CARD_WIDTH = 248.dp
private const val SEARCH_WIDTH_FRACTION = 0.30f

data class CatalogScreenContent(
    val items: List<CatalogItem>,
    val loading: Boolean,
    val error: String?,
    val network: NetworkStatus = NetworkStatus.CHECKING,
)

internal data class CatalogScreenLayout(val grid: CatalogGridLayout, val searchWidth: Dp)

internal data class CatalogScreenFocus(val toolbar: CatalogToolbarFocus, val cards: List<FocusRequester>)

internal data class CatalogInputBinding(
    val library: MutableState<CatalogLibraryState>,
    val focus: CatalogScreenFocus,
    val grid: LazyGridState,
)

internal data class CatalogGridBinding(
    val columnCount: Int,
    val grid: LazyGridState,
    val requesters: List<FocusRequester>,
)

internal fun catalogScreenLayout(width: Dp, itemCount: Int): CatalogScreenLayout {
    val availableWidth = width - 28.dp
    val columnCount = ((availableWidth.value + CATALOG_GRID_SPACING.value) /
        (MINIMUM_CARD_WIDTH.value + CATALOG_GRID_SPACING.value)).toInt().coerceAtLeast(1)
    return CatalogScreenLayout(
        CatalogGridLayout(itemCount, columnCount), (width * SEARCH_WIDTH_FRACTION).coerceIn(168.dp, 250.dp),
    )
}

internal fun catalogItemKey(item: CatalogItem): String = "${item.game.packageId}:${item.game.contentDigest}"

internal fun catalogQueryMatches(item: CatalogItem, query: String): Boolean =
    query.isBlank() || item.game.title.contains(query, ignoreCase = true) ||
        item.game.tagline.contains(query, ignoreCase = true)
