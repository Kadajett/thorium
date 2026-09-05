package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogControllerPolicyTest {
    @Test
    fun mapsAndroidDpadAndFaceButtonKeycodesWithoutComposeFocus() {
        assertEquals(CatalogControllerCommand.MOVE_UP, keyDown(AndroidCatalogKeyCode.DPAD_UP))
        assertEquals(CatalogControllerCommand.MOVE_DOWN, keyDown(AndroidCatalogKeyCode.DPAD_DOWN))
        assertEquals(CatalogControllerCommand.MOVE_LEFT, keyDown(AndroidCatalogKeyCode.DPAD_LEFT))
        assertEquals(CatalogControllerCommand.MOVE_RIGHT, keyDown(AndroidCatalogKeyCode.DPAD_RIGHT))
        assertEquals(CatalogControllerCommand.ACTIVATE, keyDown(AndroidCatalogKeyCode.BUTTON_A))
        assertEquals(CatalogControllerCommand.ACTIVATE, keyDown(AndroidCatalogKeyCode.DPAD_CENTER))
        assertEquals(CatalogControllerCommand.SEARCH, keyDown(AndroidCatalogKeyCode.BUTTON_X))
        assertEquals(CatalogControllerCommand.REFRESH, keyDown(AndroidCatalogKeyCode.BUTTON_Y))
        assertEquals(CatalogControllerCommand.BACK_OR_CLEAR, keyDown(AndroidCatalogKeyCode.BUTTON_B))

        assertTrue(CatalogAndroidKeyPolicy.recognizes(AndroidCatalogKeyCode.DPAD_UP))
        assertTrue(CatalogAndroidKeyPolicy.recognizes(AndroidCatalogKeyCode.BUTTON_A))
        assertFalse(CatalogAndroidKeyPolicy.recognizes(24))
    }

    @Test
    fun consumesReleasesAndDebouncesAWhileAllowingHeldDpadMovement() {
        assertNull(
            CatalogAndroidKeyPolicy.command(
                AndroidCatalogKeyCode.BUTTON_A,
                AndroidCatalogKeyAction.UP,
                repeatCount = 0,
            ),
        )
        assertNull(
            CatalogAndroidKeyPolicy.command(
                AndroidCatalogKeyCode.BUTTON_A,
                AndroidCatalogKeyAction.DOWN,
                repeatCount = 1,
            ),
        )
        assertEquals(
            CatalogControllerCommand.MOVE_DOWN,
            CatalogAndroidKeyPolicy.command(
                AndroidCatalogKeyCode.DPAD_DOWN,
                AndroidCatalogKeyAction.DOWN,
                repeatCount = 3,
            ),
        )
    }

    @Test
    fun stickUsesADeadZoneAndMovesOncePerDeliberateDeflection() {
        val navigator = CatalogStickNavigator()

        assertNull(navigator.command(horizontal = 0.2f, vertical = 0.1f, eventTimeMillis = 1))
        assertEquals(
            CatalogControllerCommand.MOVE_RIGHT,
            navigator.command(horizontal = 0.8f, vertical = 0.1f, eventTimeMillis = 2),
        )
        assertNull(navigator.command(horizontal = 0.9f, vertical = 0.1f, eventTimeMillis = 300))
        assertNull(navigator.command(horizontal = 0.1f, vertical = 0.1f, eventTimeMillis = 301))
        assertEquals(
            CatalogControllerCommand.MOVE_RIGHT,
            navigator.command(horizontal = 0.8f, vertical = 0.1f, eventTimeMillis = 302),
        )
    }

    @Test
    fun heldStickRepeatsAtAControlledRateAndChangesDirectionImmediately() {
        val navigator = CatalogStickNavigator(
            initialRepeatDelayMillis = 300,
            repeatIntervalMillis = 100,
        )

        assertEquals(
            CatalogControllerCommand.MOVE_DOWN,
            navigator.command(horizontal = 0.1f, vertical = 0.9f, eventTimeMillis = 1_000),
        )
        assertNull(navigator.command(horizontal = 0.1f, vertical = 0.9f, eventTimeMillis = 1_299))
        assertEquals(
            CatalogControllerCommand.MOVE_DOWN,
            navigator.command(horizontal = 0.1f, vertical = 0.9f, eventTimeMillis = 1_300),
        )
        assertNull(navigator.command(horizontal = 0.1f, vertical = 0.9f, eventTimeMillis = 1_399))
        assertEquals(
            CatalogControllerCommand.MOVE_DOWN,
            navigator.command(horizontal = 0.1f, vertical = 0.9f, eventTimeMillis = 1_400),
        )
        assertEquals(
            CatalogControllerCommand.MOVE_LEFT,
            navigator.command(horizontal = -0.9f, vertical = 0.2f, eventTimeMillis = 1_401),
        )
    }

    @Test
    fun stickChoosesTheDominantAxisForDiagonalInput() {
        val navigator = CatalogStickNavigator()

        assertEquals(
            CatalogControllerCommand.MOVE_UP,
            navigator.command(horizontal = 0.7f, vertical = -0.9f, eventTimeMillis = 1),
        )
    }

    @Test
    fun movesCardToSearchToRefreshAndBackToTheSameCard() {
        var focus = CatalogFocus(CatalogFocusTarget.CARD, cardIndex = 1)

        focus = CatalogFocusPolicy.move(focus, CatalogControllerCommand.MOVE_UP, 8, 3)
        assertEquals(CatalogFocusTarget.SEARCH, focus.target)

        focus = CatalogFocusPolicy.move(focus, CatalogControllerCommand.MOVE_RIGHT, 8, 3)
        assertEquals(CatalogFocusTarget.REFRESH, focus.target)

        focus = CatalogFocusPolicy.move(focus, CatalogControllerCommand.MOVE_DOWN, 8, 3)
        assertEquals(CatalogFocus(CatalogFocusTarget.CARD, cardIndex = 1), focus)
    }

    @Test
    fun gridAndUtilityBoundariesNeverWrapOrLoseTheRememberedCard() {
        assertEquals(
            CatalogFocus(CatalogFocusTarget.CARD, 0),
            CatalogFocusPolicy.move(
                CatalogFocus(CatalogFocusTarget.CARD, 0),
                CatalogControllerCommand.MOVE_LEFT,
                itemCount = 8,
                columnCount = 3,
            ),
        )
        assertEquals(
            CatalogFocus(CatalogFocusTarget.CARD, 2),
            CatalogFocusPolicy.move(
                CatalogFocus(CatalogFocusTarget.CARD, 2),
                CatalogControllerCommand.MOVE_RIGHT,
                itemCount = 8,
                columnCount = 3,
            ),
        )
        assertEquals(
            CatalogFocus(CatalogFocusTarget.CARD, 7),
            CatalogFocusPolicy.move(
                CatalogFocus(CatalogFocusTarget.CARD, 7),
                CatalogControllerCommand.MOVE_DOWN,
                itemCount = 8,
                columnCount = 3,
            ),
        )
        assertEquals(
            CatalogFocus(CatalogFocusTarget.SEARCH, 7),
            CatalogFocusPolicy.move(
                CatalogFocus(CatalogFocusTarget.SEARCH, 7),
                CatalogControllerCommand.MOVE_LEFT,
                itemCount = 8,
                columnCount = 3,
            ),
        )
    }

    @Test
    fun activationFollowsTheFocusedTarget() {
        assertEquals(
            CatalogActivation.ACTIVATE_CARD,
            CatalogFocusPolicy.activation(CatalogFocus(CatalogFocusTarget.CARD, 4), itemCount = 8),
        )
        assertEquals(
            CatalogActivation.FOCUS_SEARCH,
            CatalogFocusPolicy.activation(CatalogFocus(CatalogFocusTarget.SEARCH, 4), itemCount = 8),
        )
        assertEquals(
            CatalogActivation.REFRESH,
            CatalogFocusPolicy.activation(CatalogFocus(CatalogFocusTarget.REFRESH, 4), itemCount = 8),
        )
        assertNull(
            CatalogFocusPolicy.activation(CatalogFocus(CatalogFocusTarget.CARD, 0), itemCount = 0),
        )
    }

    @Test
    fun backClearsSearchBeforeLeavingTheLauncher() {
        assertEquals(
            CatalogBackDecision.CLEAR_SEARCH,
            CatalogFocusPolicy.backDecision(query = "race", searchInputFocused = false),
        )
        assertEquals(
            CatalogBackDecision.CLEAR_SEARCH,
            CatalogFocusPolicy.backDecision(query = "", searchInputFocused = true),
        )
        assertEquals(
            CatalogBackDecision.NAVIGATE_BACK,
            CatalogFocusPolicy.backDecision(query = "", searchInputFocused = false),
        )
    }

    private fun keyDown(keyCode: Int): CatalogControllerCommand? =
        CatalogAndroidKeyPolicy.command(
            keyCode = keyCode,
            action = AndroidCatalogKeyAction.DOWN,
            repeatCount = 0,
        )
}
