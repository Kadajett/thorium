package dev.yougotserved.thorium

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogPresentationPolicyTest {
    @Test
    fun logicalWidthsKeepTheExistingCardDensityAndSearchSize() {
        assertEquals(CatalogScreenLayout(CatalogGridLayout(8, 3), 250.dp), catalogScreenLayout(960.dp, 8))
        assertEquals(CatalogScreenLayout(CatalogGridLayout(8, 2), 186.dp), catalogScreenLayout(620.dp, 8))
        assertEquals(CatalogScreenLayout(CatalogGridLayout(0, 1), 168.dp), catalogScreenLayout(320.dp, 0))
    }

    @Test
    fun coverInitialsKeepWhitespaceAndEmptyTitleBehavior() {
        assertEquals("CF", catalogCardInitials("  Cinder   Forge Academy "))
        assertEquals("S", catalogCardInitials("Serpent"))
        assertEquals("?", catalogCardInitials("  "))
    }

    @Test
    fun installingIsTheOnlyDisabledCardState() {
        val game = TestPackages.installedGame()
        CatalogActionState.entries.forEach { state ->
            assertEquals(state != CatalogActionState.INSTALLING, catalogCardAction(CatalogItem(game, state)).enabled)
        }
        assertEquals("Play · Ready", catalogCardAction(CatalogItem(game, CatalogActionState.INSTALLED)).label)
        assertEquals("Play", catalogCardAction(CatalogItem(game, CatalogActionState.AVAILABLE)).label)
        assertEquals(game.accent, catalogCardAction(CatalogItem(game, CatalogActionState.AVAILABLE)).color)
    }

    @Test
    fun catalogFilteringMatchesTitlesAndTaglinesWithoutChangingReleaseKeys() {
        val game = TestPackages.installedGame().copy(title = "Cinder", tagline = "Learn card duels")
        val item = CatalogItem(game, CatalogActionState.INSTALLED)
        assertTrue(catalogQueryMatches(item, "CINDER"))
        assertTrue(catalogQueryMatches(item, "duel"))
        assertTrue(catalogQueryMatches(item, "   "))
        assertFalse(catalogQueryMatches(item, "snake"))
        assertEquals("${game.packageId}:${game.contentDigest}", catalogItemKey(item))
    }
}
