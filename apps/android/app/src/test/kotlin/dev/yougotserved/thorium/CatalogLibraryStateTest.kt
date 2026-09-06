package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogLibraryStateTest {
    private val layout = CatalogGridLayout(itemCount = 8, columnCount = 3)

    @Test
    fun movingThroughSearchDoesNotOpenTheEditor() {
        val original = CatalogLibraryState(focus = CatalogFocus(cardIndex = 1))
        val search = reduceCatalogCommand(original, CatalogControllerCommand.MOVE_UP, layout)
        val refresh = reduceCatalogCommand(search.state, CatalogControllerCommand.MOVE_RIGHT, layout)
        val card = reduceCatalogCommand(refresh.state, CatalogControllerCommand.MOVE_DOWN, layout)

        assertEquals(CatalogFocusTarget.SEARCH, search.state.focus.target)
        assertFalse(search.state.searchEditing)
        assertEquals(CatalogFocusTarget.REFRESH, refresh.state.focus.target)
        assertEquals(original, card.state)
        assertEquals(CatalogLibraryEffect.None, card.effect)
        assertEquals(CatalogFocus(cardIndex = 1), original.focus)
    }

    @Test
    fun activationUsesTheSelectedCardAndNeverClampsToAnotherGame() {
        val selected = CatalogLibraryState(focus = CatalogFocus(cardIndex = 4))
        val valid = reduceCatalogCommand(selected, CatalogControllerCommand.ACTIVATE, layout)
        val stale = reduceCatalogCommand(
            selected, CatalogControllerCommand.ACTIVATE, CatalogGridLayout(2, 3),
        )

        assertEquals(selected, valid.state)
        assertEquals(CatalogLibraryEffect.OpenCard(4), valid.effect)
        assertEquals(CatalogLibraryEffect.None, stale.effect)
    }

    @Test
    fun searchOpensOnlyOnExplicitActivationOrSearchCommand() {
        val selected = CatalogLibraryState(focus = CatalogFocus(CatalogFocusTarget.SEARCH, 2))
        val activate = reduceCatalogCommand(selected, CatalogControllerCommand.ACTIVATE, layout)
        val shortcut = reduceCatalogCommand(CatalogLibraryState(), CatalogControllerCommand.SEARCH, layout)

        assertTrue(activate.state.searchEditing)
        assertEquals(selected.focus, activate.state.focus)
        assertTrue(shortcut.state.searchEditing)
        assertEquals(CatalogFocusTarget.SEARCH, shortcut.state.focus.target)
        assertEquals(CatalogLibraryEffect.None, shortcut.effect)
        assertFalse(selected.searchEditing)
    }

    @Test
    fun navigationDoesNotStealFocusWhileEditing() {
        val editing = beginCatalogSearch(CatalogLibraryState(query = "Cinder"))
        val movements = listOf(
            CatalogControllerCommand.MOVE_UP, CatalogControllerCommand.MOVE_DOWN,
            CatalogControllerCommand.MOVE_LEFT, CatalogControllerCommand.MOVE_RIGHT,
        )
        movements.forEach { command ->
            assertEquals(CatalogLibraryTransition(editing), reduceCatalogCommand(editing, command, layout))
        }
    }

    @Test
    fun backClearsSearchBeforeNavigatingBack() {
        val initial = beginCatalogSearch(CatalogLibraryState(query = "Cinder"))
        val cleared = reduceCatalogCommand(initial, CatalogControllerCommand.BACK_OR_CLEAR, layout)
        val back = reduceCatalogCommand(cleared.state, CatalogControllerCommand.BACK_OR_CLEAR, layout)

        assertEquals("", cleared.state.query)
        assertFalse(cleared.state.searchEditing)
        assertEquals(initial.focus, cleared.state.focus)
        assertEquals(CatalogLibraryEffect.Search(""), cleared.effect)
        assertEquals(CatalogLibraryEffect.NavigateBack, back.effect)
        assertEquals("Cinder", initial.query)
    }

    @Test
    fun backExitsAnEmptySearchEditorWithoutNavigating() {
        val editing = beginCatalogSearch(CatalogLibraryState())
        val result = reduceCatalogCommand(editing, CatalogControllerCommand.BACK_OR_CLEAR, layout)

        assertFalse(result.state.searchEditing)
        assertEquals(CatalogLibraryEffect.Search(""), result.effect)
    }

    @Test
    fun refreshUsesTheCurrentQueryAndKeepsSelection() {
        val selected = CatalogLibraryState("Serpent", CatalogFocus(CatalogFocusTarget.REFRESH, 2))
        val activated = reduceCatalogCommand(selected, CatalogControllerCommand.ACTIVATE, layout)
        val shortcut = reduceCatalogCommand(selected, CatalogControllerCommand.REFRESH, layout)

        assertEquals(CatalogLibraryTransition(selected, CatalogLibraryEffect.Search("Serpent")), activated)
        assertEquals(activated, shortcut)
    }

    @Test
    fun emptyCatalogCanReachSearchButCannotOpenAGame() {
        val empty = CatalogGridLayout(0, 3)
        val activate = reduceCatalogCommand(CatalogLibraryState(), CatalogControllerCommand.ACTIVATE, empty)
        val move = reduceCatalogCommand(CatalogLibraryState(), CatalogControllerCommand.MOVE_UP, empty)

        assertEquals(CatalogLibraryEffect.None, activate.effect)
        assertEquals(CatalogFocusTarget.SEARCH, move.state.focus.target)
        assertFalse(move.state.searchEditing)
    }
}
