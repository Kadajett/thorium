package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Test

class CatalogVersionSelectionTest {
    @Test
    fun theLibraryShowsOnlyTheNewestInstalledVersionOfEachGame() {
        val original = TestPackages.installedGame()
        val old = original.copy(version = "1.9.0", contentDigest = "a".repeat(64))
        val newest = original.copy(version = "1.10.0", contentDigest = "b".repeat(64))

        val items = CatalogItemPolicy.merge(emptyList(), listOf(old, newest), "")

        assertEquals(listOf(newest), items.map { it.game })
    }

    @Test
    fun remoteVersionsProduceOneCardRegardlessOfServerOrder() {
        val old = release("1.9.0").copy(publishedAt = "2026-09-05T00:00:00.000Z")
        val newest = release("1.10.0").copy(publishedAt = "2026-09-06T00:00:00.000Z")
        val forward = CatalogItemPolicy.merge(listOf(old, newest), emptyList(), "")
        val reverse = CatalogItemPolicy.merge(listOf(newest, old), emptyList(), "")
        assertEquals("1.10.0", forward.single().game.version)
        assertEquals(forward, reverse)
    }

    @Test
    fun anInstalledOldVersionDoesNotHideTheNewDownloadOrCreateAnotherCard() {
        val old = release("1.0.0").toCatalogGame().copy(release = null)
        val newest = release("1.1.0")
        val item = CatalogItemPolicy.merge(listOf(newest), listOf(old), "").single()
        assertEquals("1.1.0", item.game.version)
        assertEquals(CatalogActionState.AVAILABLE, item.actionState)
        assertEquals(newest, item.game.release)
    }

    @Test
    fun theNewestExactInstalledReleaseKeepsItsPlayAction() {
        val old = release("1.0.0")
        val newest = release("1.1.0")
        val installed = newest.toCatalogGame().copy(release = null)
        val item = CatalogItemPolicy.merge(listOf(old, newest), listOf(installed), "").single()
        assertEquals("1.1.0", item.game.version)
        assertEquals(CatalogActionState.INSTALLED, item.actionState)
        assertEquals(newest.contentDigest, item.game.contentDigest)
    }

    @Test
    fun theAuthoritativeCurrentReleaseWinsOverCachedVersionPrecedence() {
        val installed = release("2.0.0").toCatalogGame().copy(release = null)
        val item = CatalogItemPolicy.merge(listOf(release("1.0.0")), listOf(installed), "").single()
        assertEquals("1.0.0", item.game.version)
        assertEquals(CatalogActionState.AVAILABLE, item.actionState)
    }

    @Test
    fun remotePublicationOrderComparesInstantsInsteadOfTimezoneText() {
        val older = release("2.0.0").copy(publishedAt = "2026-09-06T12:00:00+02:00")
        val current = release("1.0.0").copy(publishedAt = "2026-09-06T11:00:00Z")
        val item = CatalogItemPolicy.merge(listOf(older, current), emptyList(), "").single()
        assertEquals(current, item.game.release)
    }

    @Test
    fun gamesWithTheSameTitleStaySeparateAndKeepTheirLibraryPosition() {
        val first = release("1.0.0")
        val second = first.copy(manifest = first.manifest.copy(packageId = "dev.test.other"))
        val update = release("1.1.0")
        val items = CatalogItemPolicy.merge(listOf(first, second, update), emptyList(), "")
        assertEquals(listOf(first.packageId, second.packageId), items.map { it.game.packageId })
        assertEquals(listOf("1.1.0", "1.0.0"), items.map { it.game.version })
    }

    @Test
    fun filteringDoesNotResurrectAnOldInstalledTitle() {
        val old = release("1.0.0").toCatalogGame().copy(title = "Obsolete title", release = null)
        val newest = release("1.1.0").toCatalogGame().copy(title = "Current title", release = null)
        val items = CatalogItemPolicy.merge(emptyList(), listOf(old, newest), "Obsolete")
        assertEquals(emptyList<CatalogItem>(), items)
    }

    private fun release(version: String): GameRelease {
        val original = TestPackages.valid().release
        return original.copy(manifest = original.manifest.copy(version = version))
    }
}
