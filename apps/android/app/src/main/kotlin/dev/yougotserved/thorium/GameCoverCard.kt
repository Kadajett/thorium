package dev.yougotserved.thorium

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private const val ACTION_BADGE_CORNER_PERCENT = 50

@Composable
internal fun GameCoverCard(item: CatalogItem, interaction: CatalogCardInteraction) {
    val action = catalogCardAction(item)
    Row(modifier = catalogCardModifier(action, interaction)) {
        CatalogCardArtwork(item.game)
        CatalogCardDetails(item, action)
    }
}

private fun catalogCardModifier(action: CatalogCardAction, interaction: CatalogCardInteraction): Modifier =
    Modifier.fillMaxWidth().height(148.dp).clip(RoundedCornerShape(14.dp))
        .background(Color(if (interaction.selected) CatalogPalette.CARD_SELECTED else CatalogPalette.CARD))
        .border(
            width = if (interaction.selected) 4.dp else 1.dp,
            color = Color(if (interaction.selected) CatalogPalette.ACCENT else CatalogPalette.BORDER),
            shape = RoundedCornerShape(14.dp),
        )
        .focusRequester(interaction.focusRequester)
        .onFocusChanged { if (it.isFocused) interaction.onFocused() }
        // Keep selected cards focused in touch mode so ViewRoot does not consume the first D-pad key.
        .focusProperties { canFocus = true }
        .semantics(mergeDescendants = true) {
            selected = interaction.selected
            stateDescription = action.label
            role = Role.Button
        }
        .clickable(
            enabled = action.enabled, role = Role.Button,
            onClickLabel = action.label, onClick = interaction.onAction,
        )

@Composable
private fun CatalogCardArtwork(game: CatalogGame) {
    val initials = remember(game.title) { catalogCardInitials(game.title) }
    val colors = listOf(Color(game.accent), Color(CatalogPalette.COVER_MIDPOINT), Color(CatalogPalette.COVER_BOTTOM))
    Box(
        modifier = Modifier.width(92.dp).fillMaxHeight()
            .background(Brush.linearGradient(colors)).padding(10.dp),
    ) {
        Text(
            text = initials, color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Black,
            modifier = Modifier.align(Alignment.CenterStart),
        )
        Text(
            text = game.version, color = Color(CatalogPalette.COVER_VERSION),
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.align(Alignment.TopEnd),
        )
    }
}

@Composable
private fun RowScope.CatalogCardDetails(item: CatalogItem, action: CatalogCardAction) {
    Column(modifier = Modifier.weight(1f).fillMaxHeight().padding(11.dp)) {
        CatalogCardHeading(item.game)
        Text(
            text = catalogNetworkLabel(item.game), color = Color(CatalogPalette.MUTED),
            style = MaterialTheme.typography.labelSmall, maxLines = 1,
        )
        Spacer(Modifier.weight(1f))
        CatalogCardFooter(item.game.playerLabel, action)
        CatalogCardError(item.error)
    }
}

@Composable
private fun CatalogCardHeading(game: CatalogGame) {
    Text(
        text = game.title, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Black,
        maxLines = 1, overflow = TextOverflow.Ellipsis,
    )
    Text(
        text = game.tagline, color = Color(CatalogPalette.TAGLINE),
        style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun CatalogCardFooter(playerLabel: String, action: CatalogCardAction) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = playerLabel, color = Color(CatalogPalette.PLAYER_LABEL),
            style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = action.label, color = Color.White, style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.clip(RoundedCornerShape(ACTION_BADGE_CORNER_PERCENT)).background(Color(action.color))
                .padding(horizontal = 10.dp, vertical = 5.dp),
        )
    }
}

@Composable
private fun CatalogCardError(error: String?) {
    error?.let { message ->
        Spacer(Modifier.height(6.dp))
        Text(
            text = message, color = Color(CatalogPalette.ERROR), style = MaterialTheme.typography.bodySmall,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}
