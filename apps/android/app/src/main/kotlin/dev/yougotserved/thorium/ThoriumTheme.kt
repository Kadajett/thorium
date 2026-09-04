package dev.yougotserved.thorium

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val ThoriumColors = darkColorScheme(
    primary = Color(0xFF8B5CF6),
    secondary = Color(0xFF22D3EE),
    background = Color(0xFF090A12),
    surface = Color(0xFF1F1B2E),
    onPrimary = Color.White,
    onBackground = Color.White,
    onSurface = Color.White,
)

@Composable
fun ThoriumTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = ThoriumColors, content = content)
}
