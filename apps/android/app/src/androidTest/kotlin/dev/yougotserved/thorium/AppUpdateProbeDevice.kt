package dev.yougotserved.thorium

import android.app.Instrumentation
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyEvent
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals

internal const val PROBE_TIMEOUT_MS = 30000L
private const val PROBE_POLL_MS = 50L
private const val PROBE_SCREENSHOT_SETTLE_MS = 250L

internal fun probeInstrumentation(): Instrumentation = InstrumentationRegistry.getInstrumentation()
internal fun probeApplication(): AppUpdateProbeApplication =
    probeInstrumentation().targetContext.applicationContext as AppUpdateProbeApplication

internal fun startUpdateProbe(): MainActivity {
    requireDisposableUpdateProbe()
    val application = probeApplication()
    assertEquals(AppUpdateLimits.PACKAGE_ID, application.packageName)
    assertEquals(10L, androidAppUpdateInstalled(application).version.versionCode)
    application.reset()
    val intent = Intent(application, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    return probeInstrumentation().startActivitySync(intent) as MainActivity
}

internal fun awaitProbeStage(stage: AppUpdateStage) {
    awaitProbe("Updater stage $stage") { probeApplication().state.get().stage == stage }
}

internal fun awaitProbe(description: String, ready: () -> Boolean) {
    val deadline = SystemClock.uptimeMillis() + PROBE_TIMEOUT_MS
    while (!ready() && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(PROBE_POLL_MS)
    check(ready()) { "Timed out waiting for $description" }
}

internal fun probeKey(code: Int) {
    val automation = probeInstrumentation().uiAutomation
    val now = SystemClock.uptimeMillis()
    val down = KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0, 0, -1, 0, 0, InputDevice.SOURCE_GAMEPAD)
    check(automation.injectInputEvent(down, true))
    check(automation.injectInputEvent(KeyEvent.changeAction(down, KeyEvent.ACTION_UP), true))
    probeInstrumentation().waitForIdleSync()
}

internal fun probeScreenshot(name: String) {
    probeInstrumentation().waitForIdleSync()
    SystemClock.sleep(PROBE_SCREENSHOT_SETTLE_MS)
    val bitmap = requireNotNull(probeInstrumentation().uiAutomation.takeScreenshot())
    val directory = File(probeApplication().filesDir, "update-probe").apply { mkdirs() }
    File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    bitmap.recycle()
}

internal fun probeReceipt(): AppUpdateProbeReceipt = requireNotNull(
    probeApplication().receipts.poll(PROBE_TIMEOUT_MS, TimeUnit.MILLISECONDS),
) { "No Android PackageInstaller callback received" }

internal fun probeReport(message: String) {
    probeInstrumentation().sendStatus(0, Bundle().apply { putString("stream", "UPDATER_PROBE: $message\n") })
}
