package dev.yougotserved.thorium

internal data class CatalogPackagePort(
    val cached: (GameRelease) -> CatalogGame?,
    val verify: (CatalogGame) -> Boolean,
    val install: (GameRelease) -> CatalogGame,
)

internal data class CatalogPlayPorts(
    val currentRelease: (String) -> GameRelease,
    val packages: CatalogPackagePort,
    val launch: (CatalogGame, Boolean) -> GameSessionStartResult,
)

internal sealed interface CatalogPlayResult {
    val game: CatalogGame

    data class Ready(
        override val game: CatalogGame,
        val launch: GameLaunch,
        val offline: Boolean,
    ) : CatalogPlayResult

    data class Failed(override val game: CatalogGame, val message: String) : CatalogPlayResult
}
