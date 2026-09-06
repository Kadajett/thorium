package dev.yougotserved.thorium

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageInstaller
import androidx.core.content.IntentCompat

internal fun appUpdatePreferences(context: Context): SharedPreferences =
    context.getSharedPreferences("app-updates", Context.MODE_PRIVATE)

class AndroidAppUpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val preferences = appUpdatePreferences(context)
        val expected = preferences.getInt(APP_UPDATE_PENDING_KEY, APP_UPDATE_NO_SESSION)
        val actual = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, APP_UPDATE_NO_SESSION)
        if (!appUpdateCallbackMatches(intent.action, expected, actual)) return
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        (context.applicationContext as? AppUpdateComposition)?.installerResult(actual, status)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            openAppUpdateConfirmation(context, intent)
        } else {
            recordAppUpdateOutcome(context, status == PackageInstaller.STATUS_SUCCESS)
        }
    }
}

private fun openAppUpdateConfirmation(context: Context, callback: Intent) {
    val confirmation = IntentCompat.getParcelableExtra(callback, Intent.EXTRA_INTENT, Intent::class.java)
    val started = runCatching {
        requireAppUpdate(confirmation != null, "Android installation confirmation is missing.")
        context.startActivity(requireNotNull(confirmation).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }.isSuccess
    if (!started) recordAppUpdateOutcome(context, false)
}

private fun recordAppUpdateOutcome(context: Context, success: Boolean) {
    appUpdatePreferences(context).edit().remove(APP_UPDATE_PENDING_KEY)
        .putString(APP_UPDATE_OUTCOME_KEY, if (success) "success" else "cancelled-or-failed").apply()
}

internal fun consumeAppUpdateOutcome(context: Context): Boolean? {
    val preferences = appUpdatePreferences(context)
    val outcome = preferences.getString(APP_UPDATE_OUTCOME_KEY, null) ?: return null
    preferences.edit().remove(APP_UPDATE_OUTCOME_KEY).apply()
    return outcome == "success"
}
