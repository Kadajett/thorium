package dev.yougotserved.thorium

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GameAssetPolicyTest {
    @Test
    fun allowsOnlyExactHttpsOriginAndPackageTree() {
        val launch = launch(contentDigest = null)
        assertTrue(
            GameAssetPolicy.isAllowedPackageUrl(
                launch,
                "https://appassets.androidplatform.net/games/dev.yougotserved.tap-race/main/index.html",
            ),
        )
        assertFalse(
            GameAssetPolicy.isAllowedPackageUrl(
                launch,
                "http://appassets.androidplatform.net/games/dev.yougotserved.tap-race/main/index.html",
            ),
        )
        assertFalse(
            GameAssetPolicy.isAllowedPackageUrl(
                launch,
                "https://appassets.androidplatform.net/games/dev.yougotserved.other/main/index.html",
            ),
        )
        assertFalse(
            GameAssetPolicy.isAllowedPackageUrl(
                launch,
                "https://appassets.androidplatform.net/games/dev.yougotserved.tap-race/%2e%2e/secret",
            ),
        )
    }

    @Test
    fun installedPackageUrlIncludesExactVersionAndContentDigest() {
        val digest = "a".repeat(64)
        val launch = launch(contentDigest = digest)
        val expected = "https://appassets.androidplatform.net/installed-games/releases/" +
            "dev.yougotserved.tap-race/0.1.0/$digest/main/index.html"

        assertTrue(GameAssetPolicy.isAllowedPackageUrl(launch, expected))
        assertEquals(expected, GameAssetPolicy.entryUrl(launch, SurfaceRole.MAIN))
        assertFalse(GameAssetPolicy.isAllowedPackageUrl(launch, expected.replace(digest, "b".repeat(64))))
        assertFalse(GameAssetPolicy.isAllowedPackageUrl(launch, "$expected?session=secret"))
    }

    private fun launch(contentDigest: String?): GameLaunch = GameLaunch(
        packageId = "dev.yougotserved.tap-race",
        version = "0.1.0",
        sessionId = "asset-policy",
        mainEntrypoint = "main/index.html",
        companionEntrypoint = "companion/index.html",
        runtimeFiles = setOf("main/index.html", "companion/index.html", "dist/game.js"),
        logicalWidth = 960,
        logicalHeight = 540,
        maximumDevicePixelRatio = 2.0,
        companionLogicalWidth = 960,
        companionLogicalHeight = 540,
        companionMaximumDevicePixelRatio = 2.0,
        controls = listOf(ReleaseControl("tap", "Tap", "button")),
        southButtonBinding = SouthButtonBinding(0, "tap"),
        maxLocalSlots = 2,
        localPlayerSlots = setOf(0, 1),
        maxLocalPeerMessageBytes = 4096,
        contentDigest = contentDigest,
        capabilities = emptySet(),
        controlledPlayerSlots = mapOf(
            SurfaceRole.MAIN to setOf(0),
            SurfaceRole.COMPANION to setOf(1),
        ),
    )
}
