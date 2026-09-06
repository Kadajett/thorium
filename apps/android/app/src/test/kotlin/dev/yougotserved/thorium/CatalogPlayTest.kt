package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogPlayTest {
    @Test
    fun playInstallsAndStartsTheCurrentReleaseWithoutASecondPress() {
        val release = TestPackages.valid().release
        val game = release.toCatalogGame()
        val events = mutableListOf<String>()
        val packages = CatalogPackagePort(
            cached = { null }, verify = { events.add("verify"); true },
            install = { events.add("install"); it.toCatalogGame() },
        )
        val ports = catalogPlayFixture(packages).copy(launch = { prepared, _ ->
            events.add("launch")
            offlineTestLauncher().start(prepared, false)
        })
        val result = playCatalogGame(game, NetworkStatus.ONLINE, ports) as CatalogPlayResult.Ready
        assertEquals(listOf("install", "verify", "launch"), events)
        assertEquals(release.contentDigest, result.launch.contentDigest)
        assertFalse(result.offline)
    }

    @Test
    fun unchangedVerifiedReleaseStartsWithoutDownloading() {
        val game = TestPackages.valid().release.toCatalogGame()
        val ports = catalogPlayFixture(cachedCatalogPackage(game))
        val result = playCatalogGame(game, NetworkStatus.ONLINE, ports)
        assertTrue(result is CatalogPlayResult.Ready)
    }

    @Test
    fun failedUpdateNeverStartsAnOldGameAndRetainsTheRequiredTarget() {
        val current = TestPackages.valid().release.toCatalogGame()
        val old = current.copy(version = "0.0.1", contentDigest = "a".repeat(64))
        val packages = cachedCatalogPackage(old).copy(
            cached = { null }, install = { error("Update download failed") },
        )
        val ports = catalogPlayFixture(packages).copy(launch = { _, _ -> error("Must not launch") })
        val result = playCatalogGame(old, NetworkStatus.ONLINE, ports) as CatalogPlayResult.Failed
        assertEquals(current, result.game)
        assertEquals("Update download failed", result.message)
    }

    @Test
    fun wrongCachedReleaseCannotLaunchEvenIfAnAdapterClaimsItIsVerified() {
        val current = TestPackages.valid().release.toCatalogGame()
        val old = current.copy(version = "0.0.1")
        val packages = cachedCatalogPackage(old).copy(verify = { true })
        val ports = catalogPlayFixture(packages).copy(launch = { _, _ -> error("Must not launch") })
        assertTrue(playCatalogGame(current, NetworkStatus.ONLINE, ports) is CatalogPlayResult.Failed)
    }

    @Test
    fun corruptedCacheIsRepairedBeforeLaunch() {
        val game = TestPackages.valid().release.toCatalogGame()
        val events = mutableListOf<String>()
        val packages = cachedCatalogPackage(game).copy(
            verify = { events.isNotEmpty() }, install = { events.add("repair"); game },
        )
        val result = playCatalogGame(game, NetworkStatus.ONLINE, catalogPlayFixture(packages))
        assertTrue(result is CatalogPlayResult.Ready)
        assertEquals(listOf("repair"), events)
    }
}
