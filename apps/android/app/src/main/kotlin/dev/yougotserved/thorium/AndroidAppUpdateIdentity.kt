package dev.yougotserved.thorium

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import java.nio.file.Path
import java.security.MessageDigest

internal fun androidAppUpdateInstalled(context: Context): AppUpdateInstalled {
    val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
    return AppUpdateInstalled(appUpdateVersion(info), appUpdateSigners(info), Build.VERSION.SDK_INT)
}

internal fun androidAppUpdateArchive(context: Context, path: Path): AppUpdateArchive {
    val info = context.packageManager.getPackageArchiveInfo(path.toString(), PackageManager.GET_SIGNING_CERTIFICATES)
        ?: throw AppUpdateException("Android could not inspect the update APK.")
    val minSdk = info.applicationInfo?.minSdkVersion ?: throw AppUpdateException("APK SDK requirement is missing.")
    return AppUpdateArchive(appUpdateVersion(info), appUpdateSigners(info), minSdk)
}

private fun appUpdateVersion(info: PackageInfo): AppUpdateVersion = AppUpdateVersion(
    info.packageName,
    info.longVersionCode,
    info.versionName ?: throw AppUpdateException("APK version name is missing."),
)

private fun appUpdateSigners(info: PackageInfo): Set<String> {
    val signers = info.signingInfo?.apkContentsSigners
        ?: throw AppUpdateException("APK signing certificate is missing.")
    return signers.map { appUpdateHex(MessageDigest.getInstance("SHA-256").digest(it.toByteArray())) }.toSet()
}
