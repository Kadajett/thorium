package dev.yougotserved.thorium

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
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
import kotlinx.coroutines.flow.MutableSharedFlow

class MainActivity : ComponentActivity() {
    private val worker = Executors.newFixedThreadPool(2)
    private val destroyed = AtomicBoolean(false)
    private val requestSequence = AtomicInteger()
    private lateinit var packageStore: GamePackageStore
    private lateinit var catalogClient: RemoteCatalogClient
    private lateinit var packageDownloader: PackageDownloader
    private lateinit var gameSessionLauncher: GameSessionLauncher
    private val catalogControllerCommands = MutableSharedFlow<CatalogControllerCommand>(
        extraBufferCapacity = 16,
    )
    private var catalogItems by mutableStateOf(emptyList<CatalogItem>())
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
                    onBack = onBackPressedDispatcher::onBackPressed,
                    controllerCommands = catalogControllerCommands,
                )
            }
        }
        loadCatalog("")
    }

    @SuppressLint("RestrictedApi")
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (!CatalogAndroidKeyPolicy.recognizes(event.keyCode)) {
            return super.dispatchKeyEvent(event)
        }
        CatalogAndroidKeyPolicy.command(event.keyCode, event.action, event.repeatCount)?.let {
            catalogControllerCommands.tryEmit(it)
        }
        return true
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
                CatalogItemPolicy.merge(remote.items, packageStore.installedGames(), query)
            }.onSuccess { items ->
                updateUi(request) {
                    catalogItems = items
                    catalogLoading = false
                }
            }.onFailure { error ->
                val offlineItems = runCatching {
                    CatalogItemPolicy.merge(emptyList(), packageStore.installedGames(), query)
                }.getOrElse { emptyList() }
                updateUi(request) {
                    catalogItems = offlineItems
                    catalogLoading = false
                    catalogError = "Remote catalog unavailable. Only previously installed games " +
                        "are available offline. " +
                        (error.message ?: "")
                }
            }
        }
    }

    private fun handleAction(item: CatalogItem) {
        when (item.actionState) {
            CatalogActionState.INSTALLED -> play(item)
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
