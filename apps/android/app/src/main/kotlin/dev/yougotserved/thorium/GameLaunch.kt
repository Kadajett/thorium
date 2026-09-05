package dev.yougotserved.thorium

import android.content.Intent
import java.net.URI
import org.json.JSONObject

data class ColyseusSessionCapability(
    val endpoint: String,
    val roomName: String,
    val ticket: String,
    val expiresAtEpochMs: Long,
    val joinOptions: Map<String, String>,
) {
    init {
        val uri = runCatching { URI(endpoint) }.getOrNull()
        require(
            uri != null && uri.scheme.lowercase() in setOf("https", "wss") &&
                !uri.host.isNullOrEmpty() && uri.userInfo == null && uri.rawFragment == null,
        ) { "Invalid Colyseus endpoint" }
        require(roomName == "game_session") { "Invalid Colyseus room" }
        require(ticket.isNotBlank() && ticket.length <= 4096) { "Invalid Colyseus ticket" }
        require(expiresAtEpochMs > 0) { "Invalid Colyseus ticket expiry" }
        require(joinOptions.keys == JOIN_OPTION_KEYS && joinOptions.values.all(String::isNotEmpty)) {
            "Invalid Colyseus join options"
        }
    }

    fun toJson(): JSONObject = JSONObject()
        .put("endpoint", endpoint)
        .put("roomName", roomName)
        .put("ticket", ticket)
        .put("expiresAtEpochMs", expiresAtEpochMs)
        .put("joinOptions", JSONObject(joinOptions))

    companion object {
        val JOIN_OPTION_KEYS = setOf(
            "gameSessionId",
            "packageId",
            "packageVersion",
            "packageDigest",
        )

        fun fromJson(raw: String): ColyseusSessionCapability {
            val root = JSONObject(raw)
            require(root.keys().asSequence().toSet() == setOf(
                "endpoint",
                "roomName",
                "ticket",
                "expiresAtEpochMs",
                "joinOptions",
            )) { "Invalid Colyseus capability fields" }
            val options = root.optJSONObject("joinOptions") ?: error("Missing join options")
            require(options.keys().asSequence().toSet() == JOIN_OPTION_KEYS) {
                "Invalid Colyseus join option fields"
            }
            return ColyseusSessionCapability(
                endpoint = root.getString("endpoint"),
                roomName = root.getString("roomName"),
                ticket = root.getString("ticket"),
                expiresAtEpochMs = root.getLong("expiresAtEpochMs"),
                joinOptions = JOIN_OPTION_KEYS.associateWith(options::getString),
            )
        }
    }
}

data class GameLaunch(
    val packageId: String,
    val version: String,
    val sessionId: String,
    val mainEntrypoint: String,
    val companionEntrypoint: String,
    val runtimeFiles: Set<String>,
    val logicalWidth: Int,
    val logicalHeight: Int,
    val maximumDevicePixelRatio: Double,
    val companionLogicalWidth: Int,
    val companionLogicalHeight: Int,
    val companionMaximumDevicePixelRatio: Double,
    val controls: List<ReleaseControl>,
    val southButtonBinding: SouthButtonBinding?,
    val maxLocalSlots: Int,
    val localPlayerSlots: Set<Int>,
    val maxLocalPeerMessageBytes: Int,
    val contentDigest: String,
    val capabilities: Set<String>,
    val controlledPlayerSlots: Map<SurfaceRole, Set<Int>> = SurfaceRole.entries.associateWith {
        localPlayerSlots
    },
    val surfaceCapabilities: Map<SurfaceRole, ColyseusSessionCapability> = emptyMap(),
) {
    init {
        require(GameLaunchPolicy.isValidPackageId(packageId)) { "Invalid package ID" }
        require(GameLaunchPolicy.isValidVersion(version)) { "Invalid game version" }
        require(GameLaunchPolicy.isValidSessionId(sessionId)) { "Invalid session ID" }
        require(GameLaunchPolicy.isSafeEntrypoint(mainEntrypoint)) { "Invalid main entrypoint" }
        require(GameLaunchPolicy.isSafeEntrypoint(companionEntrypoint)) {
            "Invalid companion entrypoint"
        }
        require(
            runtimeFiles.isNotEmpty() && runtimeFiles.all(GameLaunchPolicy::isSafePackagePath) &&
                mainEntrypoint in runtimeFiles && companionEntrypoint in runtimeFiles,
        ) { "Invalid runtime files" }
        require(logicalWidth in 1..8192 && logicalHeight in 1..8192) {
            "Invalid logical dimensions"
        }
        require(maximumDevicePixelRatio.isFinite() && maximumDevicePixelRatio in 1.0..3.0) {
            "Invalid maximum device pixel ratio"
        }
        require(companionLogicalWidth in 1..8192 && companionLogicalHeight in 1..8192) {
            "Invalid companion logical dimensions"
        }
        require(
            companionMaximumDevicePixelRatio.isFinite() &&
                companionMaximumDevicePixelRatio in 1.0..3.0,
        ) {
            "Invalid companion maximum device pixel ratio"
        }
        require(
            controls.isNotEmpty() && controls.map { it.id }.toSet().size == controls.size &&
                controls.all { control ->
                    GameLaunchPolicy.isValidControlId(control.id) && control.label.isNotEmpty() &&
                        control.label.length <= 80 && control.kind in setOf("button", "axis")
                },
        ) {
            "Invalid controls"
        }
        require(
            southButtonBinding?.controlId == null || controls.any { it.id == southButtonBinding.controlId },
        ) {
            "South button binding references an unknown control"
        }
        require(maxLocalSlots in 1..16) { "Invalid maximum local slots" }
        require(
            localPlayerSlots.isNotEmpty() && localPlayerSlots.size <= maxLocalSlots &&
                localPlayerSlots.all { it in 0..15 },
        ) { "Invalid locally leased player slots" }
        require(
            controlledPlayerSlots.keys == SurfaceRole.entries.toSet() &&
                controlledPlayerSlots.values.flatten().toSet() == localPlayerSlots &&
                controlledPlayerSlots.values.sumOf(Set<Int>::size) == localPlayerSlots.size &&
                controlledPlayerSlots.values.all { slots -> slots.all { it in 0..15 } },
        ) { "Invalid per-surface PlayerSlot leases" }
        require(
            southButtonBinding == null ||
                southButtonBinding.playerSlot in controlledPlayerSlots.getValue(SurfaceRole.MAIN),
        ) { "South button binding references an unleased player slot" }
        require(maxLocalPeerMessageBytes in 1..64 * 1024) {
            "Invalid maximum local peer message size"
        }
        require(GameLaunchPolicy.isValidDigest(contentDigest)) {
            "Invalid installed content digest"
        }
        require(
            capabilities.all { it == "same-device-peer" || it == "colyseus-session" },
        ) { "Invalid game capability" }
        require(surfaceCapabilities.keys.all { it in SurfaceRole.entries }) {
            "Invalid surface capability role"
        }
        surfaceCapabilities.forEach { (role, capability) ->
            require("colyseus-session" in capabilities) { "Online capability was not granted" }
            require(capability.joinOptions.getValue("gameSessionId") == sessionId)
            require(capability.joinOptions.getValue("packageId") == packageId)
            require(capability.joinOptions.getValue("packageVersion") == version)
            require(
                capability.joinOptions.getValue("packageDigest") == contentDigest,
            ) { "Surface capability does not match the Game Release" }
            require(controlledPlayerSlots.containsKey(role))
        }
    }

    fun entrypoint(role: SurfaceRole): String = when (role) {
        SurfaceRole.MAIN -> mainEntrypoint
        SurfaceRole.COMPANION -> companionEntrypoint
    }

    fun controlledPlayerSlots(role: SurfaceRole): Set<Int> =
        controlledPlayerSlots.getValue(role)

    fun sessionCapability(role: SurfaceRole): ColyseusSessionCapability? =
        surfaceCapabilities[role]

    fun putInto(
        intent: Intent,
        includedSessionCapabilities: Set<SurfaceRole> = SurfaceRole.entries.toSet(),
    ): Intent = intent
        .putExtra(PACKAGE_ID, packageId)
        .putExtra(VERSION, version)
        .putExtra(SESSION_ID, sessionId)
        .putExtra(MAIN_ENTRYPOINT, mainEntrypoint)
        .putExtra(COMPANION_ENTRYPOINT, companionEntrypoint)
        .putExtra(RUNTIME_FILES, runtimeFiles.toTypedArray())
        .putExtra(LOGICAL_WIDTH, logicalWidth)
        .putExtra(LOGICAL_HEIGHT, logicalHeight)
        .putExtra(MAXIMUM_DEVICE_PIXEL_RATIO, maximumDevicePixelRatio)
        .putExtra(COMPANION_LOGICAL_WIDTH, companionLogicalWidth)
        .putExtra(COMPANION_LOGICAL_HEIGHT, companionLogicalHeight)
        .putExtra(COMPANION_MAXIMUM_DEVICE_PIXEL_RATIO, companionMaximumDevicePixelRatio)
        .putExtra(CONTROL_IDS, controls.map { it.id }.toTypedArray())
        .putExtra(CONTROL_LABELS, controls.map { it.label }.toTypedArray())
        .putExtra(CONTROL_KINDS, controls.map { it.kind }.toTypedArray())
        .putExtra(MAX_LOCAL_SLOTS, maxLocalSlots)
        .putExtra(LOCAL_PLAYER_SLOTS, localPlayerSlots.sorted().toIntArray())
        .putExtra(MAX_LOCAL_PEER_MESSAGE_BYTES, maxLocalPeerMessageBytes)
        .putExtra(CONTENT_DIGEST, contentDigest)
        .putExtra(CAPABILITIES, capabilities.toTypedArray())
        .putExtra(
            MAIN_CONTROLLED_PLAYER_SLOTS,
            controlledPlayerSlots(SurfaceRole.MAIN).sorted().toIntArray(),
        )
        .putExtra(
            COMPANION_CONTROLLED_PLAYER_SLOTS,
            controlledPlayerSlots(SurfaceRole.COMPANION).sorted().toIntArray(),
        )
        .also { destination ->
            surfaceCapabilities[SurfaceRole.MAIN]
                ?.takeIf { SurfaceRole.MAIN in includedSessionCapabilities }
                ?.let {
                destination.putExtra(MAIN_SESSION_CAPABILITY, it.toJson().toString())
            }
            surfaceCapabilities[SurfaceRole.COMPANION]
                ?.takeIf { SurfaceRole.COMPANION in includedSessionCapabilities }
                ?.let {
                destination.putExtra(COMPANION_SESSION_CAPABILITY, it.toJson().toString())
            }
        }
        .also { destination ->
            southButtonBinding?.let { binding ->
                destination.putExtra(SOUTH_BUTTON_PLAYER_SLOT, binding.playerSlot)
                destination.putExtra(SOUTH_BUTTON_CONTROL, binding.controlId)
            }
        }

    companion object {
        const val PACKAGE_ID = "package_id"
        const val VERSION = "game_version"
        const val SESSION_ID = "session_id"
        const val MAIN_ENTRYPOINT = "main_entrypoint"
        const val COMPANION_ENTRYPOINT = "companion_entrypoint"
        const val RUNTIME_FILES = "runtime_files"
        const val LOGICAL_WIDTH = "logical_width"
        const val LOGICAL_HEIGHT = "logical_height"
        const val MAXIMUM_DEVICE_PIXEL_RATIO = "maximum_device_pixel_ratio"
        const val COMPANION_LOGICAL_WIDTH = "companion_logical_width"
        const val COMPANION_LOGICAL_HEIGHT = "companion_logical_height"
        const val COMPANION_MAXIMUM_DEVICE_PIXEL_RATIO = "companion_maximum_device_pixel_ratio"
        const val CONTROL_IDS = "control_ids"
        const val CONTROL_LABELS = "control_labels"
        const val CONTROL_KINDS = "control_kinds"
        const val MAX_LOCAL_SLOTS = "max_local_slots"
        const val LOCAL_PLAYER_SLOTS = "local_player_slots"
        const val MAX_LOCAL_PEER_MESSAGE_BYTES = "max_local_peer_message_bytes"
        const val SOUTH_BUTTON_PLAYER_SLOT = "south_button_player_slot"
        const val SOUTH_BUTTON_CONTROL = "south_button_control"
        const val CONTENT_DIGEST = "content_digest"
        const val CAPABILITIES = "capabilities"
        const val MAIN_CONTROLLED_PLAYER_SLOTS = "main_controlled_player_slots"
        const val COMPANION_CONTROLLED_PLAYER_SLOTS = "companion_controlled_player_slots"
        const val MAIN_SESSION_CAPABILITY = "main_session_capability"
        const val COMPANION_SESSION_CAPABILITY = "companion_session_capability"
        const val EXPECTED_DISPLAY_ID = "expected_display_id"

        fun from(
            game: CatalogGame,
            sessionId: String,
            localPlayerSlots: Set<Int> = defaultLocalPlayerSlots(game.maxLocalSlots),
            controlledPlayerSlots: Map<SurfaceRole, Set<Int>> = mapOf(
                SurfaceRole.MAIN to setOf(0),
                SurfaceRole.COMPANION to localPlayerSlots.filterTo(mutableSetOf()) { it != 0 },
            ),
            surfaceCapabilities: Map<SurfaceRole, ColyseusSessionCapability> = emptyMap(),
            grantedCapabilities: Set<String> = game.capabilities,
        ): GameLaunch = GameLaunch(
            packageId = game.packageId,
            version = game.version,
            sessionId = sessionId,
            mainEntrypoint = game.mainEntrypoint,
            companionEntrypoint = game.companionEntrypoint,
            runtimeFiles = game.runtimeFiles,
            logicalWidth = game.logicalWidth,
            logicalHeight = game.logicalHeight,
            maximumDevicePixelRatio = game.maximumDevicePixelRatio,
            companionLogicalWidth = game.companionLogicalWidth,
            companionLogicalHeight = game.companionLogicalHeight,
            companionMaximumDevicePixelRatio = game.companionMaximumDevicePixelRatio,
            controls = game.controls,
            southButtonBinding = game.southButtonBinding,
            maxLocalSlots = game.maxLocalSlots,
            localPlayerSlots = localPlayerSlots,
            maxLocalPeerMessageBytes = game.maxLocalPeerMessageBytes,
            contentDigest = game.contentDigest,
            capabilities = grantedCapabilities,
            controlledPlayerSlots = controlledPlayerSlots,
            surfaceCapabilities = surfaceCapabilities,
        )

        fun from(intent: Intent): GameLaunch? = runCatching {
            val southControl = intent.getStringExtra(SOUTH_BUTTON_CONTROL)
            val southSlotPresent = intent.hasExtra(SOUTH_BUTTON_PLAYER_SLOT)
            if ((southControl == null) != !southSlotPresent) return null
            val controlIds = intent.getStringArrayExtra(CONTROL_IDS) ?: return null
            val controlLabels = intent.getStringArrayExtra(CONTROL_LABELS) ?: return null
            val controlKinds = intent.getStringArrayExtra(CONTROL_KINDS) ?: return null
            if (controlIds.size != controlLabels.size || controlIds.size != controlKinds.size) return null
            GameLaunch(
                packageId = intent.getStringExtra(PACKAGE_ID) ?: return null,
                version = intent.getStringExtra(VERSION) ?: return null,
                sessionId = intent.getStringExtra(SESSION_ID) ?: return null,
                mainEntrypoint = intent.getStringExtra(MAIN_ENTRYPOINT) ?: return null,
                companionEntrypoint = intent.getStringExtra(COMPANION_ENTRYPOINT) ?: return null,
                runtimeFiles = intent.getStringArrayExtra(RUNTIME_FILES)?.toSet().orEmpty(),
                logicalWidth = intent.getIntExtra(LOGICAL_WIDTH, 0),
                logicalHeight = intent.getIntExtra(LOGICAL_HEIGHT, 0),
                maximumDevicePixelRatio = intent.getDoubleExtra(
                    MAXIMUM_DEVICE_PIXEL_RATIO,
                    Double.NaN,
                ),
                companionLogicalWidth = intent.getIntExtra(COMPANION_LOGICAL_WIDTH, 0),
                companionLogicalHeight = intent.getIntExtra(COMPANION_LOGICAL_HEIGHT, 0),
                companionMaximumDevicePixelRatio = intent.getDoubleExtra(
                    COMPANION_MAXIMUM_DEVICE_PIXEL_RATIO,
                    Double.NaN,
                ),
                controls = controlIds.indices.map { index ->
                    ReleaseControl(controlIds[index], controlLabels[index], controlKinds[index])
                },
                southButtonBinding = southControl?.let { control ->
                    SouthButtonBinding(
                        playerSlot = intent.getIntExtra(SOUTH_BUTTON_PLAYER_SLOT, -1),
                        controlId = control,
                    )
                },
                maxLocalSlots = intent.getIntExtra(MAX_LOCAL_SLOTS, 0),
                localPlayerSlots = intent.getIntArrayExtra(LOCAL_PLAYER_SLOTS)?.toSet().orEmpty(),
                maxLocalPeerMessageBytes = intent.getIntExtra(MAX_LOCAL_PEER_MESSAGE_BYTES, 0),
                contentDigest = intent.getStringExtra(CONTENT_DIGEST) ?: return null,
                capabilities = intent.getStringArrayExtra(CAPABILITIES)?.toSet().orEmpty(),
                controlledPlayerSlots = mapOf(
                    SurfaceRole.MAIN to intent.getIntArrayExtra(MAIN_CONTROLLED_PLAYER_SLOTS)
                        ?.toSet().orEmpty(),
                    SurfaceRole.COMPANION to
                        intent.getIntArrayExtra(COMPANION_CONTROLLED_PLAYER_SLOTS)
                            ?.toSet().orEmpty(),
                ),
                surfaceCapabilities = buildMap {
                    intent.getStringExtra(MAIN_SESSION_CAPABILITY)?.let {
                        put(SurfaceRole.MAIN, ColyseusSessionCapability.fromJson(it))
                    }
                    intent.getStringExtra(COMPANION_SESSION_CAPABILITY)?.let {
                        put(SurfaceRole.COMPANION, ColyseusSessionCapability.fromJson(it))
                    }
                },
            )
        }.getOrNull()

        private fun defaultLocalPlayerSlots(maxLocalSlots: Int): Set<Int> =
            if (maxLocalSlots >= 2) setOf(0, 1) else setOf(0)
    }
}

object GameLaunchPolicy {
    private val packageId = Regex("^[a-z0-9]+(?:[.-][a-z0-9]+)+$")
    private val version = Regex("^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$")
    private val sessionId = Regex("^[A-Za-z0-9_-]{1,128}$")
    private val pathSegment = Regex("^[A-Za-z0-9][A-Za-z0-9._-]*$")
    private val controlId = Regex("^[a-z][a-z0-9-]{0,31}$")
    private val digest = Regex("^[0-9a-f]{64}$")

    fun isValidPackageId(value: String): Boolean = value.length <= 128 && packageId.matches(value)

    fun isValidVersion(value: String): Boolean = value.length <= 64 && version.matches(value)

    fun isValidSessionId(value: String): Boolean = sessionId.matches(value)

    fun isValidControlId(value: String): Boolean = controlId.matches(value)

    fun isValidDigest(value: String): Boolean = digest.matches(value)

    fun isSafeEntrypoint(value: String): Boolean {
        return isSafePackagePath(value) && value.endsWith(".html", ignoreCase = true)
    }

    fun isSafePackagePath(value: String): Boolean {
        if (value.isEmpty() || value.length > 256 || value.startsWith('/') || value.contains('\\')) {
            return false
        }
        val segments = value.split('/')
        return segments.all { segment ->
            segment != "." && segment != ".." && pathSegment.matches(segment)
        }
    }
}
