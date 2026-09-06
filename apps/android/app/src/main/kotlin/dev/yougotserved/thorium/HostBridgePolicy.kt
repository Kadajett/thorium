package dev.yougotserved.thorium

import org.json.JSONArray
import org.json.JSONObject

sealed interface HostAction {
    data class BootstrapRequested(val requestId: String) : HostAction
    data object Ready : HostAction
    data class RouteToPeer(val message: String) : HostAction
}

/** Session policy for one game-origin WebSurface. */
class HostBridgePolicy private constructor(
    private val expectedRole: SurfaceRole,
    allowedControls: Set<String>,
    localPlayerSlots: Set<Int>,
    capabilities: Set<String>,
    private val maxLocalPeerMessageBytes: Int,
) {
    private val allowedControls = allowedControls.toSet()
    private val localPlayerSlots = localPlayerSlots.toSet()
    private val sameDevicePeerEnabled = SAME_DEVICE_PEER in capabilities
    private var lastControlSequence: Long? = null

    @Synchronized
    fun parse(raw: String): HostAction? {
        val maxMessageBytes = maxLocalPeerMessageBytes + MAX_MESSAGE_ENVELOPE_BYTES
        if (raw.length > maxMessageBytes) return null
        if (raw.toByteArray(Charsets.UTF_8).size > maxMessageBytes) return null
        val message = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        return when (message.opt("kind") as? String) {
            "bootstrap-request" -> (message.opt("requestId") as? String)
                ?.takeIf(::isValidRequestId)
                ?.let(HostAction::BootstrapRequested)
            "ready" -> if (message.opt("surface") == expectedRole.wireValue) {
                HostAction.Ready
            } else {
                null
            }
            "control" -> routeControl(message)
            "peer" -> if (sameDevicePeerEnabled) {
                normalizedPeer(message)?.let(HostAction::RouteToPeer)
            } else {
                null
            }
            else -> null
        }
    }

    private fun routeControl(message: JSONObject): HostAction? {
        val normalized = normalizedControl(message) ?: return null
        if (lastControlSequence?.let { normalized.sequence <= it } == true) return null
        lastControlSequence = normalized.sequence
        return HostAction.RouteToPeer(normalized.message)
    }

    private fun normalizedControl(message: JSONObject): NormalizedControl? {
        val event = message.optJSONObject("event") ?: return null
        val control = event.opt("control") as? String ?: return null
        val player = event.opt("player") as? Int ?: return null
        val phase = event.opt("phase") as? String ?: return null
        val value = (event.opt("value") as? Number)?.toDouble() ?: return null
        val sequence = when (val candidate = event.opt("sequence")) {
            null -> return null
            is Int -> candidate.toLong()
            is Long -> candidate
            else -> return null
        }
        if (
            control !in allowedControls || player !in localPlayerSlots ||
            phase !in setOf("pressed", "released", "changed") ||
            !value.isFinite() || sequence < 0
        ) return null
        return NormalizedControl(
            sequence = sequence,
            message = JSONObject()
                .put("kind", "control")
                .put(
                    "event",
                    JSONObject()
                        .put("control", control)
                        .put("player", player)
                        .put("phase", phase)
                        .put("value", value)
                        .put("sequence", sequence),
                )
                .toString(),
        )
    }

    private fun normalizedPeer(message: JSONObject): String? {
        val channel = message.opt("channel") as? String ?: return null
        val source = message.opt("source") as? String ?: return null
        if (!channelId.matches(channel) || source != expectedRole.wireValue || !message.has("payload")) {
            return null
        }
        val payload = message.opt("payload")
        val payloadBytes = serializedJsonValue(payload)?.toByteArray(Charsets.UTF_8)?.size ?: return null
        if (payloadBytes > maxLocalPeerMessageBytes) return null
        return JSONObject()
            .put("kind", "peer")
            .put(
                "event",
                JSONObject()
                    .put("channel", channel)
                    .put("payload", payload)
                    .put("source", source),
            )
            .toString()
    }

    companion object {
        private const val MAX_MESSAGE_ENVELOPE_BYTES = 16 * 1024
        private const val SAME_DEVICE_PEER = "same-device-peer"
        private val channelId = Regex("^[a-z][a-z0-9-]{0,31}$")

        fun forSurface(launch: GameLaunch, role: SurfaceRole): HostBridgePolicy =
            HostBridgePolicy(
                expectedRole = role,
                allowedControls = launch.controls.mapTo(mutableSetOf()) { it.id },
                localPlayerSlots = launch.controlledPlayerSlots(role),
                capabilities = launch.capabilities,
                maxLocalPeerMessageBytes = launch.maxLocalPeerMessageBytes,
            )

        fun bootstrapResponse(requestId: String, bootstrap: JSONObject): String = JSONObject()
            .put("kind", "bootstrap")
            .put("requestId", requestId)
            .put("bootstrap", bootstrap)
            .toString()

        private fun isValidRequestId(requestId: String): Boolean =
            requestId.length in 1..128 && requestId.all { character ->
                character.isLetterOrDigit() || character == '-' || character == '_'
            }

        private fun serializedJsonValue(value: Any?): String? = when (value) {
            null, JSONObject.NULL -> "null"
            is String -> JSONObject.quote(value)
            is Boolean -> value.toString()
            is Int, is Long -> value.toString()
            is Double -> value.takeIf(Double::isFinite)?.toString()
            is Float -> value.takeIf(Float::isFinite)?.toString()
            is JSONObject, is JSONArray -> value.toString()
            else -> null
        }
    }

    private data class NormalizedControl(val sequence: Long, val message: String)
}

object GameBootstrapMessage {
    fun create(launch: GameLaunch, role: SurfaceRole, requestId: String): String {
        val screen = if (role == SurfaceRole.MAIN) {
            Triple(launch.logicalWidth, launch.logicalHeight, launch.maximumDevicePixelRatio)
        } else {
            Triple(
                launch.companionLogicalWidth,
                launch.companionLogicalHeight,
                launch.companionMaximumDevicePixelRatio,
            )
        }
        val players = JSONArray()
        launch.localPlayerSlots.sorted().forEach { slot ->
            players.put(
                JSONObject()
                    .put("slot", slot)
                    .put("displayName", "Player ${slot + 1}")
                    .put("local", true),
            )
        }
        val controls = JSONArray()
        launch.controls.forEach { control ->
            controls.put(
                JSONObject()
                    .put("id", control.id)
                    .put("label", control.label)
                    .put("kind", control.kind),
            )
        }
        val bootstrap = JSONObject()
            .put("protocolVersion", 1)
            .put("surface", role.wireValue)
            .put(
                "game",
                JSONObject()
                    .put("id", launch.packageId)
                    .put("version", launch.version)
                    .put("instanceId", launch.sessionId),
            )
            .put("players", players)
            .put(
                "controlledPlayerSlots",
                JSONArray(launch.controlledPlayerSlots(role).sorted()),
            )
            .put("controls", controls)
            .put("controllerInput", if (launch.controllerBindings == null) "browser" else "native")
            .put(
                "render",
                JSONObject()
                    .put("logicalWidth", screen.first)
                    .put("logicalHeight", screen.second)
                    .put("maximumDevicePixelRatio", screen.third),
            )
            .put(
                "limits",
                JSONObject().put(
                    "maxLocalPeerMessageBytes",
                    launch.maxLocalPeerMessageBytes,
                ),
            )
        launch.sessionCapability(role)?.let { capability ->
            bootstrap.put("colyseus", capability.toJson())
        }
        if (LocalSaveLimits.CAPABILITY in launch.capabilities) {
            bootstrap.put("localSave", LocalSaveProtocol.grant())
        }
        return HostBridgePolicy.bootstrapResponse(requestId, bootstrap)
    }
}
