package dev.yougotserved.thorium

import org.json.JSONObject

object LocalSessionCoordinator {
    interface Endpoint {
        fun deliver(message: String)
        fun terminateGameSession() = Unit
    }

    private data class SessionKey(val packageId: String, val sessionId: String)

    private data class SessionState(
        val southButtonBinding: SouthButtonBinding?,
        val controllerInput: ControllerInputPolicy = ControllerInputPolicy(southButtonBinding),
        val endpoints: MutableMap<SurfaceRole, Endpoint> = mutableMapOf(),
    )

    private val sessions = mutableMapOf<SessionKey, SessionState>()

    @Synchronized
    fun register(launch: GameLaunch, role: SurfaceRole, endpoint: Endpoint) {
        val state = sessions.getOrPut(SessionKey(launch.packageId, launch.sessionId)) {
            SessionState(launch.southButtonBinding)
        }
        require(state.southButtonBinding == launch.southButtonBinding) {
            "Controller binding changed during a GameSession"
        }
        state.endpoints[role] = endpoint
    }

    @Synchronized
    fun unregister(launch: GameLaunch, role: SurfaceRole, endpoint: Endpoint) {
        val key = SessionKey(launch.packageId, launch.sessionId)
        val state = sessions[key] ?: return
        if (state.endpoints[role] === endpoint) state.endpoints.remove(role)
        if (state.endpoints.isEmpty()) sessions.remove(key)
    }

    fun route(launch: GameLaunch, source: SurfaceRole, message: String) {
        val destination = synchronized(this) {
            sessions[key(launch)]?.endpoints?.get(source.opposite())
        }
        destination?.deliver(message)
    }

    fun terminate(launch: GameLaunch) {
        val endpoints = synchronized(this) {
            sessions.remove(key(launch))?.endpoints?.values?.toList().orEmpty()
        }
        endpoints.forEach(Endpoint::terminateGameSession)
    }

    fun handleSouthButton(
        launch: GameLaunch,
        focusedSurface: SurfaceRole,
        input: ControllerKeyInput,
    ): Boolean {
        val delivery = synchronized(this) {
            val state = sessions[key(launch)] ?: return false
            if (state.endpoints[focusedSurface] == null) return false
            val destination = state.endpoints[SurfaceRole.MAIN] ?: return false
            state.controllerInput.acceptSouth(input) to destination
        }
        val decision = delivery.first
        decision.control?.let { control -> delivery.second.deliver(controlMessage(control)) }
        return decision.handled
    }

    private fun key(launch: GameLaunch): SessionKey =
        SessionKey(launch.packageId, launch.sessionId)

    private fun controlMessage(control: SemanticControlInput): String = JSONObject()
        .put("kind", "control")
        .put(
            "event",
            JSONObject()
                .put("control", control.controlId)
                .put("player", control.playerSlot)
                .put("phase", control.phase)
                .put("value", control.value)
                .put("sequence", control.sequence),
        )
        .toString()

    private fun SurfaceRole.opposite(): SurfaceRole = when (this) {
        SurfaceRole.MAIN -> SurfaceRole.COMPANION
        SurfaceRole.COMPANION -> SurfaceRole.MAIN
    }
}
