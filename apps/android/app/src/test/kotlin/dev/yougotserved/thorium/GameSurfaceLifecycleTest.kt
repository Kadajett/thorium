package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Test

class GameSurfaceLifecycleTest {
    @Test
    fun openingCompanionDoesNotSuspendVisibleMainAndEitherSurfaceCanRegainFocus() {
        val mainCalls = mutableListOf<String>()
        val companionCalls = mutableListOf<String>()
        val main = lifecycle(mainCalls)
        val companion = lifecycle(companionCalls)

        main.onStart()
        main.onResume()
        main.onPause()
        companion.onStart()
        companion.onResume()

        assertEquals(listOf("active"), mainCalls)
        assertEquals(listOf("active"), companionCalls)

        companion.onPause()
        main.onResume()
        assertEquals(listOf("active"), mainCalls)
        assertEquals(listOf("active"), companionCalls)
    }

    @Test
    fun stopSuspendsExactlyOnceAndRestartReactivates() {
        val calls = mutableListOf<String>()
        val lifecycle = lifecycle(calls)
        lifecycle.onStart()
        lifecycle.onResume()
        lifecycle.onPause()
        assertEquals(listOf("active"), calls)
        lifecycle.onStop()
        lifecycle.onStop()
        assertEquals(listOf("active", "suspended"), calls)
        lifecycle.onStart()
        lifecycle.onResume()
        assertEquals(listOf("active", "suspended", "active"), calls)
    }

    @Test
    fun replacementSurfaceIsActivatedWhileVisibleEvenWithoutAnotherStart() {
        val calls = mutableListOf<String>()
        val lifecycle = lifecycle(calls)
        lifecycle.onSurfaceReplaced()
        assertEquals(emptyList<String>(), calls)
        lifecycle.onStart()
        lifecycle.onResume()
        lifecycle.onPause()
        lifecycle.onSurfaceReplaced()
        lifecycle.onResume()
        assertEquals(listOf("active", "active"), calls)
        lifecycle.onStop()
        lifecycle.onSurfaceReplaced()
        assertEquals(listOf("active", "active", "suspended"), calls)
        lifecycle.onStart()
        assertEquals(listOf("active", "active", "suspended", "active"), calls)
    }

    private fun lifecycle(calls: MutableList<String>) = GameSurfaceLifecycle(
        resumeSurface = { calls.add("active") },
        pauseSurface = { calls.add("suspended") },
    )
}
