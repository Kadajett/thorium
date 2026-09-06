package dev.yougotserved.thorium

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
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
    private lateinit var catalogPlayPorts: CatalogPlayPorts
    private var networkMonitor: AutoCloseable? = null
    private var networkStatus by mutableStateOf(NetworkStatus.CHECKING)
    private val preparingGame = AtomicBoolean(false)
    private val catalogControllerCommands = MutableSharedFlow<CatalogControllerCommand>(
        extraBufferCapacity = 16,
    )
    private val catalogStickNavigator = CatalogStickNavigator()
    private var catalogItems by mutableStateOf(emptyList<CatalogItem>())
    private var catalogLoading by mutableStateOf(true)
    private var catalogError by mutableStateOf<String?>(null)
    private var appUpdateState by mutableStateOf(AppUpdateState())
    private var appUpdater: AndroidAppUpdateBinding? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        packageStore = GamePackageStore(applicationContext)
        catalogClient = RemoteCatalogClient(BuildConfig.CATALOG_BASE_URL)
        packageDownloader = PackageDownloader(cacheDir.toPath().resolve("game-downloads"))
        gameSessionLauncher = GameSessionLauncher.create(
            BuildConfig.CATALOG_BASE_URL,
            packageStore,
            applicationContext,
        )
        catalogPlayPorts = CatalogPlayPorts(
            catalogClient::currentRelease,
            catalogPackagePort(packageStore, packageDownloader),
            gameSessionLauncher::start,
        )
        networkMonitor = observeAndroidNetwork(this) {
            networkStatus = it
            appUpdater?.controller?.check()
        }
        appUpdater = createComposedAndroidAppUpdater(this) { appUpdateState = it }
        setContent {
            ThoriumTheme {
                Box {
                    CatalogScreen(
                        content = CatalogScreenContent(catalogItems, catalogLoading, catalogError, networkStatus),
                        actions = CatalogLibraryActions(
                            ::loadCatalog, ::handleAction, onBackPressedDispatcher::onBackPressed,
                        ),
                        controllerCommands = catalogControllerCommands,
                    )
                    AppUpdateOverlay(appUpdateState, AppUpdateActions(
                        { appUpdater?.controller?.confirm() }, { appUpdater?.controller?.dismiss() },
                    ))
                }
            }
        }
        loadCatalog("")
        appUpdater?.controller?.check()
    }

    @SuppressLint("RestrictedApi")
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (!CatalogAndroidKeyPolicy.recognizes(event.keyCode)) {
            return super.dispatchKeyEvent(event)
        }
        CatalogAndroidKeyPolicy.command(event.keyCode, event.action, event.repeatCount)?.let {
            AndroidHostTrace.key(this, "catalog", event)
            dispatchCatalogCommand(it)
        }
        return true
    }

    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
        val axes = AndroidGamepadMotion.read(event) ?: return super.dispatchGenericMotionEvent(event)
        catalogStickNavigator.command(axes.horizontal, axes.vertical, event.eventTime)?.let {
            AndroidHostTrace.motion(this, "catalog", event)
            dispatchCatalogCommand(it)
        }
        return true
    }

    override fun onDestroy() {
        destroyed.set(true)
        appUpdater?.close?.invoke()
        networkMonitor?.close()
        worker.shutdownNow()
        super.onDestroy()
    }

    private val dispatchCatalogCommand: (CatalogControllerCommand) -> Unit = { command ->
        if (appUpdater?.controller?.control(command) != true) catalogControllerCommands.tryEmit(command)
    }

    private fun loadCatalog(query: String) {
        val request = requestSequence.incrementAndGet()
        val offline = networkStatus == NetworkStatus.OFFLINE || networkStatus == NetworkStatus.LIMITED
        catalogLoading = true
        catalogError = null
        worker.execute {
            runCatching {
                val remote = if (offline) emptyList() else catalogClient.search(query).items
                CatalogItemPolicy.merge(remote, packageStore.installedGames(), query)
            }.onSuccess { items ->
                updateUi(request) {
                    catalogItems = items
                    catalogLoading = false
                    catalogError = if (offline) "Offline library. Online-required games need a connection." else null
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
                        error.message.orEmpty()
                }
            }
        }
    }

    private fun handleAction(item: CatalogItem) {
        if (item.actionState == CatalogActionState.INSTALLING || !preparingGame.compareAndSet(false, true)) return
        val network = networkStatus
        replaceItem(item, item.copy(actionState = CatalogActionState.INSTALLING, error = null))
        catalogError = null
        worker.execute {
            val result = playCatalogGame(item.game, network, catalogPlayPorts)
            updateUi {
                preparingGame.set(false)
                applyPlayResult(item, result)
            }
        }
    }

    private fun applyPlayResult(item: CatalogItem, result: CatalogPlayResult) {
        when (result) {
            is CatalogPlayResult.Ready -> {
                replaceItem(item, CatalogItem(result.game, CatalogActionState.INSTALLED))
                catalogError = if (result.offline) "Playing offline. Online modes are unavailable." else null
                startActivity(result.launch.putInto(Intent(this, MainGameActivity::class.java)))
            }
            is CatalogPlayResult.Failed -> {
                replaceItem(item, CatalogItem(result.game, CatalogActionState.INSTALL_ERROR, result.message))
                catalogError = result.message
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
