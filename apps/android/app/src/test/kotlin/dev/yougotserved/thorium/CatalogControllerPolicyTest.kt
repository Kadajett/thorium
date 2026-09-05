package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogControllerPolicyTest {
    @Test
    fun mapsGamepadButtonsToLauncherCommands() {
        assertEquals(
            CatalogControllerCommand.MOVE_UP,
            command(CatalogControllerKey.DPAD_UP),
        )
        assertEquals(
            CatalogControllerCommand.MOVE_DOWN,
            command(CatalogControllerKey.DPAD_DOWN),
        )
        assertEquals(
            CatalogControllerCommand.MOVE_LEFT,
            command(CatalogControllerKey.DPAD_LEFT),
        )
        assertEquals(
            CatalogControllerCommand.MOVE_RIGHT,
            command(CatalogControllerKey.DPAD_RIGHT),
        )
        assertEquals(
            CatalogControllerCommand.ACTIVATE,
            command(CatalogControllerKey.BUTTON_A),
        )
        assertEquals(
            CatalogControllerCommand.SEARCH,
            command(CatalogControllerKey.BUTTON_X),
        )
        assertEquals(
            CatalogControllerCommand.REFRESH,
            command(CatalogControllerKey.BUTTON_Y),
        )
        assertEquals(
            CatalogControllerCommand.BACK_OR_CLEAR,
            command(CatalogControllerKey.BUTTON_B),
        )
    }

    @Test
    fun ignoresButtonReleaseAndRepeatedOneShotActions() {
        assertNull(
            CatalogControllerPolicy.command(
                CatalogControllerInput(
                    key = CatalogControllerKey.BUTTON_A,
                    phase = ControllerKeyPhase.UP,
                    repeatCount = 0,
                ),
            ),
        )
        assertNull(
            CatalogControllerPolicy.command(
                CatalogControllerInput(
                    key = CatalogControllerKey.BUTTON_Y,
                    phase = ControllerKeyPhase.DOWN,
                    repeatCount = 1,
                ),
            ),
        )
        assertEquals(
            CatalogControllerCommand.MOVE_DOWN,
            CatalogControllerPolicy.command(
                CatalogControllerInput(
                    key = CatalogControllerKey.DPAD_DOWN,
                    phase = ControllerKeyPhase.DOWN,
                    repeatCount = 3,
                ),
            ),
        )
    }

    @Test
    fun movesWithinRowsAndColumnsWithoutWrapping() {
        assertEquals(5, CatalogControllerPolicy.moveSelection(2, 8, 3, CatalogControllerCommand.MOVE_DOWN))
        assertEquals(2, CatalogControllerPolicy.moveSelection(5, 8, 3, CatalogControllerCommand.MOVE_UP))
        assertEquals(4, CatalogControllerPolicy.moveSelection(3, 8, 3, CatalogControllerCommand.MOVE_RIGHT))
        assertEquals(3, CatalogControllerPolicy.moveSelection(3, 8, 3, CatalogControllerCommand.MOVE_LEFT))
        assertEquals(2, CatalogControllerPolicy.moveSelection(2, 8, 3, CatalogControllerCommand.MOVE_RIGHT))
        assertEquals(7, CatalogControllerPolicy.moveSelection(7, 8, 3, CatalogControllerCommand.MOVE_DOWN))
    }

    @Test
    fun backClearsSearchBeforeLeavingTheLauncher() {
        assertEquals(
            CatalogBackDecision.CLEAR_SEARCH,
            CatalogControllerPolicy.backDecision(query = "race", searchFocused = false),
        )
        assertEquals(
            CatalogBackDecision.CLEAR_SEARCH,
            CatalogControllerPolicy.backDecision(query = "", searchFocused = true),
        )
        assertEquals(
            CatalogBackDecision.NAVIGATE_BACK,
            CatalogControllerPolicy.backDecision(query = "", searchFocused = false),
        )
    }

    @Test
    fun selectedCardOwnsVisibleFocusUntilSearchTakesFocus() {
        assertTrue(CatalogControllerPolicy.isCardFocused(selected = 2, index = 2, searchFocused = false))
        assertFalse(CatalogControllerPolicy.isCardFocused(selected = 2, index = 1, searchFocused = false))
        assertFalse(CatalogControllerPolicy.isCardFocused(selected = 2, index = 2, searchFocused = true))
    }

    private fun command(key: CatalogControllerKey): CatalogControllerCommand? =
        CatalogControllerPolicy.command(
            CatalogControllerInput(
                key = key,
                phase = ControllerKeyPhase.DOWN,
                repeatCount = 0,
            ),
        )
}
