package dev.yougotserved.thorium

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun CatalogTopBar(
    state: CatalogLibraryState,
    layout: CatalogToolbarLayout,
    focus: CatalogToolbarFocus,
    send: (CatalogLibraryEvent) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().focusGroup(),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) { CatalogLibraryHeading(layout.network) }
        Box(modifier = Modifier.width(layout.searchWidth)) { CatalogSearchTile(state, focus, send) }
        CatalogRefreshButton(state, layout.loading, focus.refresh, send)
    }
}

@Composable
private fun CatalogLibraryHeading(network: NetworkStatus) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = "THORIUM  /  GAME LIBRARY", color = Color(CatalogPalette.ACCENT),
            fontSize = 13.sp, fontWeight = FontWeight.Black, letterSpacing = 1.5.sp,
            modifier = Modifier.weight(1f).semantics { heading() },
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Text(text = network.label, color = Color(CatalogPalette.MUTED), style = MaterialTheme.typography.labelSmall)
    }
    Text(
        text = "D-pad / stick  Move     A  Open     X  Search     Y  Sync",
        color = Color(CatalogPalette.MUTED), style = MaterialTheme.typography.labelSmall,
        maxLines = 1, overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun CatalogSearchTile(
    state: CatalogLibraryState,
    focus: CatalogToolbarFocus,
    send: (CatalogLibraryEvent) -> Unit,
) {
    val selected = state.focus.target == CatalogFocusTarget.SEARCH
    Box(
        modifier = Modifier.clip(RoundedCornerShape(10.dp))
            .border(
                width = if (selected) 3.dp else 1.dp,
                color = Color(if (selected) CatalogPalette.ACCENT else CatalogPalette.BORDER),
                shape = RoundedCornerShape(10.dp),
            ).padding(1.dp),
    ) {
        if (state.searchEditing) CatalogSearchEditor(state, focus.searchEditor, send)
        else CatalogSearchButton(state, focus.searchTile, send)
    }
}

@Composable
private fun CatalogSearchEditor(
    state: CatalogLibraryState,
    requester: FocusRequester,
    send: (CatalogLibraryEvent) -> Unit,
) {
    OutlinedTextField(
        value = state.query, onValueChange = { send(CatalogLibraryEvent.QueryChanged(it)) },
        modifier = Modifier.fillMaxWidth().focusRequester(requester)
            .onFocusChanged { if (it.isFocused) send(CatalogLibraryEvent.UtilityFocused(CatalogFocusTarget.SEARCH)) }
            .semantics { selected = state.focus.target == CatalogFocusTarget.SEARCH },
        label = { Text("Search") }, singleLine = true,
        keyboardActions = KeyboardActions(onDone = { send(CatalogLibraryEvent.SubmitSearch) }),
    )
}

@Composable
private fun CatalogSearchButton(
    state: CatalogLibraryState,
    requester: FocusRequester,
    send: (CatalogLibraryEvent) -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxWidth().height(44.dp).focusRequester(requester)
            .focusProperties { canFocus = catalogUtilityCanFocus(state, CatalogFocusTarget.SEARCH) }
            .onFocusChanged { if (it.isFocused) send(CatalogLibraryEvent.UtilityFocused(CatalogFocusTarget.SEARCH)) }
            .clickable(role = Role.Button, onClickLabel = "Search games") { send(CatalogLibraryEvent.BeginSearch) }
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            text = state.query.ifBlank { "Search  ·  X" },
            color = if (state.query.isBlank()) Color(CatalogPalette.MUTED) else Color.White,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = if (state.focus.target == CatalogFocusTarget.SEARCH) FontWeight.Bold else FontWeight.Medium,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun CatalogRefreshButton(
    state: CatalogLibraryState,
    loading: Boolean,
    requester: FocusRequester,
    send: (CatalogLibraryEvent) -> Unit,
) {
    UtilityButton(
        view = CatalogUtilityView(
            if (loading) "…" else "Sync · Y", state.focus.target == CatalogFocusTarget.REFRESH, !loading,
        ),
        interaction = CatalogUtilityInteraction(
            focusRequester = requester,
            onFocused = {
                if (it) send(CatalogLibraryEvent.UtilityFocused(CatalogFocusTarget.REFRESH))
            },
            onClick = { send(CatalogLibraryEvent.Controller(CatalogControllerCommand.REFRESH)) },
        ),
    )
}
