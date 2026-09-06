package dev.yougotserved.thorium

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
internal fun UtilityButton(view: CatalogUtilityView, interaction: CatalogUtilityInteraction) {
    Box(modifier = catalogUtilityModifier(view, interaction), contentAlignment = Alignment.Center) {
        Text(
            text = view.label, color = if (view.enabled) Color.White else Color(CatalogPalette.MUTED),
            fontWeight = FontWeight.Bold,
        )
    }
}

private fun catalogUtilityModifier(view: CatalogUtilityView, interaction: CatalogUtilityInteraction): Modifier =
    Modifier.widthIn(min = 92.dp).height(46.dp).clip(RoundedCornerShape(10.dp))
        .background(Color(catalogUtilityBackground(view)))
        .border(
            width = if (view.selected) 3.dp else 1.dp,
            color = Color(if (view.selected) CatalogPalette.ACCENT else CatalogPalette.BORDER),
            shape = RoundedCornerShape(10.dp),
        )
        .focusRequester(interaction.focusRequester)
        .focusProperties { canFocus = view.selected }
        .onFocusChanged { interaction.onFocused(it.isFocused) }
        .semantics {
            selected = view.selected
            stateDescription = view.label
            role = Role.Button
        }
        .clickable(
            enabled = view.enabled, role = Role.Button, onClickLabel = view.label, onClick = interaction.onClick,
        ).padding(horizontal = 10.dp)

private fun catalogUtilityBackground(view: CatalogUtilityView): Long = when {
    !view.enabled -> CatalogPalette.DISABLED
    view.selected -> CatalogPalette.UTILITY_SELECTED
    else -> CatalogPalette.CARD
}
