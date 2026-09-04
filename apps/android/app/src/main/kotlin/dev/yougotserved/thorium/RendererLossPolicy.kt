package dev.yougotserved.thorium

enum class RendererLossRecovery {
    RECREATE_LOCAL_SURFACE,
    TERMINATE_ONLINE_SESSION,
}

object RendererLossPolicy {
    fun recovery(launch: GameLaunch, role: SurfaceRole): RendererLossRecovery =
        if (launch.sessionCapability(role) == null) {
            RendererLossRecovery.RECREATE_LOCAL_SURFACE
        } else {
            RendererLossRecovery.TERMINATE_ONLINE_SESSION
        }
}
