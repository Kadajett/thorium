package dev.yougotserved.thorium

import java.net.URI

private const val UPDATE_HTTPS_PORT = 443

private val updateTag = Regex("android-v[A-Za-z0-9._-]{1,100}")
private val updateRedirectHosts = setOf(
    "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com",
)

internal fun appUpdateReleaseTag(tag: String): Boolean = updateTag.matches(tag)

internal fun appUpdateAssetUrl(tag: String, name: String): String {
    requireAppUpdate(appUpdateReleaseTag(tag), "Invalid Android release tag.")
    requireAppUpdate(name in setOf(AppUpdateLimits.METADATA_NAME, AppUpdateLimits.APK_NAME), "Invalid update asset.")
    return "https://github.com/Kadajett/thorium/releases/download/$tag/$name"
}

internal fun appUpdateListUrl(page: Int): String {
    requireAppUpdate(page in 1..AppUpdateLimits.RELEASE_PAGES, "Invalid release page.")
    return "https://api.github.com/repos/Kadajett/thorium/releases" +
        "?per_page=${AppUpdateLimits.RELEASES_PER_PAGE}&page=$page"
}

internal fun requireAppUpdateHttps(uri: URI) {
    requireAppUpdate(uri.scheme == "https" && uri.host != null, "Updates require HTTPS.")
    requireAppUpdate(uri.userInfo == null && uri.fragment == null, "Invalid update URL.")
    requireAppUpdate(uri.port == -1 || uri.port == UPDATE_HTTPS_PORT, "Invalid update port.")
}

internal fun appUpdateRedirect(source: URI, location: String): URI {
    val target = source.resolve(location)
    requireAppUpdateHttps(target)
    requireAppUpdate(target.host in updateRedirectHosts, "Update redirect left GitHub asset storage.")
    if (target.host == "github.com") {
        requireAppUpdate(target.path.startsWith("/Kadajett/thorium/releases/download/"), "Invalid GitHub redirect.")
    }
    return target
}
