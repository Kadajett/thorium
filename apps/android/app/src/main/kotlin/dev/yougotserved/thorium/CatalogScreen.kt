package dev.yougotserved.thorium

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.CircularProgressIndicator
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
    var searchInputFocused by remember { mutableStateOf(false) }
    val searchFocusRequester = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current
    val gridState = rememberLazyGridState()
    val matches = items.filter { item ->
        query.isBlank() || item.game.title.contains(query, ignoreCase = true) ||
            item.game.tagline.contains(query, ignoreCase = true)
    }
    val currentMatches by rememberUpdatedState(matches)
    val currentOnAction by rememberUpdatedState(onAction)
    val currentOnSearch by rememberUpdatedState(onSearch)
    val currentOnBack by rememberUpdatedState(onBack)

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF171329), Color(0xFF090A12)),
                ),
            ),
    ) {
        val gridSpacing = 16.dp
        val availableWidth = maxWidth - 40.dp
        val columnCount = ((availableWidth.value + gridSpacing.value) /
            (MINIMUM_CARD_WIDTH.value + gridSpacing.value)).toInt().coerceAtLeast(1)
        val searchWidth = (maxWidth * 0.34f).coerceIn(180.dp, 270.dp)

        LaunchedEffect(matches.size) {
            focus = CatalogFocusPolicy.normalized(focus, matches.size)
        }
        LaunchedEffect(focus.target, focus.cardIndex, matches.size) {
            if (focus.target == CatalogFocusTarget.CARD && matches.isNotEmpty()) {
                gridState.animateScrollToItem(focus.cardIndex)
            }
        }
        LaunchedEffect(controllerCommands, columnCount) {
            controllerCommands.collect { command ->
                when (command) {
                    CatalogControllerCommand.MOVE_UP,
                    CatalogControllerCommand.MOVE_DOWN,
                    CatalogControllerCommand.MOVE_LEFT,
                    CatalogControllerCommand.MOVE_RIGHT,
                    -> {
                        focusManager.clearFocus()
                        focus = CatalogFocusPolicy.move(
                            focus = focus,
                            command = command,
                            itemCount = currentMatches.size,
                            columnCount = columnCount,
                        )
                    }
                    CatalogControllerCommand.ACTIVATE -> when (
                        CatalogFocusPolicy.activation(focus, currentMatches.size)
                    ) {
                        CatalogActivation.ACTIVATE_CARD ->
                            currentMatches.getOrNull(focus.cardIndex)?.let(currentOnAction)
                        CatalogActivation.FOCUS_SEARCH -> searchFocusRequester.requestFocus()
                        CatalogActivation.REFRESH -> currentOnSearch(query)
                        null -> Unit
                    }
                    CatalogControllerCommand.SEARCH -> {
                        focus = focus.copy(target = CatalogFocusTarget.SEARCH)
                        searchFocusRequester.requestFocus()
                    }
                    CatalogControllerCommand.REFRESH -> {
                        focusManager.clearFocus()
                        focus = focus.copy(target = CatalogFocusTarget.REFRESH)
                        currentOnSearch(query)
                    }
                    CatalogControllerCommand.BACK_OR_CLEAR -> when (
                        CatalogFocusPolicy.backDecision(query, searchInputFocused)
                    ) {
                        CatalogBackDecision.CLEAR_SEARCH -> {
                            query = ""
                            focusManager.clearFocus()
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
                .padding(horizontal = 20.dp, vertical = 14.dp),
        ) {
            CatalogTopBar(
                query = query,
                searchWidth = searchWidth,
                searchSelected = focus.target == CatalogFocusTarget.SEARCH,
                refreshSelected = focus.target == CatalogFocusTarget.REFRESH,
                loading = loading,
                searchFocusRequester = searchFocusRequester,
                onSearchFocused = {
                    searchInputFocused = it
                    if (it) focus = focus.copy(target = CatalogFocusTarget.SEARCH)
                },
                onQueryChanged = { query = it },
                onSearch = { currentOnSearch(query) },
                onRefresh = {
                    focus = focus.copy(target = CatalogFocusTarget.REFRESH)
                    currentOnSearch(query)
                },
            )
            Spacer(Modifier.height(8.dp))
            CatalogLegend()
            CatalogStatus(error = error)
            Spacer(Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom,
            ) {
                Text(
                    text = "Game library",
                    color = Color.White,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Black,
                    modifier = Modifier.semantics { heading() },
                )
                Text(
                    text = "${matches.size} ${if (matches.size == 1) "game" else "games"}",
                    color = Color(0xFFAAA6BD),
                    style = MaterialTheme.typography.labelMedium,
                )
            }
            Spacer(Modifier.height(8.dp))

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
                    modifier = Modifier.fillMaxSize(),
                    horizontalArrangement = Arrangement.spacedBy(gridSpacing),
                    verticalArrangement = Arrangement.spacedBy(gridSpacing),
                ) {
                    itemsIndexed(
                        items = matches,
                        key = { _, item -> "${item.game.packageId}:${item.game.contentDigest}" },
                    ) { index, item ->
                        GameCoverCard(
                            item = item,
                            selected = focus.target == CatalogFocusTarget.CARD &&
                                focus.cardIndex == index,
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
    searchFocusRequester: FocusRequester,
    onSearchFocused: (Boolean) -> Unit,
    onQueryChanged: (String) -> Unit,
    onSearch: () -> Unit,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "THORIUM",
                color = Color(0xFF67E8F9),
                fontSize = 12.sp,
                fontWeight = FontWeight.Black,
                letterSpacing = 3.sp,
            )
            Text(
                text = "Ready to play",
                color = Color.White,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Black,
                modifier = Modifier.semantics { heading() },
            )
        }
        Box(
            modifier = Modifier
                .width(searchWidth)
                .clip(RoundedCornerShape(14.dp))
                .border(
                    width = if (searchSelected) 3.dp else 1.dp,
                    color = if (searchSelected) Color(0xFF67E8F9) else Color(0xFF39344A),
                    shape = RoundedCornerShape(14.dp),
                )
                .padding(2.dp),
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = onQueryChanged,
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(searchFocusRequester)
                    .onFocusChanged { onSearchFocused(it.isFocused) }
                    .semantics { selected = searchSelected },
                label = { Text("Search") },
                singleLine = true,
                keyboardActions = KeyboardActions(onDone = { onSearch() }),
            )
        }
        UtilityButton(
            label = if (loading) "Loading" else "Refresh",
            selected = refreshSelected,
            enabled = !loading,
            onClick = onRefresh,
        )
    }
}

@Composable
private fun UtilityButton(
    label: String,
    selected: Boolean,
    enabled: Boolean,
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
            .height(54.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(background)
            .border(
                width = if (selected) 3.dp else 1.dp,
                color = if (selected) Color(0xFF67E8F9) else Color(0xFF39344A),
                shape = RoundedCornerShape(14.dp),
            )
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
            .padding(horizontal = 14.dp),
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
private fun CatalogLegend() {
    Text(
        text = "D-pad  Move     A  Select     X  Search     Y  Refresh     B  Back",
        color = Color(0xFFAAA6BD),
        style = MaterialTheme.typography.labelMedium,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
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

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 184.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(if (selected) Color(0xFF29213F) else Color(0xFF1F1B2E))
            .border(
                width = if (selected) 4.dp else 1.dp,
                color = if (selected) Color(0xFF67E8F9) else Color(0xFF39344A),
                shape = RoundedCornerShape(20.dp),
            )
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
                .fillMaxWidth()
                .height(92.dp)
                .background(
                    Brush.linearGradient(
                        listOf(accent, Color(0xFF155E75), Color(0xFF111827)),
                    ),
                )
                .padding(14.dp),
        ) {
            Text(
                text = initials,
                color = Color.White,
                fontSize = 34.sp,
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
        Column(modifier = Modifier.padding(14.dp)) {
            Text(
                text = game.title,
                color = Color.White,
                fontSize = 20.sp,
                fontWeight = FontWeight.Black,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = game.tagline,
                color = Color(0xFFD5D0E4),
                style = MaterialTheme.typography.bodySmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(10.dp))
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

private val MINIMUM_CARD_WIDTH = 286.dp
