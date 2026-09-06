package dev.yougotserved.thorium

import android.app.Activity
import androidx.activity.ComponentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import java.util.concurrent.Executors
import java.util.concurrent.ForkJoinPool

private const val APP_UPDATE_RETRY_MS = 120000L

internal data class AndroidAppUpdateBinding(val controller: AppUpdateController, val close: () -> Unit)

internal fun createAndroidAppUpdater(
    activity: ComponentActivity,
    changed: (AppUpdateState) -> Unit,
    http: AppUpdateHttpPort = createAppUpdateHttp(),
): AndroidAppUpdateBinding {
    val worker = Executors.newSingleThreadExecutor()
    val ports = AppUpdatePorts(
        discover = { checkAndroidAppUpdate(activity, http) },
        prepare = { prepareAndroidAppUpdate(activity, http, it) },
        discard = { discardAndroidAppUpdate(activity, it) },
        installer = createAndroidAppUpdateInstaller(activity),
    )
    val execution = AppUpdateExecution(
        background = { work ->
            val future = worker.submit(work)
            val cancel: () -> Unit = { future.cancel(true) }
            cancel
        },
        foreground = { activity.runOnUiThread(it) },
        cleanup = { ForkJoinPool.commonPool().execute(it) },
    )
    val controller = AppUpdateController(ports, execution, changed)
    val observer = appUpdateLifecycle(controller)
    val stopOutcomes = observeAppUpdateOutcomes(activity, controller)
    activity.lifecycle.addObserver(observer)
    return AndroidAppUpdateBinding(controller) {
        activity.lifecycle.removeObserver(observer)
        stopOutcomes()
        controller.close()
        worker.shutdown()
    }
}

private fun appUpdateLifecycle(controller: AppUpdateController): LifecycleEventObserver =
    LifecycleEventObserver { _, event ->
        when (event) {
            Lifecycle.Event.ON_RESUME -> { controller.resume(); controller.check() }
            Lifecycle.Event.ON_STOP -> controller.pause()
            else -> Unit
        }
    }

private fun checkAndroidAppUpdate(activity: Activity, http: AppUpdateHttpPort): AppUpdateCandidate? {
    val preferences = appUpdatePreferences(activity)
    val now = System.currentTimeMillis()
    val lastFailure = preferences.getLong("last-failure", 0L)
    val retryPending = now >= lastFailure && now - lastFailure < APP_UPDATE_RETRY_MS
    if (retryPending || !appUpdateCheckDue(now, preferences.getLong("last-check", 0L))) return null
    val result = runCatching { discoverAppUpdate(androidAppUpdateInstalled(activity), http) }
    result.onFailure { preferences.edit().putLong("last-failure", now).apply() }
    val candidate = result.getOrThrow()
    preferences.edit().putLong("last-check", now).apply()
    return candidate
}
