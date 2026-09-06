package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CatalogStickStateTest {
    @Test
    fun deflectionDoesNotMutateThePreviousSnapshot() {
        val initial = CatalogStickState()
        val result = reduceCatalogStick(initial, CatalogStickSample(1f, 0f, 0))

        assertEquals(CatalogStickState(), initial)
        assertEquals(CatalogControllerCommand.MOVE_RIGHT, result.command)
        assertEquals(CatalogStickState(CatalogControllerCommand.MOVE_RIGHT, 360), result.state)
    }

    @Test
    fun releaseAndActivationBoundariesPreserveHysteresis() {
        val active = CatalogStickState(CatalogControllerCommand.MOVE_RIGHT, 360)
        val between = reduceCatalogStick(active, CatalogStickSample(0.5f, 0f, 100))
        val released = reduceCatalogStick(between.state, CatalogStickSample(0.34f, 0f, 101))
        val reactivated = reduceCatalogStick(released.state, CatalogStickSample(0.62f, 0f, 102))

        assertEquals(active, between.state)
        assertNull(between.command)
        assertEquals(CatalogStickState(), released.state)
        assertEquals(CatalogControllerCommand.MOVE_RIGHT, reactivated.command)
        assertEquals(CatalogStickState(CatalogControllerCommand.MOVE_RIGHT, 462), reactivated.state)
    }

    @Test
    fun equalAxesUseVerticalAndRepeatedFramesKeepTheDeadline() {
        val first = reduceCatalogStick(CatalogStickState(), CatalogStickSample(1f, -1f, 0))
        val early = reduceCatalogStick(first.state, CatalogStickSample(1f, -1f, 359))
        val repeat = reduceCatalogStick(early.state, CatalogStickSample(1f, -1f, 360))

        assertEquals(CatalogControllerCommand.MOVE_UP, first.command)
        assertEquals(first.state, early.state)
        assertNull(early.command)
        assertEquals(CatalogControllerCommand.MOVE_UP, repeat.command)
        assertEquals(CatalogStickState(CatalogControllerCommand.MOVE_UP, 480), repeat.state)
    }
}
