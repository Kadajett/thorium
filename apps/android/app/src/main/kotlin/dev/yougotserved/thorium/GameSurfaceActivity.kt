package dev.yougotserved.thorium

import android.app.Activity
import android.content.Intent
import android.hardware.input.InputManager
import android.os.Bundle
import android.os.Build
import android.util.Log
import android.view.View
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.WindowInsets
import android.view.WindowInsetsController

abstract class GameSurfaceActivity : Activity(), InputManager.InputDeviceListener {
    protected abstract val surfaceRole: SurfaceRole
    protected var gameLaunch: GameLaunch? = null
        private set
    private var surface: WebSurface? = null
    private val surfaceLifecycle = GameSurfaceLifecycle(
        resumeSurface = { surface?.onResume() },
        pauseSurface = { surface?.onPause() },
    )
    private var lastMotionTraceAtMillis = 0L
    private var assignmentDialog: ControllerAssignmentDialog? = null
    private var started = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        trace("create")
        install(intent)
        getSystemService(InputManager::class.java).registerInputDeviceListener(this, null)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        trace("new-intent")
        setIntent(intent)
        assignmentDialog?.dismiss()
        gameLaunch?.let { LocalSessionCoordinator.setSurfaceVisible(it, surfaceRole, false) }
        surface?.destroy()
        surface = null
        gameLaunch = null
        install(intent)
    }

    override fun onStart() {
        super.onStart()
        trace("start")
        started = true
        gameLaunch?.let { LocalSessionCoordinator.setSurfaceVisible(it, surfaceRole, true) }
        surfaceLifecycle.onStart()
    }

    override fun onResume() {
        super.onResume()
        trace("resume")
        surfaceLifecycle.onResume()
    }

    override fun onPause() {
        trace("pause")
        surfaceLifecycle.onPause()
        super.onPause()
    }

    override fun onStop() {
        trace("stop")
        started = false
        assignmentDialog?.dismiss()
        gameLaunch?.let { LocalSessionCoordinator.setSurfaceVisible(it, surfaceRole, false) }
        surfaceLifecycle.onStop()
        super.onStop()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        trace("focus=$hasFocus")
        if (hasFocus) enterImmersiveMode()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (CatalogAndroidKeyPolicy.recognizes(event.keyCode)) {
            AndroidHostTrace.key(this, surfaceRole.name.lowercase(), event)
        }
        val launch = gameLaunch
        if (launch != null) {
            if (launch.controllerBindings != null) {
                val native = AndroidGameControllerInput.key(event.deviceId, event.keyCode, event.action)
                if (native != null) {
                    handleNativeInput(launch, native)
                    return true
                }
            }
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

    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
        if (!GamepadMotionPolicy.recognizes(event.source, event.action)) {
            return super.dispatchGenericMotionEvent(event)
        }
        if (event.eventTime - lastMotionTraceAtMillis >= 1000) {
            AndroidHostTrace.motion(this, surfaceRole.name.lowercase(), event)
            lastMotionTraceAtMillis = event.eventTime
        }
        gameLaunch?.takeIf { it.controllerBindings != null }?.let { launch ->
            AndroidGameControllerInput.motion(event)?.let { handleNativeInput(launch, it) }
        }
        // Even unbound controller motion must not reach WebView's spatial-focus fallback.
        return true
    }

    private fun handleNativeInput(launch: GameLaunch, input: ControllerDeviceInput) {
        if (LocalSessionCoordinator.needsControllerAssignment(launch, input.deviceId)) {
            val intentional = input.buttons.values.any { it } || input.axes.values.any { it.isFinite() && kotlin.math.abs(it) >= 0.6 }
            if (intentional && assignmentDialog == null) {
                // Dialog focus can divert key-up events from either Activity. Release state first.
                LocalSessionCoordinator.releaseControllerInputs(launch)
                assignmentDialog = ControllerAssignmentDialog(this, input.deviceId, launch.localPlayerSlots.sorted()) { slot ->
                    LocalSessionCoordinator.assignController(launch, input.deviceId, slot)
                }.also { dialog ->
                    dialog.setOnDismissListener { assignmentDialog = null }
                    dialog.show()
                }
            }
            return
        }
        LocalSessionCoordinator.handleController(launch, surfaceRole, input)
    }

    override fun onInputDeviceAdded(deviceId: Int) = Unit
    override fun onInputDeviceChanged(deviceId: Int) {
        gameLaunch?.let { LocalSessionCoordinator.disconnectController(it, deviceId) }
    }
    override fun onInputDeviceRemoved(deviceId: Int) {
        assignmentDialog?.dismiss()
        gameLaunch?.let { LocalSessionCoordinator.disconnectController(it, deviceId) }
    }

    override fun onDestroy() {
        trace("destroy finishing=$isFinishing")
        assignmentDialog?.dismiss()
        getSystemService(InputManager::class.java).unregisterInputDeviceListener(this)
        gameLaunch?.let {
            LocalSessionCoordinator.onSurfaceDestroyed(it, surfaceRole, isFinishing)
        }
        surface?.destroy()
        surface = null
        gameLaunch = null
        super.onDestroy()
    }

    protected open fun isLaunchPlacementValid(intent: Intent): Boolean = true

    private fun trace(event: String) =
        AndroidHostTrace.lifecycle(this, surfaceRole.name.lowercase(), event)

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
        if (started) LocalSessionCoordinator.setSurfaceVisible(launch, surfaceRole, true)
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
