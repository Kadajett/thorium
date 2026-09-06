package dev.yougotserved.thorium

import org.json.JSONArray
import org.json.JSONObject

private const val UPDATE_RELEASE_ASSETS = 100

internal fun parseAppUpdateReleases(text: String): List<AppUpdateRelease> {
    requireAppUpdate(
        text.toByteArray(Charsets.UTF_8).size <= AppUpdateLimits.RELEASE_LIST_BYTES, "Release list is too large.",
    )
    val releases = JSONArray(text)
    requireAppUpdate(releases.length() <= AppUpdateLimits.RELEASES_PER_PAGE, "Release list exceeds its bound.")
    return (0 until releases.length()).mapNotNull { parseAppUpdateRelease(releases.getJSONObject(it)) }
}

private fun parseAppUpdateRelease(value: JSONObject): AppUpdateRelease? {
    val tag = appUpdateString(value, "tag_name")
    if (!appUpdateReleaseTag(tag) || value.get("draft") != false) return null
    // Prereleases are deliberately eligible; /releases/latest would omit them.
    val assets = value.getJSONArray("assets")
    requireAppUpdate(assets.length() <= UPDATE_RELEASE_ASSETS, "Too many release assets.")
    return AppUpdateRelease(tag, (0 until assets.length()).mapNotNull { updateAsset(tag, assets.getJSONObject(it)) })
}

private fun updateAsset(tag: String, value: JSONObject): AppUpdateAsset? {
    val name = appUpdateString(value, "name")
    if (name !in setOf(AppUpdateLimits.METADATA_NAME, AppUpdateLimits.APK_NAME)) return null
    val url = appUpdateString(value, "browser_download_url")
    requireAppUpdate(url == appUpdateAssetUrl(tag, name), "Update asset URL does not match its release.")
    return AppUpdateAsset(name, appUpdateInteger(value, "size"), url)
}

internal fun bindAppUpdate(release: AppUpdateRelease, manifest: AppUpdateManifest): AppUpdateCandidate {
    val assets = release.assets.filter { it.name == manifest.apk.assetName }
    requireAppUpdate(assets.size == 1, "The release must contain exactly one APK.")
    val asset = assets.single()
    requireAppUpdate(asset.sizeBytes == manifest.apk.sizeBytes, "APK size does not match the release asset.")
    requireAppUpdate(asset.url == appUpdateAssetUrl(release.tag, asset.name), "The APK is outside its release.")
    return AppUpdateCandidate(release.tag, manifest, asset.url)
}
