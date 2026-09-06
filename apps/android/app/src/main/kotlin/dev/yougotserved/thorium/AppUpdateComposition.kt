package dev.yougotserved.thorium

import androidx.activity.ComponentActivity

/** Application-owned composition, never supplied by an Intent, game or network response. */
internal interface AppUpdateComposition {
    fun http(): AppUpdateHttpPort
    fun stateChanged(state: AppUpdateState)
    fun installerResult(sessionId: Int, status: Int)
}

internal fun createComposedAndroidAppUpdater(
    activity: ComponentActivity,
    changed: (AppUpdateState) -> Unit,
): AndroidAppUpdateBinding {
    val composition = activity.application as? AppUpdateComposition
    val http = composition?.http() ?: createAppUpdateHttp()
    return createAndroidAppUpdater(activity, { state ->
        changed(state)
        composition?.stateChanged(state)
    }, http)
}
