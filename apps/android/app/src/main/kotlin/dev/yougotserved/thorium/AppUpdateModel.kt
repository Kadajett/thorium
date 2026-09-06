package dev.yougotserved.thorium

import java.nio.file.Path

internal object AppUpdateLimits {
    const val PACKAGE_ID = "dev.yougotserved.thorium.debug"
    const val METADATA_NAME = "thorium-android-update.json"
    const val APK_NAME = "thorium-developer-debug.apk"
    const val METADATA_BYTES = 16384
    const val RELEASE_LIST_BYTES = 1048576
    const val APK_BYTES = 268435456L
    const val RELEASE_PAGES = 3
    const val RELEASES_PER_PAGE = 20
    const val METADATA_REQUESTS = 10
    const val CHECK_INTERVAL_MS = 21600000L
}

internal data class AppUpdateVersion(val packageId: String, val versionCode: Long, val versionName: String)
internal data class AppUpdateApk(val assetName: String, val sizeBytes: Long, val sha256: String)
internal data class AppUpdateManifest(val version: AppUpdateVersion, val minSdk: Int, val apk: AppUpdateApk)
internal data class AppUpdateInstalled(val version: AppUpdateVersion, val signerDigests: Set<String>, val sdk: Int)
internal data class AppUpdateArchive(val version: AppUpdateVersion, val signerDigests: Set<String>, val minSdk: Int)
internal data class AppUpdateAsset(val name: String, val sizeBytes: Long, val url: String)
internal data class AppUpdateRelease(val tag: String, val assets: List<AppUpdateAsset>)
internal data class AppUpdateCandidate(val tag: String, val manifest: AppUpdateManifest, val url: String)
internal data class AppUpdatePrepared(val candidate: AppUpdateCandidate, val path: Path)

internal class AppUpdateException(message: String) : IllegalArgumentException(message)

internal fun requireAppUpdate(condition: Boolean, message: String) {
    if (!condition) throw AppUpdateException(message)
}
