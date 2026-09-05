package dev.yougotserved.thorium

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ControllerInputPolicyTest {
    @Test
    fun southButtonEmitsOnePressedAndReleasedPairWithMonotonicSequences() {
        val policy = ControllerInputPolicy(SouthButtonBinding(playerSlot = 0, controlId = "tap"))

        val pressed = policy.acceptSouth(ControllerKeyInput(ControllerKeyPhase.DOWN, 0))
        val repeated = policy.acceptSouth(ControllerKeyInput(ControllerKeyPhase.DOWN, 1))
        val duplicate = policy.acceptSouth(ControllerKeyInput(ControllerKeyPhase.DOWN, 0))
        val released = policy.acceptSouth(ControllerKeyInput(ControllerKeyPhase.UP, 0))
        val duplicateRelease = policy.acceptSouth(ControllerKeyInput(ControllerKeyPhase.UP, 0))

        assertEquals("pressed", pressed.control?.phase)
        assertEquals(0L, pressed.control?.sequence)
        assertNull(repeated.control)
        assertNull(duplicate.control)
        assertEquals("released", released.control?.phase)
        assertEquals(1L, released.control?.sequence)
        assertNull(duplicateRelease.control)
        assertTrue(listOf(pressed, repeated, duplicate, released, duplicateRelease).all { it.handled })
    }

    @Test
    fun noBindingLeavesTheSouthButtonUnhandled() {
        val decision = ControllerInputPolicy(null).acceptSouth(
            ControllerKeyInput(ControllerKeyPhase.DOWN, 0),
        )

        assertFalse(decision.handled)
        assertNull(decision.control)
    }

    @Test
    fun androidTranslationAcceptsOnlySouthButtonDownAndUp() {
        assertEquals(
            ControllerKeyPhase.DOWN,
            AndroidControllerInput.translate(
                KeyEvent.KEYCODE_BUTTON_A,
                KeyEvent.ACTION_DOWN,
                0,
            )?.phase,
        )
        assertEquals(
            ControllerKeyPhase.UP,
            AndroidControllerInput.translate(
                KeyEvent.KEYCODE_BUTTON_A,
                KeyEvent.ACTION_UP,
                0,
            )?.phase,
        )
        assertNull(
            AndroidControllerInput.translate(
                KeyEvent.KEYCODE_VOLUME_UP,
                KeyEvent.ACTION_DOWN,
                0,
            ),
        )
        assertNull(
            AndroidControllerInput.translate(
                KeyEvent.KEYCODE_BUTTON_A,
                KeyEvent.ACTION_MULTIPLE,
                0,
            ),
        )
    }

    @Test
    fun southButtonBindingComesFromPackageDeclaredControlsInsteadOfPackageIdentity() {
        val release = TestPackages.valid().release
        val renamed = release.copy(
            manifest = release.manifest.copy(
                packageId = "dev.yougotserved.any-game",
                controls = listOf(
                    ReleaseControl("aim", "Aim", "axis"),
                    ReleaseControl("launch", "Launch", "button"),
                ),
            ),
        )
        val axisOnly = renamed.copy(
            manifest = renamed.manifest.copy(
                controls = listOf(ReleaseControl("aim", "Aim", "axis")),
            ),
        )

        assertEquals("launch", CatalogBindings.southButton(renamed)?.controlId)
        assertEquals(0, CatalogBindings.southButton(renamed)?.playerSlot)
        assertNull(CatalogBindings.southButton(axisOnly))
    }
}
