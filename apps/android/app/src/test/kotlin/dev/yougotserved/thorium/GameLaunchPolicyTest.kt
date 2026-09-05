package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class GameLaunchPolicyTest {
    @Test
    fun validatesManifestIdentifiersAndEntrypoints() {
        listOf(
            "dev.yougotserved.tap-race",
            "a.b",
            "games-tap",
            "1.2",
        ).forEach { assertTrue(GameLaunchPolicy.isValidPackageId(it)) }
        listOf(
            "0.1.0",
            "01.002.0003",
            "1.2.3-beta.1",
            "1.2.3-0.alpha-1",
        ).forEach { assertTrue(GameLaunchPolicy.isValidVersion(it)) }
        listOf(
            "taprace",
            "dev..tap-race",
            "dev.tap-race-",
            "Dev.tap-race",
            "dev.tap_race",
        ).forEach { assertFalse(GameLaunchPolicy.isValidPackageId(it)) }
        listOf(
            "1.2",
            "v1.2.3",
            "1.2.3-",
            "1.2.3+build.1",
        ).forEach { assertFalse(GameLaunchPolicy.isValidVersion(it)) }
        assertTrue(GameLaunchPolicy.isSafeEntrypoint("main/index.html"))
        assertFalse(GameLaunchPolicy.isSafeEntrypoint("../index.html"))
        assertFalse(GameLaunchPolicy.isSafeEntrypoint("https://example.com/index.html"))
    }

    @Test
    fun launchCarriesReleaseLimitsAndRejectsBindingsOutsideItsLeaseSet() {
        val launch = GameLaunch.from(TestPackages.installedGame(), "launch-policy")

        assertEquals(2, launch.maxLocalSlots)
        assertEquals(setOf(0, 1), launch.localPlayerSlots)
        assertEquals(4096, launch.maxLocalPeerMessageBytes)
        assertEquals(1.25, launch.copy(maximumDevicePixelRatio = 1.25).maximumDevicePixelRatio, 0.0)
        assertThrows(IllegalArgumentException::class.java) {
            launch.copy(localPlayerSlots = setOf(1))
        }
        listOf(Double.NaN, Double.POSITIVE_INFINITY, 0.99, 3.01).forEach { invalid ->
            assertThrows(IllegalArgumentException::class.java) {
                launch.copy(maximumDevicePixelRatio = invalid)
            }
        }
        assertThrows(IllegalArgumentException::class.java) {
            launch.copy(companionMaximumDevicePixelRatio = Double.NEGATIVE_INFINITY)
        }
    }

    @Test
    fun rejectsPlayerSlotControlledByBothSurfaceRoles() {
        val launch = GameLaunch.from(TestPackages.installedGame(), "overlapping-seat-leases")

        assertThrows(IllegalArgumentException::class.java) {
            launch.copy(
                controlledPlayerSlots = mapOf(
                    SurfaceRole.MAIN to setOf(0),
                    SurfaceRole.COMPANION to setOf(0, 1),
                ),
            )
        }
    }
}
