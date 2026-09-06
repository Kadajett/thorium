package dev.yougotserved.thorium

import java.nio.file.Files

internal fun catalogPackagePort(store: GamePackageStore, downloader: PackageDownloader): CatalogPackagePort =
    CatalogPackagePort(store::installedGame, store::verifyForLaunch) { release ->
        val archive = downloader.download(release)
        try {
            store.install(archive, release)
        } finally {
            runCatching { Files.deleteIfExists(archive) }
        }
    }
