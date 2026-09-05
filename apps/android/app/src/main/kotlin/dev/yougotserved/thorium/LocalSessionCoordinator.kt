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
        val profile: ControllerBindings?,
        val owners: Map<SurfaceRole, Set<Int>>,
        val nativeInput: NativeControllerRouter? = profile?.let {
            NativeControllerRouter(it, owners.values.flatten().toSet())
        },
        val controllerInput: ControllerInputPolicy = ControllerInputPolicy(southButtonBinding),
        val endpoints: MutableMap<SurfaceRole, Endpoint> = mutableMapOf(),
        val visibleSurfaces: MutableSet<SurfaceRole> = mutableSetOf(),
    )

    private val sessions = mutableMapOf<SessionKey, SessionState>()

    @Synchronized
    fun register(launch: GameLaunch, role: SurfaceRole, endpoint: Endpoint) {
        val state = sessions.getOrPut(SessionKey(launch.packageId, launch.sessionId)) {
            SessionState(launch.southButtonBinding, launch.controllerBindings, launch.controlledPlayerSlots)
        }
        require(state.southButtonBinding == launch.southButtonBinding) {
            "Controller binding changed during a GameSession"
        }
        require(state.profile == launch.controllerBindings && state.owners == launch.controlledPlayerSlots) {
            "Controller profile or PlayerSlot ownership changed during a GameSession"
        }
        state.endpoints[role] = endpoint
    }

    @Synchronized
    fun unregister(launch: GameLaunch, role: SurfaceRole, endpoint: Endpoint) {
        val key = SessionKey(launch.packageId, launch.sessionId)
        val state = sessions[key] ?: return
        if (state.endpoints[role] === endpoint) {
            state.endpoints.remove(role)
            state.visibleSurfaces.remove(role)
        }
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

    fun onSurfaceDestroyed(launch: GameLaunch, role: SurfaceRole, isFinishing: Boolean) {
        if (role == SurfaceRole.MAIN && isFinishing) terminate(launch)
    }

    fun handleSouthButton(
        launch: GameLaunch,
        focusedSurface: SurfaceRole,
        input: ControllerKeyInput,
    ): Boolean {
        val delivery = synchronized(this) {
            val state = sessions[key(launch)] ?: return false
            if (state.endpoints[focusedSurface] == null) return false
            val targetRole = state.southButtonBinding?.surfaceRole ?: return false
            val destination = state.endpoints[targetRole] ?: return false
            state.controllerInput.acceptSouth(input) to destination
        }
        val decision = delivery.first
        decision.control?.let { control -> delivery.second.deliver(controlMessage(control)) }
        return decision.handled
    }

    @Synchronized
    fun handleController(launch: GameLaunch, focusedSurface: SurfaceRole, input: ControllerDeviceInput): Boolean {
        val state = sessions[key(launch)] ?: return false
        if (focusedSurface !in state.endpoints) return false
        val mapper = state.nativeInput ?: return false
        deliverControls(state, mapper.accept(input))
        return true
    }

    @Synchronized
    fun needsControllerAssignment(launch: GameLaunch, deviceId: Int): Boolean =
        sessions[key(launch)]?.nativeInput?.needsAssignment(deviceId) == true

    @Synchronized
    fun assignController(launch: GameLaunch, deviceId: Int, slot: Int) {
        val state = sessions[key(launch)] ?: return
        deliverControls(state, state.nativeInput?.assign(deviceId, slot).orEmpty())
    }

    @Synchronized
    fun disconnectController(launch: GameLaunch, deviceId: Int) {
        val state = sessions[key(launch)] ?: return
        deliverControls(state, state.nativeInput?.disconnect(deviceId).orEmpty())
    }

    @Synchronized
    fun releaseControllerInputs(launch: GameLaunch) {
        val state = sessions[key(launch)] ?: return
        deliverControls(state, state.nativeInput?.releaseAll().orEmpty())
    }

    @Synchronized
    fun setSurfaceVisible(launch: GameLaunch, role: SurfaceRole, visible: Boolean) {
        val state = sessions[key(launch)] ?: return
        if (visible) state.visibleSurfaces.add(role) else state.visibleSurfaces.remove(role)
        if (state.visibleSurfaces.isEmpty()) deliverControls(state, state.nativeInput?.releaseAll().orEmpty())
    }

    private fun deliverControls(state: SessionState, controls: List<SemanticControlInput>) {
        controls.forEach { control ->
            val owner = state.owners.entries.single { control.playerSlot in it.value }.key
            state.endpoints[owner]?.deliver(controlMessage(control))
        }
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
