package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RequiredDualSurfacePolicyTest {
    @Test
    fun launchesForANewOrUnconfirmedSessionOnly() {
        assertTrue(RequiredDualSurfacePolicy.requiresCompanionLaunch(null, "session-1"))
        assertTrue(RequiredDualSurfacePolicy.requiresCompanionLaunch("session-1", "session-2"))
        assertFalse(RequiredDualSurfacePolicy.requiresCompanionLaunch("session-1", "session-1"))
    }

    @Test
    fun successfulLaunchConfirmsTheRequiredCompanionSurface() {
        val resolution = RequiredDualSurfacePolicy.resolveCompanionLaunch(
            sessionId = "session-1",
            launched = true,
        )

        assertTrue(resolution.mayContinue)
        assertEquals("session-1", resolution.companionSessionId)
    }

    @Test
    fun failedLaunchCannotContinueAMainOnlySession() {
        val resolution = RequiredDualSurfacePolicy.resolveCompanionLaunch(
            sessionId = "session-1",
            launched = false,
        )

        assertFalse(resolution.mayContinue)
        assertNull(resolution.companionSessionId)
    }
}
