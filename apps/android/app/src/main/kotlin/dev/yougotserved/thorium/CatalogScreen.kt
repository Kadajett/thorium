package dev.yougotserved.thorium

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun CatalogScreen(
    items: List<CatalogItem>,
    loading: Boolean,
    error: String?,
    onSearch: (String) -> Unit,
    onAction: (CatalogItem) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var selected by remember { mutableIntStateOf(0) }
    var playKeyHeld by remember { mutableStateOf(false) }
    val focusRequester = remember { FocusRequester() }
    val matches = items.filter { item ->
        query.isBlank() || item.game.title.contains(query, ignoreCase = true) ||
            item.game.tagline.contains(query, ignoreCase = true)
    }

    LaunchedEffect(matches.size) {
        selected = selected.coerceIn(0, (matches.size - 1).coerceAtLeast(0))
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF171329), Color(0xFF090A12)),
                ),
            )
            .onPreviewKeyEvent { event ->
                if (matches.isEmpty()) return@onPreviewKeyEvent false
                when (event.key) {
                    Key.DirectionDown -> {
                        if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                        selected = (selected + 1).coerceAtMost(matches.lastIndex)
                    }
                    Key.DirectionUp -> {
                        if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                        selected = (selected - 1).coerceAtLeast(0)
                    }
                    Key.Enter, Key.NumPadEnter, Key.ButtonA -> {
                        when (event.type) {
                            KeyEventType.KeyDown -> if (!playKeyHeld) {
                                playKeyHeld = true
                                onAction(matches[selected])
                            }
                            KeyEventType.KeyUp -> playKeyHeld = false
                            else -> return@onPreviewKeyEvent false
                        }
                    }
                    else -> return@onPreviewKeyEvent false
                }
                true
            }
            .focusRequester(focusRequester)
            .focusable(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(28.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            item {
                Text(
                    text = "THORIUM",
                    color = Color(0xFF67E8F9),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Black,
                    letterSpacing = 3.sp,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "Pick something quick.",
                    color = Color.White,
                    style = MaterialTheme.typography.headlineLarge,
                    fontWeight = FontWeight.Black,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "Tiny games built for both screens.",
                    color = Color(0xFFAAA6BD),
                    style = MaterialTheme.typography.bodyLarge,
                )
            }

            item {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Search games") },
                    singleLine = true,
                    keyboardActions = KeyboardActions(
                        onDone = { onSearch(query) },
                    ),
                )
                Spacer(Modifier.height(10.dp))
                Button(onClick = { onSearch(query) }) {
                    Text("Search remote catalog")
                }
            }

            if (loading) {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.width(28.dp))
                        Spacer(Modifier.width(12.dp))
                        Text("Loading catalog…", color = Color(0xFFD5D0E4))
                    }
                }
            }

            error?.let { message ->
                item {
                    Text(message, color = Color(0xFFFFA8A8))
                }
            }

            if (matches.isEmpty()) {
                item {
                    Text(
                        text = "No games found. Try a shorter search.",
                        color = Color(0xFFAAA6BD),
                        modifier = Modifier.padding(vertical = 36.dp),
                    )
                }
            } else {
                itemsIndexed(
                    matches,
                    key = { _, item -> "${item.game.packageId}:${item.game.contentDigest ?: "bundled"}" },
                ) { index, item ->
                    GameCard(
                        item = item,
                        selected = index == selected,
                        onSelect = { selected = index },
                        onAction = { onAction(item) },
                    )
                }
            }
        }
    }

    LaunchedEffect(Unit) { focusRequester.requestFocus() }
}

@Composable
private fun GameCard(
    item: CatalogItem,
    selected: Boolean,
    onSelect: () -> Unit,
    onAction: () -> Unit,
) {
    val game = item.game
    val accent = Color(game.accent)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(Color(0xFF1F1B2E))
            .border(
                width = if (selected) 3.dp else 1.dp,
                color = if (selected) accent else Color(0xFF39344A),
                shape = RoundedCornerShape(22.dp),
            )
            .onFocusChanged { if (it.isFocused) onSelect() }
            .clickable(
                enabled = item.actionState != CatalogActionState.INSTALLING,
                onClick = onAction,
            )
            .padding(20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .width(76.dp)
                .height(76.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(
                    Brush.linearGradient(listOf(accent, Color(0xFF22D3EE))),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text("TR", color = Color.White, fontWeight = FontWeight.Black, fontSize = 24.sp)
        }
        Spacer(Modifier.width(18.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(game.title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 22.sp)
            Spacer(Modifier.height(4.dp))
            Text(game.tagline, color = Color(0xFFD5D0E4), style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(8.dp))
            Text(game.playerLabel, color = Color(0xFF8DE8F4), style = MaterialTheme.typography.labelMedium)
        }
        Button(
            onClick = onAction,
            enabled = item.actionState != CatalogActionState.INSTALLING,
            colors = ButtonDefaults.buttonColors(containerColor = accent),
        ) {
            Text(
                when (item.actionState) {
                    CatalogActionState.BUNDLED, CatalogActionState.INSTALLED -> "Play"
                    CatalogActionState.AVAILABLE -> "Install"
                    CatalogActionState.INSTALLING -> "Installing…"
                    CatalogActionState.INSTALL_ERROR -> "Retry"
                },
                fontWeight = FontWeight.Bold,
            )
        }
    }
}
