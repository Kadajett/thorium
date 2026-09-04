package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DisplayPolicyTest {
    @Test
    fun choosesSmallestAllowedNonCurrentDisplay() {
        val displays = listOf(
            DisplayProfile(0, 1920, 1080, true),
            DisplayProfile(2, 1600, 900, false),
            DisplayProfile(3, 1240, 1080, true),
        )

        assertEquals(3, DisplayPolicy.chooseCompanion(0, displays)?.id)
    }

    @Test
    fun returnsNullWithoutEligibleCompanion() {
        val displays = listOf(DisplayProfile(0, 1920, 1080, true))

        assertNull(DisplayPolicy.chooseCompanion(0, displays))
    }

    @Test
    fun comparesDisplayAreaAndRejectsInvalidDimensions() {
        val displays = listOf(
            DisplayProfile(1, 900, 1600, true),
            DisplayProfile(2, 1280, 720, true),
            DisplayProfile(3, 0, 1, true),
        )

        assertEquals(2, DisplayPolicy.chooseCompanion(0, displays)?.id)
    }
}
