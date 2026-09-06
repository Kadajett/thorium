package dev.yougotserved.thorium

import android.content.Context
import android.content.pm.PackageInstaller
import android.view.KeyEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppUpdateInstallerDeviceTest {
    @Test fun realAndroidConfirmationIsShownAndCancelledWithoutReplacingInstalledApp() {
        requireDisposableUpdateProbe()
        val application = probeApplication()
        val sentinel = application.getSharedPreferences("update-probe-sentinel", Context.MODE_PRIVATE)
        check(sentinel.edit().putString("save", "keep-version10-save").commit())
        val activity = startUpdateProbe()
        try {
            prepareProbeUpdate()
            allowProbeSourceThroughVisibleSettings()
            submitAndCancelProbeUpdate()
            assertEquals(10L, androidAppUpdateInstalled(application).version.versionCode)
            assertEquals("keep-version10-save", sentinel.getString("save", null))
            assertEquals(APP_UPDATE_NO_SESSION, appUpdatePreferences(application)
                .getInt(APP_UPDATE_PENDING_KEY, APP_UPDATE_NO_SESSION))
            probeScreenshot("cancelled-version10-preserved")
            probeReport("Android update cancelled; code10, sentinel save, and cleared pending session verified")
        } finally { probeInstrumentation().runOnMainSync { activity.finish() } }
    }
}

private fun prepareProbeUpdate() {
    probeApplication().discovery.countDown()
    awaitProbeStage(AppUpdateStage.AVAILABLE)
    probeKey(KeyEvent.KEYCODE_DPAD_LEFT)
    probeKey(KeyEvent.KEYCODE_BUTTON_A)
    awaitProbeStage(AppUpdateStage.READY)
    assertEquals(1, probeApplication().downloads.get())
    probeScreenshot("actual-apk-verified")
}

private fun allowProbeSourceThroughVisibleSettings() {
    val application = probeApplication()
    assertFalse(application.packageManager.canRequestPackageInstalls())
    probeKey(KeyEvent.KEYCODE_DPAD_LEFT)
    probeKey(KeyEvent.KEYCODE_BUTTON_A)
    awaitProbeStage(AppUpdateStage.PERMISSION)
    probeKey(KeyEvent.KEYCODE_DPAD_LEFT)
    probeKey(KeyEvent.KEYCODE_BUTTON_A)
    val permission = awaitProbeText("Allow from this source")
    probeScreenshot("android-unknown-source-permission")
    probeTap(permission)
    awaitProbe("user-visible permission grant") { application.packageManager.canRequestPackageInstalls() }
    probeKey(KeyEvent.KEYCODE_BACK)
    awaitProbeStage(AppUpdateStage.READY)
    assertEquals(1, application.state.get().selected)
    assertEquals(0, application.receipts.size)
    probeReport("Unknown-source permission granted only by visible Settings tap; return did not install")
}

private fun submitAndCancelProbeUpdate() {
    probeKey(KeyEvent.KEYCODE_DPAD_LEFT)
    probeKey(KeyEvent.KEYCODE_BUTTON_A)
    val pending = probeReceipt()
    assertEquals(PackageInstaller.STATUS_PENDING_USER_ACTION, pending.status)
    val cancel = awaitProbeSystemCancel()
    probeScreenshot("android-installation-confirmation")
    probeReport("Real STATUS_PENDING_USER_ACTION session=${pending.sessionId}; Android confirmation visible")
    probeTap(cancel)
    val result = probeReceipt()
    assertEquals(pending.sessionId, result.sessionId)
    assertEquals(PackageInstaller.STATUS_FAILURE_ABORTED, result.status)
    awaitProbeStage(AppUpdateStage.FAILED)
    probeReport("Real STATUS_FAILURE_ABORTED callback session=${result.sessionId}")
}
