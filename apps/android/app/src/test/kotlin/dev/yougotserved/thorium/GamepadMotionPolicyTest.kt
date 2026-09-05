package dev.yougotserved.thorium

import android.view.InputDevice
import android.view.MotionEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GamepadMotionPolicyTest {
    @Test
    fun claimsGamepadAndJoystickMovesIncludingNeutralWithoutTakingMouseOrTouch() {
        for (source in listOf(InputDevice.SOURCE_JOYSTICK, InputDevice.SOURCE_GAMEPAD, InputDevice.SOURCE_DPAD,
            InputDevice.SOURCE_JOYSTICK or InputDevice.SOURCE_GAMEPAD)) {
            assertTrue(GamepadMotionPolicy.recognizes(source, MotionEvent.ACTION_MOVE))
            assertFalse(GamepadMotionPolicy.recognizes(source, MotionEvent.ACTION_SCROLL))
        }
        assertFalse(GamepadMotionPolicy.recognizes(InputDevice.SOURCE_MOUSE, MotionEvent.ACTION_MOVE))
        assertFalse(GamepadMotionPolicy.recognizes(InputDevice.SOURCE_TOUCHSCREEN, MotionEvent.ACTION_MOVE))
    }

    @Test
    fun hatInputNavigatesExplicitFocusAndActivationUsesTheSelectedCard() {
        val navigator = CatalogStickNavigator()
        val axes = GamepadMotionPolicy.axes(0f, 0f, 1f, 0f)
        val command = navigator.command(axes.horizontal, axes.vertical, 1)
        assertEquals(CatalogControllerCommand.MOVE_RIGHT, command)
        val focus = CatalogFocusPolicy.move(CatalogFocus(), requireNotNull(command), 8, 3)
        assertEquals(CatalogFocus(CatalogFocusTarget.CARD, 1), focus)
        assertEquals(CatalogActivation.ACTIVATE_CARD, CatalogFocusPolicy.activation(focus, 8))
        assertEquals(CatalogControllerCommand.ACTIVATE, CatalogAndroidKeyPolicy.command(96, 0, 0))
    }

    @Test
    fun digitalHatWinsOverStickAndInvalidSamplesCannotCrashNavigation() {
        assertEquals(GamepadAxes(0f, -1f), GamepadMotionPolicy.axes(0.8f, 0.7f, 0f, -1f))
        assertEquals(GamepadAxes(0.8f, 0.7f), GamepadMotionPolicy.axes(0.8f, 0.7f, 0f, 0f))
        assertEquals(GamepadAxes(0f, 0f), GamepadMotionPolicy.axes(Float.NaN, Float.POSITIVE_INFINITY, 0f, 0f))
        assertEquals(GamepadAxes(1f, -1f), GamepadMotionPolicy.axes(4f, -4f, 0f, 0f))
    }
}
