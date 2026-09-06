package dev.yougotserved.thorium

import android.graphics.Rect
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.accessibility.AccessibilityNodeInfo

internal fun probeVisibleText(text: String): AccessibilityNodeInfo? =
    probeInstrumentation().uiAutomation.rootInActiveWindow?.let { probeFindText(it, text) }

private fun probeFindText(root: AccessibilityNodeInfo, text: String): AccessibilityNodeInfo? {
    return probeFind(root) { node ->
        val label = "${node.text?.toString().orEmpty()} ${node.contentDescription?.toString().orEmpty()}"
        label.contains(text, ignoreCase = true)
    }
}

private fun probeFind(
    root: AccessibilityNodeInfo,
    matches: (AccessibilityNodeInfo) -> Boolean,
): AccessibilityNodeInfo? {
    val pending = ArrayDeque<AccessibilityNodeInfo>()
    pending.add(root)
    while (pending.isNotEmpty()) {
        val node = pending.removeFirst()
        if (matches(node)) return node
        for (index in 0 until node.childCount) node.getChild(index)?.let(pending::add)
    }
    return null
}

internal fun awaitProbeSystemCancel(): AccessibilityNodeInfo {
    awaitProbe("Android installer Cancel button") { probeSystemCancel() != null }
    return requireNotNull(probeSystemCancel())
}

private fun probeSystemCancel(): AccessibilityNodeInfo? {
    val root = probeInstrumentation().uiAutomation.rootInActiveWindow ?: return null
    return if (root.packageName?.toString() == "com.google.android.packageinstaller") {
        probeFind(root) { it.text?.toString() == "Cancel" && it.isClickable }
    } else { null }
}

internal fun awaitProbeText(text: String): AccessibilityNodeInfo {
    awaitProbe("visible text $text") { probeVisibleText(text) != null }
    return requireNotNull(probeVisibleText(text))
}

internal fun probeTap(node: AccessibilityNodeInfo) {
    val bounds = Rect().also(node::getBoundsInScreen)
    val now = SystemClock.uptimeMillis()
    val down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN,
        bounds.exactCenterX(), bounds.exactCenterY(), 0)
    down.source = InputDevice.SOURCE_TOUCHSCREEN
    val up = MotionEvent.obtain(down).apply { action = MotionEvent.ACTION_UP }
    check(probeInstrumentation().uiAutomation.injectInputEvent(down, true))
    check(probeInstrumentation().uiAutomation.injectInputEvent(up, true))
    down.recycle()
    up.recycle()
}

internal fun probeFocusedBounds(): String {
    awaitProbe("focused catalog node") { currentProbeFocus() != null }
    return requireNotNull(currentProbeFocus())
}

private fun currentProbeFocus(): String? {
    val root = probeInstrumentation().uiAutomation.rootInActiveWindow
    val focused = root?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return null
    return Rect().also(focused::getBoundsInScreen).toShortString()
}
