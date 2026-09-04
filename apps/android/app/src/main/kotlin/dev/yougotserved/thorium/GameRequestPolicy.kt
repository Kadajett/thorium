package dev.yougotserved.thorium

import java.net.URI

enum class GameRequestDecision {
    PACKAGE_ASSET,
    PLATFORM_NETWORK,
    BLOCKED,
}

/**
 * The single request-policy seam shared by WebView adapters.
 *
 * Package assets are restricted to the verified launch tree. External traffic is denied unless
 * the launch was granted a capability with an explicit platform endpoint mapping.
 */
class GameRequestPolicy private constructor(
    private val launch: GameLaunch,
    private val platformEndpoint: NetworkEndpoint?,
) {
    val contentSecurityPolicy: String = buildString {
        append("default-src 'none'; ")
        append("script-src 'self'; ")
        append("connect-src ")
        if (platformEndpoint == null) {
            append("'none'")
        } else {
            append(platformEndpoint.httpsOrigin)
            append(' ')
            append(platformEndpoint.webSocketOrigin)
        }
        append("; img-src 'self' data: blob:; ")
        append("media-src 'self' data: blob:; ")
        append("style-src 'self' 'unsafe-inline'; ")
        append("font-src 'self'; ")
        append("worker-src 'none'; child-src 'none'; frame-src 'none'; ")
        append("object-src 'none'; base-uri 'none'; form-action 'none'; ")
        append("manifest-src 'none'; frame-ancestors 'none'")
    }

    fun decide(rawUrl: String): GameRequestDecision {
        if (GameAssetPolicy.isAllowedPackageUrl(launch, rawUrl)) {
            return GameRequestDecision.PACKAGE_ASSET
        }
        val candidate = NetworkEndpoint.fromRequest(rawUrl) ?: return GameRequestDecision.BLOCKED
        return if (candidate == platformEndpoint) {
            GameRequestDecision.PLATFORM_NETWORK
        } else {
            GameRequestDecision.BLOCKED
        }
    }

    companion object {
        fun create(launch: GameLaunch, role: SurfaceRole): GameRequestPolicy {
            val endpoint = launch.sessionCapability(role)?.let { capability ->
                NetworkEndpoint.fromCapability(capability.endpoint)
            }
            return GameRequestPolicy(launch, endpoint)
        }
    }

    private data class NetworkEndpoint(val host: String, val port: Int) {
        val httpsOrigin: String = origin("https")
        val webSocketOrigin: String = origin("wss")

        private fun origin(scheme: String): String =
            "$scheme://$host${if (port == 443) "" else ":$port"}"

        companion object {
            fun fromCapability(rawUrl: String): NetworkEndpoint {
                val uri = URI(rawUrl)
                require(
                    uri.scheme?.lowercase() in setOf("https", "wss") &&
                        uri.host != null &&
                        uri.userInfo == null &&
                        uri.rawFragment == null,
                ) { "Session capability endpoint must be HTTPS or WSS" }
                return NetworkEndpoint(uri.host.lowercase(), effectivePort(uri))
            }

            fun fromRequest(rawUrl: String): NetworkEndpoint? = runCatching {
                val uri = URI(rawUrl)
                if (
                    uri.scheme?.lowercase() !in setOf("https", "wss") ||
                    uri.host == null ||
                    uri.userInfo != null
                ) {
                    return null
                }
                NetworkEndpoint(uri.host.lowercase(), effectivePort(uri))
            }.getOrNull()

            private fun effectivePort(uri: URI): Int = if (uri.port == -1) 443 else uri.port
        }
    }
}
