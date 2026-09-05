package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class CatalogItemPolicyTest {
    @Test
    fun cleanOfflineCatalogContainsNoGames() {
        assertEquals(emptyList<CatalogItem>(), CatalogItemPolicy.merge(emptyList(), emptyList(), ""))
    }

    @Test
    fun offlineCatalogContainsOnlyMatchingPreviouslyInstalledGames() {
        val installed = TestPackages.installedGame()

        val matching = CatalogItemPolicy.merge(emptyList(), listOf(installed), "test")
        val missing = CatalogItemPolicy.merge(emptyList(), listOf(installed), "other")

        assertEquals(1, matching.size)
        assertEquals(CatalogActionState.INSTALLED, matching.single().actionState)
        assertEquals(installed, matching.single().game)
        assertEquals(emptyList<CatalogItem>(), missing)
    }

    @Test
    fun remoteReleaseRequiresInstallBeforeItCanBePlayed() {
        val release = TestPackages.valid().release

        val available = CatalogItemPolicy.merge(listOf(release), emptyList(), "").single()
        val installed = CatalogItemPolicy.merge(
            listOf(release),
            listOf(release.toCatalogGame().copy(release = null)),
            "",
        ).single()

        assertEquals(CatalogActionState.AVAILABLE, available.actionState)
        assertNotNull(available.game.release)
        assertEquals(CatalogActionState.INSTALLED, installed.actionState)
        assertNotNull(installed.game.release)
    }

    @Test
    fun staleInstalledReleaseDoesNotSatisfyRemoteExactRelease() {
        val release = TestPackages.valid().release
        val stale = release.toCatalogGame().copy(
            contentDigest = "b".repeat(64),
            release = null,
        )

        val items = CatalogItemPolicy.merge(listOf(release), listOf(stale), "")

        assertEquals(CatalogActionState.AVAILABLE, items.first().actionState)
        assertNotNull(items.first().game.release)
        assertEquals(CatalogActionState.INSTALLED, items.last().actionState)
        assertNull(items.last().game.release)
    }
}
