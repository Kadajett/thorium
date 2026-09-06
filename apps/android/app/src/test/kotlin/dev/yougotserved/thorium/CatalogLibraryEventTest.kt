package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class CatalogLibraryEventTest {
    private val layout = CatalogGridLayout(8, 3)

    @Test
    fun touchAndControllerActivationProduceTheSameGameIntent() {
        val initial = CatalogLibraryState(focus = CatalogFocus(cardIndex = 4))
        val touch = reduceCatalogEvent(initial, CatalogLibraryEvent.OpenCard(4), layout)
        val controller = reduceCatalogEvent(
            initial, CatalogLibraryEvent.Controller(CatalogControllerCommand.ACTIVATE), layout,
        )
        assertEquals(controller, touch)
    }

    @Test
    fun staleTouchCannotOpenAnAbsentGame() {
        val initial = CatalogLibraryState()
        assertEquals(
            CatalogLibraryTransition(initial), reduceCatalogEvent(initial, CatalogLibraryEvent.OpenCard(8), layout),
        )
    }

    @Test
    fun utilityFocusRetainsTheMostRecentCardWithoutStartingEditing() {
        val initial = CatalogLibraryState()
        val moved = reduceCatalogEvent(initial, CatalogLibraryEvent.Focused(CatalogFocus(cardIndex = 5)), layout)
        val utility = reduceCatalogEvent(
            moved.state, CatalogLibraryEvent.UtilityFocused(CatalogFocusTarget.SEARCH), layout,
        )
        assertEquals(CatalogFocus(CatalogFocusTarget.SEARCH, 5), utility.state.focus)
        assertFalse(utility.state.searchEditing)
        assertEquals(CatalogLibraryEffect.None, utility.effect)
    }

    @Test
    fun submittingSearchUsesTheLatestTypedQueryAndClosesOnlyTheEditor() {
        val initial = CatalogLibraryState(focus = CatalogFocus(cardIndex = 2))
        val editing = reduceCatalogEvent(initial, CatalogLibraryEvent.BeginSearch, layout)
        val typed = reduceCatalogEvent(editing.state, CatalogLibraryEvent.QueryChanged("Cinder"), layout)
        val submitted = reduceCatalogEvent(typed.state, CatalogLibraryEvent.SubmitSearch, layout)
        assertEquals("Cinder", submitted.state.query)
        assertFalse(submitted.state.searchEditing)
        assertEquals(CatalogFocus(CatalogFocusTarget.SEARCH, 2), submitted.state.focus)
        assertEquals(CatalogLibraryEffect.Search("Cinder"), submitted.effect)
        assertEquals("", initial.query)
    }
}
