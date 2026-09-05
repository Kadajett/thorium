package dev.yougotserved.thorium

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Build
import android.util.Log
import android.view.View
import android.view.KeyEvent
import android.view.WindowInsets
import android.view.WindowInsetsController

abstract class GameSurfaceActivity : Activity() {
    protected abstract val surfaceRole: SurfaceRole
    protected var gameLaunch: GameLaunch? = null
        private set
    private var surface: WebSurface? = null
    private val surfaceLifecycle = GameSurfaceLifecycle(
        resumeSurface = { surface?.onResume() },
        pauseSurface = { surface?.onPause() },
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        install(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        surface?.destroy()
        surface = null
        gameLaunch = null
        install(intent)
    }

    override fun onStart() {
        super.onStart()
        surfaceLifecycle.onStart()
    }

    override fun onResume() {
        super.onResume()
        surfaceLifecycle.onResume()
    }

    override fun onPause() {
        surfaceLifecycle.onPause()
        super.onPause()
    }

    override fun onStop() {
        surfaceLifecycle.onStop()
        super.onStop()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveMode()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val launch = gameLaunch
        if (launch != null) {
            val input = AndroidControllerInput.translate(
                keyCode = event.keyCode,
                action = event.action,
                repeatCount = event.repeatCount,
            )
            if (
                input != null && LocalSessionCoordinator.handleSouthButton(
                    launch = launch,
                    focusedSurface = surfaceRole,
                    input = input,
                )
            ) return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onDestroy() {
        surface?.destroy()
        surface = null
        gameLaunch = null
        super.onDestroy()
    }

    protected open fun isLaunchPlacementValid(intent: Intent): Boolean = true

    private fun install(intent: Intent) {
        val launch = GameLaunch.from(intent)
        if (launch == null || !isLaunchPlacementValid(intent)) {
            finish()
            return
        }
        val created = runCatching { WebSurface.create(this, launch, surfaceRole) }
            .onFailure { error -> Log.e("ThoriumWeb", "Unable to create game surface", error) }
            .getOrNull()
        if (created == null) {
            finish()
            return
        }
        gameLaunch = launch
        surface = created
        setContentView(created.view)
        surfaceLifecycle.onSurfaceReplaced()
        enterImmersiveMode()
    }

    @Suppress("DEPRECATION")
    private fun enterImmersiveMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.apply {
                hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        }
    }
}
