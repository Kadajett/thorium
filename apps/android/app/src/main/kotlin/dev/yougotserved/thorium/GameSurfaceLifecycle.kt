package dev.yougotserved.thorium

/** Keeps WebView rendering tied to Activity visibility, independently of input focus. */
internal class GameSurfaceLifecycle(
    private val resumeSurface: () -> Unit,
    private val pauseSurface: () -> Unit,
) {
    private var visible = false
    private var active = false

    fun onStart() {
        visible = true
        activate()
    }

    fun onResume() {
        activate()
    }

    fun onPause() {
        // Another display can take input focus while this surface remains visible.
        // onStop, not onPause, is the visibility boundary for rendering.
    }

    fun onStop() {
        visible = false
        suspendSurface()
    }

    fun onSurfaceReplaced() {
        active = false
        activate()
    }

    private fun activate() {
        if (!visible || active) return
        resumeSurface()
        active = true
    }

    private fun suspendSurface() {
        if (!active) return
        pauseSurface()
        active = false
    }
}
