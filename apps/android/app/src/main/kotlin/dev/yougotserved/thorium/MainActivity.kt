package dev.yougotserved.thorium

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class MainActivity : ComponentActivity() {
    private val worker = Executors.newFixedThreadPool(2)
    private val destroyed = AtomicBoolean(false)
    private val requestSequence = AtomicInteger()
    private lateinit var packageStore: GamePackageStore
    private lateinit var catalogClient: RemoteCatalogClient
    private lateinit var packageDownloader: PackageDownloader
    private lateinit var gameSessionLauncher: GameSessionLauncher
    private var catalogItems by mutableStateOf(fallbackItems())
    private var catalogLoading by mutableStateOf(true)
    private var catalogError by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        packageStore = GamePackageStore(applicationContext)
        catalogClient = RemoteCatalogClient(BuildConfig.CATALOG_BASE_URL)
        packageDownloader = PackageDownloader(cacheDir.toPath().resolve("game-downloads"))
        gameSessionLauncher = GameSessionLauncher.create(BuildConfig.CATALOG_BASE_URL, packageStore)
        setContent {
            ThoriumTheme {
                CatalogScreen(
                    items = catalogItems,
                    loading = catalogLoading,
                    error = catalogError,
                    onSearch = ::loadCatalog,
                    onAction = ::handleAction,
                )
            }
        }
        loadCatalog("")
    }

    override fun onDestroy() {
        destroyed.set(true)
        worker.shutdownNow()
        super.onDestroy()
    }

    private fun loadCatalog(query: String) {
        val request = requestSequence.incrementAndGet()
        catalogLoading = true
        catalogError = null
        worker.execute {
            runCatching {
                val remote = catalogClient.search(query)
                val installedItems = packageStore.installedGames().map { game ->
                    CatalogItem(game, CatalogActionState.INSTALLED)
                }
                val remoteItems = remote.items.map { release ->
                    val installedGame = packageStore.installedGame(release)
                    CatalogItem(
                        game = installedGame ?: release.toCatalogGame(),
                        actionState = if (installedGame != null) {
                            CatalogActionState.INSTALLED
                        } else {
                            CatalogActionState.AVAILABLE
                        },
                    )
                }
                mergeLocal(remoteItems, installedItems, query)
            }.onSuccess { items ->
                updateUi(request) {
                    catalogItems = items
                    catalogLoading = false
                }
            }.onFailure { error ->
                val offlineItems = runCatching {
                    val installed = packageStore.installedGames().map { game ->
                        CatalogItem(game, CatalogActionState.INSTALLED)
                    }
                    mergeLocal(emptyList(), installed, query)
                }.getOrElse { fallbackItems(query) }
                updateUi(request) {
                    catalogItems = offlineItems
                    catalogLoading = false
                    catalogError = "Remote catalog unavailable. Bundled games are still ready. " +
                        (error.message ?: "")
                }
            }
        }
    }

    private fun handleAction(item: CatalogItem) {
        when (item.actionState) {
            CatalogActionState.BUNDLED, CatalogActionState.INSTALLED -> play(item)
            CatalogActionState.AVAILABLE, CatalogActionState.INSTALL_ERROR -> install(item)
            CatalogActionState.INSTALLING -> Unit
        }
    }

    private fun install(item: CatalogItem) {
        val release = item.game.release ?: return
        replaceItem(item, item.copy(actionState = CatalogActionState.INSTALLING, error = null))
        worker.execute {
            var archive: Path? = null
            runCatching {
                archive = packageDownloader.download(release)
                packageStore.install(requireNotNull(archive), release)
            }.onSuccess { installedGame ->
                updateUi {
                    replaceItem(
                        item,
                        item.copy(
                            game = installedGame,
                            actionState = CatalogActionState.INSTALLED,
                            error = null,
                        ),
                    )
                    catalogError = null
                }
            }.onFailure { error ->
                updateUi {
                    replaceItem(
                        item,
                        item.copy(
                            actionState = CatalogActionState.INSTALL_ERROR,
                            error = error.message,
                        ),
                    )
                    catalogError = "Install failed: ${error.message ?: "verification error"}"
                }
            }.also {
                archive?.let { downloaded -> runCatching { Files.deleteIfExists(downloaded) } }
            }
        }
    }

    private fun play(item: CatalogItem) {
        val game = item.game
        catalogError = null
        worker.execute {
            when (val result = gameSessionLauncher.start(game)) {
                is GameSessionStartResult.Ready -> updateUi {
                    startActivity(
                        result.launch.putInto(Intent(this, MainGameActivity::class.java)),
                    )
                }
                is GameSessionStartResult.Failed -> updateUi {
                    val message = when (result.reason) {
                        GameSessionStartFailure.RELEASE_INTEGRITY ->
                            "This installed release failed its integrity check. Reinstall it."
                        GameSessionStartFailure.LOCAL_PLAYER_POLICY ->
                            "This game needs more players than one Account Session can provide."
                        GameSessionStartFailure.AUTHORITY_REJECTED ->
                            "The game session request was rejected."
                        GameSessionStartFailure.AUTHORITY_RESPONSE_MISMATCH ->
                            "The game session response did not match this installed release."
                    }
                    if (
                        result.reason == GameSessionStartFailure.RELEASE_INTEGRITY &&
                        game.release != null
                    ) {
                        replaceItem(
                            item,
                            item.copy(actionState = CatalogActionState.INSTALL_ERROR, error = message),
                        )
                    }
                    catalogError = message
                }
            }
        }
    }

    private fun mergeLocal(
        remote: List<CatalogItem>,
        installed: List<CatalogItem>,
        query: String,
    ): List<CatalogItem> {
        val remoteKeys = remote.map { it.game.packageId to it.game.contentDigest }.toSet()
        val retainedInstalled = installed.filter { item ->
            (item.game.packageId to item.game.contentDigest) !in remoteKeys &&
                (query.isBlank() || item.game.title.contains(query, ignoreCase = true) ||
                    item.game.tagline.contains(query, ignoreCase = true))
        }
        val remotePackages = remote.map { it.game.packageId }.toSet()
        val installedPackages = retainedInstalled.map { it.game.packageId }.toSet()
        val bundled = fallbackItems(query).filter { item ->
            item.game.packageId !in remotePackages && item.game.packageId !in installedPackages
        }
        return remote + retainedInstalled + bundled
    }

    private fun fallbackItems(query: String = ""): List<CatalogItem> = DemoCatalog.games
        .filter { game ->
            query.isBlank() || game.title.contains(query, ignoreCase = true) ||
                game.tagline.contains(query, ignoreCase = true)
        }
        .map { game -> CatalogItem(game, CatalogActionState.BUNDLED) }

    private fun replaceItem(previous: CatalogItem, replacement: CatalogItem) {
        catalogItems = catalogItems.map { current ->
            if (
                current.game.packageId == previous.game.packageId &&
                current.game.version == previous.game.version &&
                current.game.contentDigest == previous.game.contentDigest
            ) {
                replacement
            } else {
                current
            }
        }
    }

    private fun updateUi(request: Int? = null, update: () -> Unit) {
        runOnUiThread {
            if (!destroyed.get() && (request == null || request == requestSequence.get())) update()
        }
    }
}
