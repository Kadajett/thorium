package dev.yougotserved.thorium

import android.content.Context
import java.nio.file.Files
import java.nio.file.Path

class GamePackageStore(context: Context) {
    private val root = storageRoot(context)
    private val installer = VerifiedGamePackageInstaller(root)

    init {
        Files.createDirectories(root)
    }

    fun isInstalled(release: GameRelease): Boolean = installer.isInstalled(release)

    fun installedGame(release: GameRelease): CatalogGame? =
        installer.installedRecord(release)?.toCatalogGame()?.copy(release = release)

    fun install(archive: Path, release: GameRelease): CatalogGame {
        installer.install(archive, release)
        return installedGame(release)
            ?: throw PackageInstallException("Installed package policy could not be resolved")
    }

    fun installedGames(): List<CatalogGame> = installer.installedRecords().map { it.toCatalogGame() }

    fun verifyForLaunch(game: CatalogGame): Boolean = installer.verifyForLaunch(game)

    companion object {
        fun storageRoot(context: Context): Path = context.filesDir.toPath().resolve("game-packages")
    }
}
