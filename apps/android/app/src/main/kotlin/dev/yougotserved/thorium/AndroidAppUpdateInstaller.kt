package dev.yougotserved.thorium

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.provider.Settings
import android.net.Uri
import java.nio.file.Files

internal fun createAndroidAppUpdateInstaller(context: Context): AppUpdateInstallerPort = AppUpdateInstallerPort(
    install = { installAndroidAppUpdate(context, it) },
    permitted = { context.packageManager.canRequestPackageInstalls() },
    settings = {
        val uri = Uri.parse("package:${context.packageName}")
        context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, uri))
    },
    outcome = { consumeAppUpdateOutcome(context) },
)

private fun installAndroidAppUpdate(context: Context, prepared: AppUpdatePrepared): AppUpdateInstallResult {
    if (!context.packageManager.canRequestPackageInstalls()) return AppUpdateInstallResult.PERMISSION_REQUIRED
    val archive = androidAppUpdateArchive(context, prepared.path)
    verifyAppUpdate(androidAppUpdateInstalled(context), prepared.candidate, archive)
    val installer = context.packageManager.packageInstaller
    val sessionId = installer.createSession(appUpdateSessionParams(prepared))
    var committed = false
    try {
        installer.openSession(sessionId).use { session -> commitAppUpdate(context, session, prepared, sessionId) }
        committed = true
    } finally {
        if (!committed) {
            installer.abandonSession(sessionId)
            appUpdatePreferences(context).edit().remove(APP_UPDATE_PENDING_KEY).apply()
        }
    }
    discardAndroidAppUpdate(context, prepared)
    return AppUpdateInstallResult.SUBMITTED
}

private fun appUpdateSessionParams(prepared: AppUpdatePrepared): PackageInstaller.SessionParams {
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
    params.setAppPackageName(prepared.candidate.manifest.version.packageId)
    params.setSize(prepared.candidate.manifest.apk.sizeBytes)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
    }
    return params
}

private fun commitAppUpdate(
    context: Context,
    session: PackageInstaller.Session,
    prepared: AppUpdatePrepared,
    sessionId: Int,
) {
    session.openWrite("base.apk", 0, prepared.candidate.manifest.apk.sizeBytes).use { output ->
        Files.newInputStream(prepared.path).use { copyAppUpdate(it, output, prepared.candidate.manifest.apk) }
        session.fsync(output)
    }
    val callback = Intent(context, AndroidAppUpdateReceiver::class.java).setAction(APP_UPDATE_RESULT_ACTION)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
    val pending = PendingIntent.getBroadcast(context, sessionId, callback, flags)
    val tracked = appUpdatePreferences(context).edit().putInt(APP_UPDATE_PENDING_KEY, sessionId)
        .remove(APP_UPDATE_OUTCOME_KEY).commit()
    requireAppUpdate(tracked,
        "Cannot track Android installation confirmation.")
    session.commit(pending.intentSender)
}
