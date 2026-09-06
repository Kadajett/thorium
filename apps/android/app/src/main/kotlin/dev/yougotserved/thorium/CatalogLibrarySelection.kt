package dev.yougotserved.thorium

import java.time.Instant

/** Library identity is a Game; the selected card still carries its exact immutable Game Release. */
internal fun selectCatalogGames(items: List<CatalogItem>): List<CatalogItem> =
    items.groupBy { it.game.packageId }.values.map { versions -> versions.reduce(::preferredCatalogItem) }

private fun preferredCatalogItem(current: CatalogItem, candidate: CatalogItem): CatalogItem {
    val currentRelease = current.game.release
    val candidateRelease = candidate.game.release
    return when {
        currentRelease != null && candidateRelease != null ->
            if (comparePublishedReleases(candidateRelease, currentRelease) > 0) candidate else current
        currentRelease != null -> current
        candidateRelease != null -> candidate
        else -> preferredInstalledItem(current, candidate)
    }
}

private fun comparePublishedReleases(left: GameRelease, right: GameRelease): Int {
    val published = Instant.parse(left.publishedAt).compareTo(Instant.parse(right.publishedAt))
    return if (published != 0) published else left.version.compareTo(right.version)
}

private fun preferredInstalledItem(current: CatalogItem, candidate: CatalogItem): CatalogItem {
    val versionOrder = compareCatalogVersions(candidate.game.version, current.game.version)
    return when {
        versionOrder > 0 -> candidate
        versionOrder < 0 -> current
        else -> current
    }
}
