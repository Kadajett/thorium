package dev.yougotserved.thorium

data class CompanionLaunchResolution(
    val companionSessionId: String?,
    val mayContinue: Boolean,
)

object RequiredDualSurfacePolicy {
    fun requiresCompanionLaunch(
        companionSessionId: String?,
        requestedSessionId: String,
    ): Boolean = companionSessionId != requestedSessionId

    fun resolveCompanionLaunch(
        sessionId: String,
        launched: Boolean,
    ): CompanionLaunchResolution = if (launched) {
        CompanionLaunchResolution(companionSessionId = sessionId, mayContinue = true)
    } else {
        CompanionLaunchResolution(companionSessionId = null, mayContinue = false)
    }
}
