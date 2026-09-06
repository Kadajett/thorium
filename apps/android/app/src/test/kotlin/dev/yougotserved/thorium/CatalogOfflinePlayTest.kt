package dev.yougotserved.thorium

import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogOfflinePlayTest {
    @Test
    fun cachedOptionalOnlineGamesPlayOfflineWithoutAuthOrCatalogCalls() {
        val game = TestPackages.installedGame().copy(
            multiplayerOnline = true, capabilities = setOf("colyseus-session"),
        )
        val ports = catalogPlayFixture(cachedCatalogPackage(game)).copy(
            currentRelease = { error("Offline play must not fetch the catalog") },
        )
        val result = playCatalogGame(game, NetworkStatus.OFFLINE, ports) as CatalogPlayResult.Ready
        assertTrue(result.offline)
        assertTrue(result.launch.surfaceCapabilities.isEmpty())
        assertFalse("colyseus-session" in result.launch.capabilities)
    }

    @Test
    fun onlineRequiredGamesRemainVisibleButCannotLaunchOffline() {
        val game = TestPackages.installedGame().copy(multiplayerRequiresOnline = true)
        val ports = catalogPlayFixture(cachedCatalogPackage(game))
        val result = playCatalogGame(game, NetworkStatus.OFFLINE, ports) as CatalogPlayResult.Failed
        assertTrue(result.message.contains("requires an internet connection"))
    }

    @Test
    fun anUncachedGameExplainsWhyItsFirstPlayNeedsTheInternet() {
        val game = TestPackages.installedGame()
        val packages = cachedCatalogPackage(game).copy(verify = { false })
        val result = playCatalogGame(game, NetworkStatus.OFFLINE, catalogPlayFixture(packages))
            as CatalogPlayResult.Failed
        assertTrue(result.message.contains("prepare this game for offline play"))
    }

    @Test
    fun aNetworkFailureDuringPreflightAllowsOnlyVerifiedOfflinePlay() {
        val game = TestPackages.installedGame()
        val ports = catalogPlayFixture(cachedCatalogPackage(game)).copy(
            currentRelease = { throw IOException("Network went away") },
        )
        val result = playCatalogGame(game, NetworkStatus.ONLINE, ports) as CatalogPlayResult.Ready
        assertTrue(result.offline)
    }

    @Test
    fun anInvalidDescriptorNeverFallsBackToAnOldRelease() {
        val game = TestPackages.installedGame()
        val ports = catalogPlayFixture(cachedCatalogPackage(game)).copy(
            currentRelease = { throw CatalogParseException("Invalid descriptor hash") },
        )
        val result = playCatalogGame(game, NetworkStatus.ONLINE, ports) as CatalogPlayResult.Failed
        assertEquals("Invalid descriptor hash", result.message)
    }

    @Test
    fun unvalidatedWifiDoesNotClaimOnlineReadiness() {
        assertEquals(NetworkStatus.LIMITED, networkStatus(true, false))
        assertEquals(NetworkStatus.LIMITED, networkStatus(false, true))
        assertEquals(NetworkStatus.ONLINE, networkStatus(true, true))
        val game = TestPackages.installedGame()
        assertEquals("Online required", catalogNetworkLabel(game.copy(multiplayerRequiresOnline = true)))
        assertEquals("Offline + online", catalogNetworkLabel(game.copy(multiplayerOnline = true)))
        assertEquals("Offline play", catalogNetworkLabel(game.copy(multiplayerOnline = false)))
    }

    @Test
    fun launcherEnforcesOnlineRequirementEvenOutsideTheCatalog() {
        val game = TestPackages.installedGame().copy(multiplayerRequiresOnline = true)
        val result = offlineTestLauncher().start(game, onlineAllowed = false) as GameSessionStartResult.Failed
        assertEquals(GameSessionStartFailure.NETWORK_REQUIRED, result.reason)
    }
}
