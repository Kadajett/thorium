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
    val contentDigest: String,
    val release: GameRelease?,
    val capabilities: Set<String>,
)

enum class CatalogActionState {
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

object CatalogBindings {
    fun southButton(release: GameRelease): SouthButtonBinding? = release.controls
        .firstOrNull { control -> control.kind == "button" }
        ?.let { control -> SouthButtonBinding(playerSlot = 0, controlId = control.id) }
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

object CatalogItemPolicy {
    fun merge(
        remote: List<GameRelease>,
        installed: List<CatalogGame>,
        query: String,
    ): List<CatalogItem> {
        val installedByRelease = installed.associateBy { game -> game.releaseKey() }
        val remoteKeys = remote.mapTo(mutableSetOf()) { release -> release.releaseKey() }
        val remoteItems = remote.map { release ->
            val installedGame = installedByRelease[release.releaseKey()]
            CatalogItem(
                game = installedGame?.copy(release = release) ?: release.toCatalogGame(),
                actionState = if (installedGame == null) {
                    CatalogActionState.AVAILABLE
                } else {
                    CatalogActionState.INSTALLED
                },
            )
        }
        val retainedInstalled = installed.filter { game ->
            game.releaseKey() !in remoteKeys && game.matches(query)
        }.map { game -> CatalogItem(game, CatalogActionState.INSTALLED) }
        return remoteItems + retainedInstalled
    }

    private fun CatalogGame.matches(query: String): Boolean =
        query.isBlank() || title.contains(query, ignoreCase = true) ||
            tagline.contains(query, ignoreCase = true)

    private fun CatalogGame.releaseKey(): ReleaseKey = ReleaseKey(packageId, version, contentDigest)

    private fun GameRelease.releaseKey(): ReleaseKey = ReleaseKey(packageId, version, contentDigest)

    private data class ReleaseKey(
        val packageId: String,
        val version: String,
        val contentDigest: String,
    )
}
