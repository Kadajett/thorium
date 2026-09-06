package dev.yougotserved.thorium

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogUtilityFocusPolicyTest {
    @Test
    fun loadingAnEmptyListCannotMakeTheToolbarStealTheFirstCardSelection() {
        val state = CatalogLibraryState()
        val loading = state.copy(focus = CatalogFocusPolicy.normalized(state.focus, 0))
        assertFalse(catalogUtilityCanFocus(loading, CatalogFocusTarget.SEARCH))
        assertFalse(catalogUtilityCanFocus(loading, CatalogFocusTarget.REFRESH))
        val loaded = loading.copy(focus = CatalogFocusPolicy.normalized(loading.focus, 1))
        assertFalse(catalogUtilityCanFocus(loaded, CatalogFocusTarget.SEARCH))
    }

    @Test
    fun intentionalControllerNavigationCanFocusSearchAndActivateItsEditor() {
        val layout = CatalogGridLayout(1, 3)
        val search = reduceCatalogCommand(CatalogLibraryState(), CatalogControllerCommand.MOVE_UP, layout).state
        assertTrue(catalogUtilityCanFocus(search, CatalogFocusTarget.SEARCH))
        assertFalse(catalogUtilityCanFocus(search, CatalogFocusTarget.REFRESH))
        val editing = reduceCatalogCommand(search, CatalogControllerCommand.ACTIVATE, layout).state
        assertTrue(editing.searchEditing)
        assertFalse(catalogUtilityCanFocus(editing, CatalogFocusTarget.SEARCH))
    }
}
