package dev.yougotserved.thorium

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.Flow

@Composable
fun CatalogScreen(
    content: CatalogScreenContent,
    actions: CatalogLibraryActions,
    controllerCommands: Flow<CatalogControllerCommand>,
) {
    val library = remember { mutableStateOf(CatalogLibraryState()) }
    val matches = content.items.filter { catalogQueryMatches(it, library.value.query) }
    val focus = rememberCatalogFocus(matches)
    val grid = rememberLazyGridState()
    BoxWithConstraints(modifier = catalogBackground()) {
        val layout = catalogScreenLayout(maxWidth, matches.size)
        val send = rememberCatalogDispatch(library, matches, actions, layout.grid)
        CatalogInputEffects(CatalogInputBinding(library, focus, grid), layout.grid, controllerCommands, send)
        Column(modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp, vertical = 10.dp)) {
            CatalogTopBar(
                library.value, CatalogToolbarLayout(layout.searchWidth, content.loading, content.network),
                focus.toolbar, send,
            )
            CatalogStatus(content.error)
            Spacer(Modifier.height(10.dp))
            CatalogGrid(
                content.copy(items = matches), library.value,
                CatalogGridBinding(layout.grid.columnCount, grid, focus.cards), send,
            )
        }
    }
}

private fun catalogBackground(): Modifier = Modifier.fillMaxSize().background(
    Brush.verticalGradient(listOf(Color(CatalogPalette.BACKGROUND_TOP), Color(CatalogPalette.BACKGROUND_BOTTOM))),
)

@Composable
private fun CatalogStatus(error: String?) {
    error?.let { message ->
        Spacer(Modifier.height(6.dp))
        Text(
            text = message, color = Color(CatalogPalette.ERROR), style = MaterialTheme.typography.bodySmall,
            maxLines = 2, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}
