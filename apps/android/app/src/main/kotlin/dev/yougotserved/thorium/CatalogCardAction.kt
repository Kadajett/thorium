package dev.yougotserved.thorium

internal data class CatalogCardAction(val label: String, val color: Long, val enabled: Boolean)

internal fun catalogCardAction(item: CatalogItem): CatalogCardAction = when (item.actionState) {
    CatalogActionState.INSTALLED -> CatalogCardAction("Play · Ready", CatalogPalette.INSTALLED, true)
    CatalogActionState.AVAILABLE -> CatalogCardAction("Play", item.game.accent, true)
    CatalogActionState.INSTALLING -> CatalogCardAction("Preparing…", CatalogPalette.INSTALLING, false)
    CatalogActionState.INSTALL_ERROR -> CatalogCardAction("Retry Play", CatalogPalette.INSTALL_ERROR, true)
}

internal fun catalogCardInitials(title: String): String = title.trim().split(Regex("\\s+"))
    .take(2)
    .mapNotNull { word -> word.firstOrNull() }
    .joinToString("")
    .uppercase()
    .ifEmpty { "?" }
