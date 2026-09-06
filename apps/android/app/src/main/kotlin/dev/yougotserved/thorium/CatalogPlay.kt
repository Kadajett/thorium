package dev.yougotserved.thorium

import java.io.IOException

/** Effect orchestration: current immutable release -> verified cache -> session. */
internal fun playCatalogGame(
    selected: CatalogGame,
    network: NetworkStatus,
    ports: CatalogPlayPorts,
): CatalogPlayResult {
    if (network == NetworkStatus.OFFLINE || network == NetworkStatus.LIMITED) {
        return playCachedOffline(selected, ports)
    }
    return runCatching {
        ports.currentRelease(selected.packageId).also {
            require(it.packageId == selected.packageId) { "Catalog returned a different game" }
        }
    }.fold(
        onSuccess = { prepareCurrentRelease(it, ports) },
        onFailure = { error ->
            if (error is IOException) playCachedOffline(selected, ports)
            else CatalogPlayResult.Failed(selected, error.message ?: "Could not check the current release")
        },
    )
}

private fun prepareCurrentRelease(release: GameRelease, ports: CatalogPlayPorts): CatalogPlayResult {
    val target = release.toCatalogGame()
    return runCatching {
        val game = ports.packages.cached(release)?.takeIf(ports.packages.verify)
            ?: ports.packages.install(release)
        require(sameCatalogRelease(game, target)) { "Prepared package did not match the current release" }
        require(ports.packages.verify(game)) { "Game files failed verification" }
        finishCatalogPlay(game, ports.launch(game, true), offline = false)
    }.getOrElse { error ->
        CatalogPlayResult.Failed(target, error.message ?: "Could not prepare the current release")
    }
}

private fun playCachedOffline(game: CatalogGame, ports: CatalogPlayPorts): CatalogPlayResult = runCatching {
    require(!game.multiplayerRequiresOnline) { "This game requires an internet connection" }
    require(ports.packages.verify(game)) { "Connect to the internet to prepare this game for offline play" }
    finishCatalogPlay(game, ports.launch(game, false), offline = true)
}.getOrElse { error -> CatalogPlayResult.Failed(game, error.message ?: "Could not start offline play") }

private fun finishCatalogPlay(
    game: CatalogGame,
    result: GameSessionStartResult,
    offline: Boolean,
): CatalogPlayResult = when (result) {
    is GameSessionStartResult.Ready -> CatalogPlayResult.Ready(game, result.launch, offline)
    is GameSessionStartResult.Failed -> CatalogPlayResult.Failed(game, gameSessionFailureMessage(result.reason))
}

internal fun sameCatalogRelease(left: CatalogGame, right: CatalogGame): Boolean =
    left.packageId == right.packageId && left.version == right.version && left.contentDigest == right.contentDigest
