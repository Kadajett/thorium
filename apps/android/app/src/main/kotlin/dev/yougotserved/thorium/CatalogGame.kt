package dev.yougotserved.thorium

data class CatalogGame(
    val packageId: String,
    val version: String,
    val title: String,
    val tagline: String,
    val playerLabel: String,
    val accent: Long,
    val mainEntrypoint: String,
    val companionEntrypoint: String,
    val runtimeFiles: Set<String>,
    val logicalWidth: Int,
    val logicalHeight: Int,
    val maximumDevicePixelRatio: Double,
    val companionLogicalWidth: Int,
    val companionLogicalHeight: Int,
    val companionMaximumDevicePixelRatio: Double,
    val controls: List<ReleaseControl>,
    val southButtonBinding: SouthButtonBinding?,
    val minPlayers: Int,
    val maxPlayers: Int,
    val maxLocalSlots: Int,
    val sameAccountMultipleSlots: Boolean,
    val multiplayerOnline: Boolean,
    val maxLocalPeerMessageBytes: Int,
    val contentDigest: String?,
    val release: GameRelease?,
    val capabilities: Set<String>,
)

enum class CatalogActionState {
    BUNDLED,
    AVAILABLE,
    INSTALLING,
    INSTALLED,
    INSTALL_ERROR,
}

data class CatalogItem(
    val game: CatalogGame,
    val actionState: CatalogActionState,
    val error: String? = null,
)

object DemoCatalog {
    val games = listOf(
        CatalogGame(
            packageId = "dev.yougotserved.tap-race",
            version = "0.1.0",
            title = "Tap Race",
            tagline = "Two screens. Two rivals. One very tired A button.",
            playerLabel = "1–2 local · online ready",
            accent = 0xFF8B5CF6,
            mainEntrypoint = "main/index.html",
            companionEntrypoint = "companion/index.html",
            runtimeFiles = setOf("main/index.html", "companion/index.html", "dist/game.js"),
            logicalWidth = 960,
            logicalHeight = 540,
            maximumDevicePixelRatio = 2.0,
            companionLogicalWidth = 960,
            companionLogicalHeight = 540,
            companionMaximumDevicePixelRatio = 2.0,
            controls = listOf(ReleaseControl("tap", "Tap", "button")),
            southButtonBinding = SouthButtonBinding(playerSlot = 0, controlId = "tap"),
            minPlayers = 1,
            maxPlayers = 2,
            maxLocalSlots = 2,
            sameAccountMultipleSlots = true,
            multiplayerOnline = true,
            maxLocalPeerMessageBytes = 4096,
            contentDigest = null,
            release = null,
            capabilities = setOf("same-device-peer", "colyseus-session"),
        ),
    )
}

object CatalogBindings {
    fun southButton(release: GameRelease): SouthButtonBinding? = when (release.packageId) {
        "dev.yougotserved.tap-race" -> SouthButtonBinding(playerSlot = 0, controlId = "tap")
        else -> null
    }
}

fun GameRelease.toCatalogGame(): CatalogGame = CatalogGame(
    packageId = packageId,
    version = version,
    title = displayName,
    tagline = summary,
    playerLabel = "$minPlayers–$maxPlayers players · $maxLocalSlots local",
    accent = 0xFF8B5CF6,
    mainEntrypoint = mainEntrypoint,
    companionEntrypoint = companionEntrypoint,
    runtimeFiles = runtimeFiles.toSet(),
    logicalWidth = mainScreen.logicalWidth,
    logicalHeight = mainScreen.logicalHeight,
    maximumDevicePixelRatio = mainScreen.maximumDevicePixelRatio,
    companionLogicalWidth = companionScreen.logicalWidth,
    companionLogicalHeight = companionScreen.logicalHeight,
    companionMaximumDevicePixelRatio = companionScreen.maximumDevicePixelRatio,
    controls = controls,
    southButtonBinding = CatalogBindings.southButton(this),
    minPlayers = minPlayers,
    maxPlayers = maxPlayers,
    maxLocalSlots = maxLocalSlots,
    sameAccountMultipleSlots = sameAccountMultipleSlots,
    multiplayerOnline = multiplayerOnline,
    maxLocalPeerMessageBytes = maxLocalPeerMessageBytes,
    contentDigest = contentDigest,
    release = this,
    capabilities = capabilities.toSet(),
)
