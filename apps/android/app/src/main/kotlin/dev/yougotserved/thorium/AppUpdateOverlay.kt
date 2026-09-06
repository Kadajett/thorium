package dev.yougotserved.thorium

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@Composable
internal fun AppUpdateOverlay(state: AppUpdateState, actions: AppUpdateActions) {
    if (state.stage == AppUpdateStage.HIDDEN) return
    BackHandler(onBack = actions.dismiss)
    Box(
        Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.75f)).clickable(onClick = {}),
        contentAlignment = Alignment.Center,
    ) {
        Surface(Modifier.widthIn(max = 560.dp).padding(24.dp), shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(appUpdateHeading(state.stage), style = MaterialTheme.typography.headlineSmall)
                Text(appUpdateDescription(state))
                AppUpdateButtons(state, actions)
                Text("D-pad: choose · A: confirm · B: not now", style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

@Composable
private fun AppUpdateButtons(state: AppUpdateState, actions: AppUpdateActions) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        appUpdateButton(state.stage)?.let { label ->
            AppUpdateButton(label, state.selected == 0, actions.confirm)
        }
        AppUpdateButton("Not now", state.selected == 1, actions.dismiss)
    }
}

@Composable
private fun AppUpdateButton(label: String, selected: Boolean, action: () -> Unit) {
    val color = if (selected) MaterialTheme.colorScheme.primary else Color.Transparent
    Button(onClick = action, modifier = Modifier.border(3.dp, color, MaterialTheme.shapes.medium)) { Text(label) }
}
