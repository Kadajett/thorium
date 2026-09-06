package dev.yougotserved.thorium

import android.content.Context
import java.nio.file.Files
import java.nio.file.Path

internal fun prepareAndroidAppUpdate(
    context: Context,
    http: AppUpdateHttpPort,
    candidate: AppUpdateCandidate,
): AppUpdatePrepared = prepareAppUpdate(AppUpdatePreparationPort(
    installed = { androidAppUpdateInstalled(context) },
    inspect = { androidAppUpdateArchive(context, it) },
    download = http.download,
    directory = appUpdateDirectory(context),
), candidate)

internal fun appUpdateDirectory(context: Context): Path = context.cacheDir.toPath().resolve("app-updates")

internal fun discardAndroidAppUpdate(context: Context, prepared: AppUpdatePrepared) {
    requireAppUpdate(prepared.path.parent == appUpdateDirectory(context), "Invalid private APK path.")
    Files.deleteIfExists(prepared.path)
}
