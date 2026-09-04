package dev.yougotserved.thorium

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.ByteArrayInputStream
import org.json.JSONObject

class WebSurface private constructor(
    private val activity: Activity,
    val view: WebView,
    private val launch: GameLaunch,
    private val role: SurfaceRole,
) : LocalSessionCoordinator.Endpoint {
    private var ready = false
    private var resumed = false
    private var destroyed = false
    private val bridgePolicy = HostBridgePolicy.forSurface(launch, role)
    private val pendingMessages = ArrayDeque<String>()

    fun onResume() {
        if (destroyed) return
        resumed = true
        view.onResume()
        if (ready) post(lifecycleMessage("active"))
    }

    fun onPause() {
        if (destroyed) return
        if (ready) post(lifecycleMessage("suspended"))
        resumed = false
        view.onPause()
    }

    fun destroy() {
        teardown(notifyGame = true)
    }

    private fun onRendererGone() {
        teardown(notifyGame = false)
    }

    private fun teardown(notifyGame: Boolean) {
        if (destroyed) return
        destroyed = true
        if (notifyGame && ready) runCatching {
            postToLiveView(lifecycleMessage("stopped"))
        }
        ready = false
        resumed = false
        LocalSessionCoordinator.unregister(launch, role, this)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            runCatching { WebViewCompat.removeWebMessageListener(view, BRIDGE_NAME) }
        }
        (view.parent as? ViewGroup)?.removeView(view)
        runCatching { view.stopLoading() }
        runCatching { view.removeAllViews() }
        runCatching { view.destroy() }
        pendingMessages.clear()
    }

    override fun deliver(message: String) {
        if (destroyed) return
        if (ready) {
            post(message)
        } else if (pendingMessages.size < MAX_PENDING_MESSAGES) {
            pendingMessages.addLast(message)
        }
    }

    override fun terminateGameSession() {
        activity.runOnUiThread {
            if (!activity.isFinishing && !activity.isDestroyed) activity.finish()
        }
    }

    private fun post(message: String) {
        if (destroyed) return
        runCatching { postToLiveView(message) }
    }

    private fun postToLiveView(message: String) {
        view.evaluateJavascript(
            "window.__thoriumReceive?.(${JSONObject.quote(message)});",
            null,
        )
    }

    private fun onGameMessage(message: String) {
        if (destroyed) return
        when (val action = bridgePolicy.parse(message)) {
            is HostAction.BootstrapRequested -> post(
                GameBootstrapMessage.create(launch, role, action.requestId),
            )
            HostAction.Ready -> {
                ready = true
                while (pendingMessages.isNotEmpty()) post(pendingMessages.removeFirst())
                if (resumed) post(lifecycleMessage("active"))
            }
            is HostAction.RouteToPeer -> LocalSessionCoordinator.route(
                launch,
                role,
                action.message,
            )
            null -> Unit
        }
    }

    companion object {
        private const val BRIDGE_NAME = "thoriumHost"
        private const val MAX_PENDING_MESSAGES = 64

        fun create(activity: Activity, launch: GameLaunch, role: SurfaceRole): WebSurface {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                error("The installed WebView does not support the secure Thorium bridge")
            }
            WebProcessContainment.configureBeforeWebView(launch.sessionId)
            val loader = WebViewAssetLoader.Builder()
                .addPathHandler("/games/", WebViewAssetLoader.AssetsPathHandler(activity))
                .addPathHandler(
                    "/installed-games/",
                    WebViewAssetLoader.InternalStoragePathHandler(
                        activity,
                        GamePackageStore.storageRoot(activity).toFile(),
                    ),
                )
                .build()
            val webView = WebView(activity)
            configure(webView)
            lateinit var surface: WebSurface
            surface = WebSurface(activity, webView, launch, role)
            val requestPolicy = GameRequestPolicy.create(launch, role)
            webView.webViewClient = AssetClient(loader, requestPolicy) {
                surface.onRendererGone()
                if (activity.isFinishing || activity.isDestroyed) return@AssetClient
                when (RendererLossPolicy.recovery(launch, role)) {
                    RendererLossRecovery.RECREATE_LOCAL_SURFACE -> activity.recreate()
                    RendererLossRecovery.TERMINATE_ONLINE_SESSION -> {
                        LocalSessionCoordinator.terminate(launch)
                        activity.finish()
                    }
                }
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                WebViewCompat.addWebMessageListener(
                    webView,
                    BRIDGE_NAME,
                    setOf(GameAssetPolicy.ORIGIN),
                ) { view, message, sourceOrigin, isMainFrame, _ ->
                    if (
                        isMainFrame &&
                        sourceOrigin.toString() == GameAssetPolicy.ORIGIN &&
                        GameAssetPolicy.isAllowedPackageUrl(launch, view.url.orEmpty())
                    ) {
                        message.data?.let(surface::onGameMessage)
                    }
                }
            }
            LocalSessionCoordinator.register(launch, role, surface)
            webView.setBackgroundColor(Color.rgb(9, 10, 18))
            webView.loadUrl(GameAssetPolicy.entryUrl(launch, role))
            return surface
        }

        @SuppressLint("SetJavaScriptEnabled")
        @Suppress("DEPRECATION")
        private fun configure(webView: WebView) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
            webView.settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = false
                allowFileAccess = false
                allowContentAccess = false
                allowFileAccessFromFileURLs = false
                allowUniversalAccessFromFileURLs = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(false)
                mediaPlaybackRequiresUserGesture = true
                cacheMode = WebSettings.LOAD_NO_CACHE
            }
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        }

        private fun lifecycleMessage(state: String): String =
            JSONObject().put("kind", "lifecycle").put("state", state).toString()
    }

    @SuppressLint("MissingOnRenderProcessGone")
    private class AssetClient(
        private val loader: WebViewAssetLoader,
        private val policy: GameRequestPolicy,
        private val recover: () -> Unit,
    ) : WebViewClientCompat() {
        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest,
        ): WebResourceResponse? {
            return when (policy.decide(request.url.toString())) {
                GameRequestDecision.PACKAGE_ASSET ->
                    loader.shouldInterceptRequest(request.url)
                        ?.withHostSecurityHeaders(policy)
                        ?: forbiddenResponse()
                GameRequestDecision.PLATFORM_NETWORK -> null
                GameRequestDecision.BLOCKED -> forbiddenResponse()
            }
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            policy.decide(request.url.toString()) != GameRequestDecision.PACKAGE_ASSET

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            recover()
            return true
        }
    }
}

private object WebProcessContainment {
    @Volatile
    private var configured = false
    private var storageClearedForSession: String? = null

    fun configureBeforeWebView(sessionId: String) {
        synchronized(this) {
            if (storageClearedForSession != sessionId) {
                WebStorage.getInstance().deleteAllData()
                storageClearedForSession = sessionId
            }
            if (!configured) {
                val cookies = CookieManager.getInstance()
                cookies.setAcceptCookie(false)
                cookies.removeAllCookies(null)
                configureServiceWorkers()
                configured = true
            }
        }
    }

    private fun configureServiceWorkers() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) return
        val controller = ServiceWorkerControllerCompat.getInstance()
        val settings = controller.serviceWorkerWebSettings
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BLOCK_NETWORK_LOADS)) {
            settings.blockNetworkLoads = true
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_FILE_ACCESS)) {
            settings.allowFileAccess = false
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_CONTENT_ACCESS)) {
            settings.allowContentAccess = false
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_CACHE_MODE)) {
            settings.cacheMode = WebSettings.LOAD_NO_CACHE
        }
        if (
            WebViewFeature.isFeatureSupported(
                WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST,
            )
        ) {
            controller.setServiceWorkerClient(
                object : ServiceWorkerClientCompat() {
                    override fun shouldInterceptRequest(
                        request: WebResourceRequest,
                    ): WebResourceResponse = forbiddenResponse()
                },
            )
        }
    }
}

private fun forbiddenResponse(): WebResourceResponse = WebResourceResponse(
    "text/plain",
    Charsets.UTF_8.name(),
    ByteArrayInputStream("Forbidden".toByteArray()),
)

private fun WebResourceResponse.withHostSecurityHeaders(
    policy: GameRequestPolicy,
): WebResourceResponse = apply {
    responseHeaders = responseHeaders.orEmpty() + mapOf(
        "Content-Security-Policy" to policy.contentSecurityPolicy,
        "X-Content-Type-Options" to "nosniff",
    )
}
