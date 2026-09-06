package dev.yougotserved.thorium

import android.content.SharedPreferences
import androidx.activity.ComponentActivity
import androidx.lifecycle.Lifecycle

internal fun observeAppUpdateOutcomes(activity: ComponentActivity, controller: AppUpdateController): () -> Unit {
    val preferences = appUpdatePreferences(activity)
    val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == APP_UPDATE_OUTCOME_KEY && activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            controller.resume()
        }
    }
    preferences.registerOnSharedPreferenceChangeListener(listener)
    return { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
}
