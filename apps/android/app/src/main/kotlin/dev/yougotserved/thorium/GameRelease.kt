package dev.yougotserved.thorium

import org.json.JSONObject

data class PackageFileDescriptor(
    val path: String,
    val sha256: String,
    val size: Long,
)

data class PackageBundleDescriptor(
    val fileName: String,
    val url: String,
    val sha256: String,
    val sizeBytes: Long,
    val manifestSha256: String,
    val files: List<PackageFileDescriptor>,
)

data class ReleaseScreen(
    val logicalWidth: Int,
    val logicalHeight: Int,
    val maximumDevicePixelRatio: Double,
) {
    init {
        require(
            maximumDevicePixelRatio.isFinite() && maximumDevicePixelRatio in 1.0..3.0,
        ) { "maximumDevicePixelRatio must be finite and from 1 through 3" }
    }
}

data class ReleaseControl(
    val id: String,
    val label: String,
    val kind: String,
)

data class GameRelease(
    val manifest: GameManifestProjection,
    val tags: List<String>,
    val publishedAt: String,
    val contentDigest: String,
    val bundle: PackageBundleDescriptor,
) {
    val packageId: String get() = manifest.packageId
    val version: String get() = manifest.version
    val displayName: String get() = manifest.displayName
    val summary: String get() = manifest.summary
    val description: String get() = manifest.description
    val mainEntrypoint: String get() = manifest.runtime.main.path
    val companionEntrypoint: String get() = manifest.runtime.companion.path
    val runtimeFiles: List<String> get() = manifest.runtime.files
    val mainScreen: ReleaseScreen get() = manifest.displays.main
    val companionScreen: ReleaseScreen get() = manifest.displays.companion
    val minPlayers: Int get() = manifest.players.minSlots
    val maxPlayers: Int get() = manifest.players.maxSlots
    val maxLocalSlots: Int get() = manifest.players.maxLocalSlots
    val sameAccountMultipleSlots: Boolean get() = manifest.players.sameAccountMultipleSlots
    val defaultLocalSeatPlan: Map<SurfaceRole, Set<Int>>?
        get() = manifest.players.defaultLocalSeatPlan
    val multiplayerOnline: Boolean get() = manifest.multiplayer.online
    val multiplayerRequiresOnline: Boolean get() = manifest.multiplayer.requiresOnline
    val controls: List<ReleaseControl> get() = manifest.controls
    val controllerBindings: ControllerBindings? get() = manifest.controllerBindings
    val capabilities: List<String> get() = manifest.capabilities
    val maxPackageBytes: Long get() = manifest.budgets.maxPackageBytes
    val maxFileCount: Int get() = manifest.budgets.maxFileCount
    val maxLocalPeerMessageBytes: Int get() = manifest.budgets.maxLocalPeerMessageBytes
}

object GameReleaseIntegrity {
    fun canonicalDescriptor(release: GameRelease): JSONObject {
        val files = org.json.JSONArray()
        release.bundle.files.sortedBy { it.path }.forEach { file ->
            files.put(
                JSONObject()
                    .put("path", file.path)
                    .put("sha256", file.sha256)
                    .put("size", file.size),
            )
        }
        val capabilities = org.json.JSONArray()
        release.capabilities.sorted().forEach(capabilities::put)
        return JSONObject()
            .put("descriptorSchema", 1)
            .put(
                "game",
                JSONObject()
                    .put("packageId", release.packageId)
                    .put("version", release.version)
                    .put("displayName", release.displayName),
            )
            .put("manifestSha256", release.bundle.manifestSha256)
            .put(
                "execution",
                JSONObject()
                    .put("kind", "web-v1")
                    .put("main", release.mainEntrypoint)
                    .put("companion", release.companionEntrypoint)
                    .put("files", files),
            )
            .put("capabilities", capabilities)
            .put(
                "bundle",
                JSONObject()
                    .put("fileName", release.bundle.fileName)
                    .put("sha256", release.bundle.sha256)
                    .put("sizeBytes", release.bundle.sizeBytes),
            )
            .put("deployable", true)
    }
}

data class CatalogPage(
    val items: List<GameRelease>,
    val nextCursor: String?,
)

class CatalogParseException(message: String) : IllegalArgumentException(message)
