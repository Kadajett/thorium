package dev.yougotserved.thorium

import java.io.InterruptedIOException

internal fun discoverAppUpdate(installed: AppUpdateInstalled, http: AppUpdateHttpPort): AppUpdateCandidate? {
    if (installed.version.packageId != AppUpdateLimits.PACKAGE_ID) return null
    val releases = (1..AppUpdateLimits.RELEASE_PAGES).flatMap { page ->
        val bytes = http.read(appUpdateListUrl(page), AppUpdateLimits.RELEASE_LIST_BYTES)
        parseAppUpdateReleases(bytes.toString(Charsets.UTF_8))
    }
    val candidates = releases.filter { release -> release.assets.any { it.name == AppUpdateLimits.METADATA_NAME } }
        .take(AppUpdateLimits.METADATA_REQUESTS).mapNotNull { readAppUpdateCandidate(it, http) }
    return selectAppUpdate(installed, candidates)
}

private fun readAppUpdateCandidate(release: AppUpdateRelease, http: AppUpdateHttpPort): AppUpdateCandidate? =
    runCatching {
        val metadata = release.assets.single { it.name == AppUpdateLimits.METADATA_NAME }
        requireAppUpdate(metadata.sizeBytes in 1..AppUpdateLimits.METADATA_BYTES, "Invalid update metadata size.")
        val bytes = http.read(metadata.url, AppUpdateLimits.METADATA_BYTES)
        requireAppUpdate(bytes.size.toLong() == metadata.sizeBytes, "Update metadata size does not match.")
        bindAppUpdate(release, parseAppUpdateManifest(bytes.toString(Charsets.UTF_8)))
    }.getOrElse { error ->
        if (error is InterruptedIOException) throw error
        null
    }
