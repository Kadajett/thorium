package dev.yougotserved.thorium

import org.json.JSONArray
import org.json.JSONObject
import java.nio.file.Path
import java.security.MessageDigest

internal val updateBytes = "verified APK fixture".toByteArray()
internal val updateApk = AppUpdateApk(
    AppUpdateLimits.APK_NAME, updateBytes.size.toLong(),
    appUpdateHex(MessageDigest.getInstance("SHA-256").digest(updateBytes)),
)
internal fun updateCandidate(code: Long = 10): AppUpdateCandidate {
    val manifest = AppUpdateManifest(AppUpdateVersion(AppUpdateLimits.PACKAGE_ID, code, "dev.$code"), 29, updateApk)
    return AppUpdateCandidate("android-v$code", manifest, appUpdateAssetUrl("android-v$code", AppUpdateLimits.APK_NAME))
}
internal fun updateInstalled(): AppUpdateInstalled = AppUpdateInstalled(
    AppUpdateVersion(AppUpdateLimits.PACKAGE_ID, 9, "dev.9"), setOf("same-signer"), 37,
)
internal fun updateArchive(candidate: AppUpdateCandidate = updateCandidate()): AppUpdateArchive =
    AppUpdateArchive(candidate.manifest.version, setOf("same-signer"), candidate.manifest.minSdk)

internal fun updateMetadata(candidate: AppUpdateCandidate = updateCandidate()): JSONObject {
    val manifest = candidate.manifest
    return JSONObject().put("schema", 1).put("packageId", manifest.version.packageId)
        .put("versionCode", manifest.version.versionCode).put("versionName", manifest.version.versionName)
        .put("minSdk", manifest.minSdk).put("apk", JSONObject().put("assetName", manifest.apk.assetName)
            .put("sizeBytes", manifest.apk.sizeBytes).put("sha256", manifest.apk.sha256))
}
internal fun updateReleaseJson(candidate: AppUpdateCandidate = updateCandidate()): JSONObject {
    val metadata = updateMetadata(candidate).toString().toByteArray()
    val assets = JSONArray().put(updateAssetJson(candidate.tag, AppUpdateLimits.METADATA_NAME, metadata.size.toLong()))
        .put(updateAssetJson(candidate.tag, AppUpdateLimits.APK_NAME, candidate.manifest.apk.sizeBytes))
    return JSONObject().put("tag_name", candidate.tag).put("draft", false).put("prerelease", true).put("assets", assets)
}
private fun updateAssetJson(tag: String, name: String, size: Long): JSONObject = JSONObject()
    .put("name", name).put("size", size).put("browser_download_url", appUpdateAssetUrl(tag, name))

internal class AppUpdateHarness {
    val queue = ArrayDeque<() -> Unit>()
    val states = mutableListOf<AppUpdateState>()
    val discarded = mutableListOf<AppUpdatePrepared>()
    var downloads = 0
    var installs = 0
    var settings = 0
    var permitted = true
    var failure = false
    var outcome: Boolean? = null
    val controller = AppUpdateController(ports(), AppUpdateExecution(
        background = { queue.add(it); {} }, foreground = { it() }, cleanup = { queue.add(it) },
    )) { states.add(it) }
    val state: AppUpdateState get() = states.lastOrNull() ?: AppUpdateState()

    fun flush() { while (queue.isNotEmpty()) queue.removeFirst().invoke() }
    fun available() { controller.check(); flush() }
    fun ready() { available(); controller.confirm(); flush() }

    private fun ports() = AppUpdatePorts(
        discover = { discover() },
        prepare = { downloads += 1; AppUpdatePrepared(it, Path.of("fixture.apk")) },
        discard = { discarded.add(it) },
        installer = AppUpdateInstallerPort(
            install = { installs += 1; installResult() }, permitted = { permitted }, settings = { settings += 1 },
            outcome = { outcome },
        ),
    )
    private fun installResult(): AppUpdateInstallResult = if (permitted) AppUpdateInstallResult.SUBMITTED
        else AppUpdateInstallResult.PERMISSION_REQUIRED

    private fun discover(): AppUpdateCandidate {
        if (failure) throw AppUpdateException("offline")
        return updateCandidate()
    }
}
