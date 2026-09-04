package dev.yougotserved.thorium

import java.net.URI

object GameAssetPolicy {
    const val ORIGIN = "https://appassets.androidplatform.net"
    private const val HOST = "appassets.androidplatform.net"

    fun entryUrl(launch: GameLaunch, role: SurfaceRole): String = if (launch.contentDigest == null) {
        "$ORIGIN/games/${launch.packageId}/${launch.entrypoint(role)}"
    } else {
        "$ORIGIN/installed-games/releases/${launch.packageId}/${launch.version}/" +
            "${launch.contentDigest}/${launch.entrypoint(role)}"
    }

    fun isAllowedPackageUrl(launch: GameLaunch, rawUrl: String): Boolean = runCatching {
        val uri = URI(rawUrl)
        val rawPath = uri.rawPath ?: return false
        val allowedPrefix = if (launch.contentDigest == null) {
            "/games/${launch.packageId}/"
        } else {
            "/installed-games/releases/${launch.packageId}/${launch.version}/${launch.contentDigest}/"
        }
        val relativePath = rawPath.removePrefix(allowedPrefix)
        uri.scheme == "https" &&
            uri.host == HOST &&
            (uri.port == -1 || uri.port == 443) &&
            uri.userInfo == null &&
            uri.rawQuery == null &&
            uri.rawFragment == null &&
            !rawPath.contains('%') &&
            !rawPath.contains('\\') &&
            rawPath.startsWith(allowedPrefix) &&
            rawPath.split('/').none { it == "." || it == ".." } &&
            relativePath in launch.runtimeFiles
    }.getOrDefault(false)
}
