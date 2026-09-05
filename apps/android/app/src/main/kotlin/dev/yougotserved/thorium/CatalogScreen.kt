package dev.yougotserved.thorium

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect

@Composable
fun CatalogScreen(
    items: List<CatalogItem>,
    loading: Boolean,
    error: String?,
    onSearch: (String) -> Unit,
    onAction: (CatalogItem) -> Unit,
    onBack: () -> Unit,
    controllerCommands: Flow<CatalogControllerCommand>,
) {
    var query by remember { mutableStateOf("") }
    var focus by remember { mutableStateOf(CatalogFocus()) }
    var searchEditing by remember { mutableStateOf(false) }
    var initialFocusRequested by remember { mutableStateOf(false) }
    val searchTileFocusRequester = remember { FocusRequester() }
    val searchInputFocusRequester = remember { FocusRequester() }
    val refreshFocusRequester = remember { FocusRequester() }
    val gridState = rememberLazyGridState()
    val matches = items.filter { item ->
        query.isBlank() || item.game.title.contains(query, ignoreCase = true) ||
            item.game.tagline.contains(query, ignoreCase = true)
    }
    val matchKeys = matches.map { "${it.game.packageId}:${it.game.contentDigest}" }
    val cardFocusRequesters = remember(matchKeys) {
        List(matchKeys.size) { FocusRequester() }
    }
    val currentMatches by rememberUpdatedState(matches)
    val currentOnAction by rememberUpdatedState(onAction)
    val currentOnSearch by rememberUpdatedState(onSearch)
    val currentOnBack by rememberUpdatedState(onBack)
    val focusManager = LocalFocusManager.current

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF171329), Color(0xFF090A12)),
                ),
            ),
    ) {
        val gridSpacing = 12.dp
        val availableWidth = maxWidth - 28.dp
        val columnCount = ((availableWidth.value + gridSpacing.value) /
            (MINIMUM_CARD_WIDTH.value + gridSpacing.value)).toInt().coerceAtLeast(1)
        val searchWidth = (maxWidth * 0.30f).coerceIn(168.dp, 250.dp)

        LaunchedEffect(matches.size) {
            focus = CatalogFocusPolicy.normalized(focus, matches.size)
        }
        LaunchedEffect(cardFocusRequesters, searchEditing) {
            if (!initialFocusRequested && !searchEditing && cardFocusRequesters.isNotEmpty()) {
                cardFocusRequesters.first().requestFocus()
                initialFocusRequested = true
            }
        }
        LaunchedEffect(searchEditing) {
            if (searchEditing) {
                searchInputFocusRequester.requestFocus()
            } else if (initialFocusRequested && focus.target == CatalogFocusTarget.SEARCH) {
                searchTileFocusRequester.requestFocus()
            }
        }
        LaunchedEffect(controllerCommands) {
            controllerCommands.collect { command ->
                when (command) {
                    CatalogControllerCommand.MOVE_UP,
                    -> if (!searchEditing) focusManager.moveFocus(FocusDirection.Up)
                    CatalogControllerCommand.MOVE_DOWN ->
                        if (!searchEditing) focusManager.moveFocus(FocusDirection.Down)
                    CatalogControllerCommand.MOVE_LEFT ->
                        if (!searchEditing) focusManager.moveFocus(FocusDirection.Left)
                    CatalogControllerCommand.MOVE_RIGHT ->
                        if (!searchEditing) focusManager.moveFocus(FocusDirection.Right)
                    CatalogControllerCommand.ACTIVATE -> when (
                        CatalogFocusPolicy.activation(focus, currentMatches.size)
                    ) {
                        CatalogActivation.ACTIVATE_CARD ->
                            currentMatches.getOrNull(focus.cardIndex)?.let(currentOnAction)
                        CatalogActivation.FOCUS_SEARCH -> searchEditing = true
                        CatalogActivation.REFRESH -> currentOnSearch(query)
                        null -> Unit
                    }
                    CatalogControllerCommand.SEARCH -> {
                        focus = focus.copy(target = CatalogFocusTarget.SEARCH)
                        searchEditing = true
                    }
                    CatalogControllerCommand.REFRESH -> {
                        currentOnSearch(query)
                    }
                    CatalogControllerCommand.BACK_OR_CLEAR -> when (
                        CatalogFocusPolicy.backDecision(query, searchEditing)
                    ) {
                        CatalogBackDecision.CLEAR_SEARCH -> {
                            query = ""
                            searchEditing = false
                            currentOnSearch("")
                        }
                        CatalogBackDecision.NAVIGATE_BACK -> currentOnBack()
                    }
                }
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            CatalogTopBar(
                query = query,
                searchWidth = searchWidth,
                searchSelected = focus.target == CatalogFocusTarget.SEARCH,
                refreshSelected = focus.target == CatalogFocusTarget.REFRESH,
                loading = loading,
                searchEditing = searchEditing,
                searchTileFocusRequester = searchTileFocusRequester,
                searchInputFocusRequester = searchInputFocusRequester,
                refreshFocusRequester = refreshFocusRequester,
                onSearchFocused = {
                    if (it) focus = focus.copy(target = CatalogFocusTarget.SEARCH)
                },
                onRefreshFocused = {
                    if (it) focus = focus.copy(target = CatalogFocusTarget.REFRESH)
                },
                onBeginSearchEdit = {
                    focus = focus.copy(target = CatalogFocusTarget.SEARCH)
                    searchEditing = true
                },
                onQueryChanged = { query = it },
                onSearch = {
                    currentOnSearch(query)
                    searchEditing = false
                },
                onRefresh = {
                    currentOnSearch(query)
                },
            )
            CatalogStatus(error = error)
            Spacer(Modifier.height(10.dp))

            if (!loading && matches.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        text = if (query.isBlank()) {
                            "No games are available right now."
                        } else {
                            "No games match your search."
                        },
                        color = Color(0xFFAAA6BD),
                    )
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(columnCount),
                    state = gridState,
                    modifier = Modifier
                        .fillMaxSize()
                        .focusGroup(),
                    horizontalArrangement = Arrangement.spacedBy(gridSpacing),
                    verticalArrangement = Arrangement.spacedBy(gridSpacing),
                    userScrollEnabled = true,
                ) {
                    itemsIndexed(
                        items = matches,
                        key = { _, item -> "${item.game.packageId}:${item.game.contentDigest}" },
                    ) { index, item ->
                        GameCoverCard(
                            item = item,
                            selected = focus.target == CatalogFocusTarget.CARD &&
                                focus.cardIndex == index,
                            focusRequester = cardFocusRequesters[index],
                            onFocused = {
                                focus = CatalogFocus(CatalogFocusTarget.CARD, index)
                            },
                            onAction = {
                                focus = CatalogFocus(CatalogFocusTarget.CARD, index)
                                currentOnAction(item)
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CatalogTopBar(
    query: String,
    searchWidth: Dp,
    searchSelected: Boolean,
    refreshSelected: Boolean,
    loading: Boolean,
    searchEditing: Boolean,
    searchTileFocusRequester: FocusRequester,
    searchInputFocusRequester: FocusRequester,
    refreshFocusRequester: FocusRequester,
    onSearchFocused: (Boolean) -> Unit,
    onRefreshFocused: (Boolean) -> Unit,
    onBeginSearchEdit: () -> Unit,
    onQueryChanged: (String) -> Unit,
    onSearch: () -> Unit,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .focusGroup(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "THORIUM  /  GAME LIBRARY",
                color = Color(0xFF67E8F9),
                fontSize = 13.sp,
                fontWeight = FontWeight.Black,
                letterSpacing = 1.5.sp,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = "D-pad / stick  Move     A  Open     X  Search     Y  Sync",
                color = Color(0xFFAAA6BD),
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Box(
            modifier = Modifier
                .width(searchWidth)
                .clip(RoundedCornerShape(10.dp))
                .border(
                    width = if (searchSelected) 3.dp else 1.dp,
                    color = if (searchSelected) Color(0xFF67E8F9) else Color(0xFF39344A),
                    shape = RoundedCornerShape(10.dp),
                )
                .padding(1.dp),
        ) {
            if (searchEditing) {
                OutlinedTextField(
                    value = query,
                    onValueChange = onQueryChanged,
                    modifier = Modifier
                        .fillMaxWidth()
                        .focusRequester(searchInputFocusRequester)
                        .onFocusChanged { onSearchFocused(it.isFocused) }
                        .semantics { selected = searchSelected },
                    label = { Text("Search") },
                    singleLine = true,
                    keyboardActions = KeyboardActions(onDone = { onSearch() }),
                )
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(44.dp)
                        .focusRequester(searchTileFocusRequester)
                        .onFocusChanged { onSearchFocused(it.isFocused) }
                        .clickable(
                            role = Role.Button,
                            onClickLabel = "Search games",
                            onClick = onBeginSearchEdit,
                        )
                        .padding(horizontal = 14.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Text(
                        text = query.ifBlank { "Search  ·  X" },
                        color = if (query.isBlank()) Color(0xFFAAA6BD) else Color.White,
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = if (searchSelected) FontWeight.Bold else FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        UtilityButton(
            label = if (loading) "…" else "Sync · Y",
            selected = refreshSelected,
            enabled = !loading,
            focusRequester = refreshFocusRequester,
            onFocused = onRefreshFocused,
            onClick = onRefresh,
        )
    }
}

@Composable
private fun UtilityButton(
    label: String,
    selected: Boolean,
    enabled: Boolean,
    focusRequester: FocusRequester,
    onFocused: (Boolean) -> Unit,
    onClick: () -> Unit,
) {
    val background = when {
        !enabled -> Color(0xFF282536)
        selected -> Color(0xFF164E63)
        else -> Color(0xFF1F1B2E)
    }
    Box(
        modifier = Modifier
            .widthIn(min = 92.dp)
            .height(46.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(background)
            .border(
                width = if (selected) 3.dp else 1.dp,
                color = if (selected) Color(0xFF67E8F9) else Color(0xFF39344A),
                shape = RoundedCornerShape(10.dp),
            )
            .focusRequester(focusRequester)
            .onFocusChanged { onFocused(it.isFocused) }
            .semantics {
                this.selected = selected
                stateDescription = label
                role = Role.Button
            }
            .clickable(
                enabled = enabled,
                role = Role.Button,
                onClickLabel = label,
                onClick = onClick,
            )
            .padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = if (enabled) Color.White else Color(0xFFAAA6BD),
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun CatalogStatus(error: String?) {
    error?.let { message ->
        Spacer(Modifier.height(6.dp))
        Text(
            text = message,
            color = Color(0xFFFFA8A8),
            style = MaterialTheme.typography.bodySmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}

@Composable
private fun GameCoverCard(
    item: CatalogItem,
    selected: Boolean,
    focusRequester: FocusRequester,
    onFocused: () -> Unit,
    onAction: () -> Unit,
) {
    val game = item.game
    val accent = Color(game.accent)
    val enabled = item.actionState != CatalogActionState.INSTALLING
    val actionLabel = when (item.actionState) {
        CatalogActionState.INSTALLED -> "Installed · Play"
        CatalogActionState.AVAILABLE -> "Download · Install"
        CatalogActionState.INSTALLING -> "Installing…"
        CatalogActionState.INSTALL_ERROR -> "Install failed · Retry"
    }
    val actionColor = when (item.actionState) {
        CatalogActionState.INSTALLED -> Color(0xFF047857)
        CatalogActionState.AVAILABLE -> accent
        CatalogActionState.INSTALLING -> Color(0xFF4B5563)
        CatalogActionState.INSTALL_ERROR -> Color(0xFFB91C1C)
    }
    val initials = remember(game.title) {
        game.title.trim().split(Regex("\\s+"))
            .take(2)
            .mapNotNull { word -> word.firstOrNull() }
            .joinToString("")
            .uppercase()
            .ifEmpty { "?" }
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(148.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) Color(0xFF29213F) else Color(0xFF1F1B2E))
            .border(
                width = if (selected) 4.dp else 1.dp,
                color = if (selected) Color(0xFF67E8F9) else Color(0xFF39344A),
                shape = RoundedCornerShape(14.dp),
            )
            .focusRequester(focusRequester)
            .onFocusChanged { if (it.isFocused) onFocused() }
            .semantics(mergeDescendants = true) {
                this.selected = selected
                stateDescription = actionLabel
                role = Role.Button
            }
            .clickable(
                enabled = enabled,
                role = Role.Button,
                onClickLabel = actionLabel,
                onClick = onAction,
            ),
    ) {
        Box(
            modifier = Modifier
                .width(92.dp)
                .fillMaxHeight()
                .background(
                    Brush.linearGradient(
                        listOf(accent, Color(0xFF155E75), Color(0xFF111827)),
                    ),
                )
                .padding(10.dp),
        ) {
            Text(
                text = initials,
                color = Color.White,
                fontSize = 30.sp,
                fontWeight = FontWeight.Black,
                modifier = Modifier.align(Alignment.CenterStart),
            )
            Text(
                text = game.version,
                color = Color(0xFFD5F7FB),
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.align(Alignment.TopEnd),
            )
        }
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight()
                .padding(11.dp),
        ) {
            Text(
                text = game.title,
                color = Color.White,
                fontSize = 18.sp,
                fontWeight = FontWeight.Black,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = game.tagline,
                color = Color(0xFFD5D0E4),
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.weight(1f))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = game.playerLabel,
                    color = Color(0xFF8DE8F4),
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = actionLabel,
                    color = Color.White,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .background(actionColor)
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                )
            }
            item.error?.let { message ->
                Spacer(Modifier.height(6.dp))
                Text(
                    text = message,
                    color = Color(0xFFFFA8A8),
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

private val MINIMUM_CARD_WIDTH = 248.dp
