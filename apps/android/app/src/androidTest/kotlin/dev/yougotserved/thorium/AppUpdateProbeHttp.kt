package dev.yougotserved.thorium

import androidx.test.platform.app.InstrumentationRegistry
import java.nio.file.Files
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

private const val PROBE_TAG = "android-v0.1.0-dev.11"
private const val PROBE_DISCOVERY_SECONDS = 30L

internal fun appUpdateProbeHttp(application: AppUpdateProbeApplication): AppUpdateHttpPort = AppUpdateHttpPort(
    read = { url, limit -> probeRead(application, url, limit) },
    download = { url, path, apk ->
        check(url == appUpdateAssetUrl(PROBE_TAG, AppUpdateLimits.APK_NAME))
        application.downloads.incrementAndGet()
        probeAssets().open("candidate.apk").use { input ->
            Files.newOutputStream(path).use { copyAppUpdate(input, it, apk) }
        }
    },
)

private fun probeRead(application: AppUpdateProbeApplication, url: String, limit: Int): ByteArray {
    check(application.discovery.await(PROBE_DISCOVERY_SECONDS, TimeUnit.SECONDS))
    val bytes = when (url) {
        appUpdateListUrl(1) -> probeReleaseList()
        appUpdateListUrl(2), appUpdateListUrl(3) -> "[]".toByteArray()
        appUpdateAssetUrl(PROBE_TAG, AppUpdateLimits.METADATA_NAME) -> probeMetadata()
        else -> error("Unexpected fixture HTTP request: $url")
    }
    check(bytes.size <= limit)
    return bytes
}

private fun probeReleaseList(): ByteArray {
    val metadata = probeMetadata()
    val apk = parseAppUpdateManifest(metadata.toString(Charsets.UTF_8)).apk
    val assets = JSONArray().put(probeAsset(AppUpdateLimits.METADATA_NAME, metadata.size.toLong()))
        .put(probeAsset(AppUpdateLimits.APK_NAME, apk.sizeBytes))
    val release = JSONObject().put("tag_name", PROBE_TAG).put("draft", false)
        .put("prerelease", true).put("assets", assets)
    return JSONArray().put(release).toString().toByteArray()
}

private fun probeAsset(name: String, size: Long): JSONObject = JSONObject().put("name", name).put("size", size)
    .put("browser_download_url", appUpdateAssetUrl(PROBE_TAG, name))

private fun probeMetadata(): ByteArray = probeAssets().open("thorium-android-update.json").use { it.readBytes() }

private fun probeAssets() = InstrumentationRegistry.getInstrumentation().context.assets
