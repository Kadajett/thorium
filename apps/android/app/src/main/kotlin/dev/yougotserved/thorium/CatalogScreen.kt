package dev.yougotserved.thorium

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun CatalogScreen(
    items: List<CatalogItem>,
    loading: Boolean,
    error: String?,
    onSearch: (String) -> Unit,
    onAction: (CatalogItem) -> Unit,
    onBack: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var selected by remember { mutableIntStateOf(0) }
    var searchFocused by remember { mutableStateOf(false) }
    val catalogFocusRequester = remember { FocusRequester() }
    val searchFocusRequester = remember { FocusRequester() }
    val pressedKeys = remember { mutableSetOf<CatalogControllerKey>() }
    val gridState = rememberLazyGridState()
    val matches = items.filter { item ->
        query.isBlank() || item.game.title.contains(query, ignoreCase = true) ||
            item.game.tagline.contains(query, ignoreCase = true)
    }

    LaunchedEffect(matches.size) {
        selected = selected.coerceIn(0, (matches.size - 1).coerceAtLeast(0))
    }
    LaunchedEffect(selected, matches.size) {
        if (matches.isNotEmpty()) gridState.animateScrollToItem(selected)
    }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF171329), Color(0xFF090A12)),
                ),
            ),
    ) {
        val gridSpacing = 14.dp
        val availableWidth = maxWidth - 48.dp
        val columnCount = ((availableWidth.value + gridSpacing.value) /
            (MINIMUM_CARD_WIDTH.value + gridSpacing.value)).toInt().coerceAtLeast(1)

        fun handle(command: CatalogControllerCommand) {
            when (command) {
                CatalogControllerCommand.MOVE_UP,
                CatalogControllerCommand.MOVE_DOWN,
                CatalogControllerCommand.MOVE_LEFT,
                CatalogControllerCommand.MOVE_RIGHT,
                -> {
                    selected = CatalogControllerPolicy.moveSelection(
                        selected = selected,
                        itemCount = matches.size,
                        columnCount = columnCount,
                        command = command,
                    )
                    catalogFocusRequester.requestFocus()
                }
                CatalogControllerCommand.ACTIVATE -> matches.getOrNull(selected)?.let(onAction)
                CatalogControllerCommand.SEARCH -> searchFocusRequester.requestFocus()
                CatalogControllerCommand.REFRESH -> onSearch(query)
                CatalogControllerCommand.BACK_OR_CLEAR -> when (
                    CatalogControllerPolicy.backDecision(query, searchFocused)
                ) {
                    CatalogBackDecision.CLEAR_SEARCH -> {
                        query = ""
                        onSearch("")
                        catalogFocusRequester.requestFocus()
                    }
                    CatalogBackDecision.NAVIGATE_BACK -> onBack()
                }
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .focusRequester(catalogFocusRequester)
                .onPreviewKeyEvent { event ->
                    val input = event.toCatalogControllerInput(pressedKeys)
                        ?: return@onPreviewKeyEvent false
                    CatalogControllerPolicy.command(input)?.let(::handle)
                    true
                }
                .focusable()
                .semantics { contentDescription = "Thorium game catalog" }
                .padding(horizontal = 24.dp, vertical = 18.dp),
        ) {
            CatalogHeader()
            Spacer(Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier
                        .weight(1f)
                        .focusRequester(searchFocusRequester)
                        .onFocusChanged { searchFocused = it.isFocused },
                    label = { Text("Search games") },
                    singleLine = true,
                    keyboardActions = KeyboardActions(onDone = { onSearch(query) }),
                )
                Button(onClick = { onSearch(query) }) { Text("Search") }
                Button(onClick = { onSearch(query) }) { Text("Refresh") }
            }
            Spacer(Modifier.height(10.dp))

            if (loading) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(modifier = Modifier.width(24.dp))
                    Spacer(Modifier.width(10.dp))
                    Text("Loading catalog…", color = Color(0xFFD5D0E4))
                }
                Spacer(Modifier.height(8.dp))
            }
            error?.let { message ->
                Text(
                    text = message,
                    color = Color(0xFFFFA8A8),
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
                Spacer(Modifier.height(8.dp))
            }

            if (!loading && matches.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        text = "No games found. Try a shorter search.",
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
                        GameCard(
                            item = item,
                            focused = CatalogControllerPolicy.isCardFocused(
                                selected = selected,
                                index = index,
                                searchFocused = searchFocused,
                            ),
                            onSelect = {
                                selected = index
                                catalogFocusRequester.requestFocus()
                            },
                            onAction = {
                                selected = index
                                onAction(item)
                            },
                        )
                    }
                }
            }
        }
    }

    LaunchedEffect(Unit) { catalogFocusRequester.requestFocus() }
}

@Composable
private fun CatalogHeader() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Bottom,
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
                text = "Pick something quick.",
                color = Color.White,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Black,
                modifier = Modifier.semantics { heading() },
            )
        }
        Text(
            text = "D-pad Navigate  ·  A Select  ·  X Search  ·  Y Refresh  ·  B Back",
            color = Color(0xFFAAA6BD),
            style = MaterialTheme.typography.labelMedium,
            textAlign = TextAlign.End,
            maxLines = 2,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun GameCard(
    item: CatalogItem,
    focused: Boolean,
    onSelect: () -> Unit,
    onAction: () -> Unit,
) {
    val game = item.game
    val accent = Color(game.accent)
    val enabled = item.actionState != CatalogActionState.INSTALLING
    val actionLabel = when (item.actionState) {
        CatalogActionState.INSTALLED -> "Play"
        CatalogActionState.AVAILABLE -> "Install"
        CatalogActionState.INSTALLING -> "Installing"
        CatalogActionState.INSTALL_ERROR -> "Retry"
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
            .heightIn(min = 132.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(if (focused) Color(0xFF29213F) else Color(0xFF1F1B2E))
            .border(
                width = if (focused) 3.dp else 1.dp,
                color = if (focused) accent else Color(0xFF39344A),
                shape = RoundedCornerShape(18.dp),
            )
            .onFocusChanged { if (it.isFocused) onSelect() }
            .semantics(mergeDescendants = true) {
                selected = focused
                stateDescription = actionLabel
                role = Role.Button
            }
            .clickable(
                enabled = enabled,
                role = Role.Button,
                onClickLabel = actionLabel,
                onClick = onAction,
            )
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .width(54.dp)
                    .height(54.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Brush.linearGradient(listOf(accent, Color(0xFF22D3EE)))),
                contentAlignment = Alignment.Center,
            ) {
                Text(initials, color = Color.White, fontWeight = FontWeight.Black, fontSize = 18.sp)
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = game.title,
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
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
            }
        }
        Spacer(Modifier.height(12.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = game.playerLabel,
                color = Color(0xFF8DE8F4),
                style = MaterialTheme.typography.labelSmall,
            )
            Text(
                text = actionLabel,
                color = if (enabled) Color.White else Color(0xFFAAA6BD),
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(if (enabled) accent else Color(0xFF39344A))
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
        item.error?.let { message ->
            Spacer(Modifier.height(8.dp))
            Text(
                text = message,
                color = Color(0xFFFFA8A8),
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

private fun KeyEvent.toCatalogControllerInput(
    pressedKeys: MutableSet<CatalogControllerKey>,
): CatalogControllerInput? {
    val controllerKey = key.toCatalogControllerKey() ?: return null
    val phase = when (type) {
        KeyEventType.KeyDown -> ControllerKeyPhase.DOWN
        KeyEventType.KeyUp -> ControllerKeyPhase.UP
        else -> return null
    }
    val repeatCount = when (phase) {
        ControllerKeyPhase.DOWN -> if (pressedKeys.add(controllerKey)) 0 else 1
        ControllerKeyPhase.UP -> {
            pressedKeys.remove(controllerKey)
            0
        }
    }
    return CatalogControllerInput(controllerKey, phase, repeatCount)
}

private fun Key.toCatalogControllerKey(): CatalogControllerKey? = when (this) {
    Key.DirectionUp -> CatalogControllerKey.DPAD_UP
    Key.DirectionDown -> CatalogControllerKey.DPAD_DOWN
    Key.DirectionLeft -> CatalogControllerKey.DPAD_LEFT
    Key.DirectionRight -> CatalogControllerKey.DPAD_RIGHT
    Key.ButtonA -> CatalogControllerKey.BUTTON_A
    Key.ButtonX -> CatalogControllerKey.BUTTON_X
    Key.ButtonY -> CatalogControllerKey.BUTTON_Y
    Key.ButtonB -> CatalogControllerKey.BUTTON_B
    else -> null
}

private val MINIMUM_CARD_WIDTH = 280.dp
