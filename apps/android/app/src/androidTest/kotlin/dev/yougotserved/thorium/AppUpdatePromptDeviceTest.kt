package dev.yougotserved.thorium

import android.view.KeyEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppUpdatePromptDeviceTest {
    @Test fun actualLauncherAAndBDismissWithoutStartingDownloadOrMovingCatalogFocus() {
        val activity = startUpdateProbe()
        try {
            awaitProbeText("Sync")
            val initialFocus = probeFocusedBounds()
            probeKey(KeyEvent.KEYCODE_DPAD_DOWN)
            awaitProbe("catalog focus moved before showing update") { probeFocusedBounds() != initialFocus }
            val focus = probeFocusedBounds()
            probeApplication().discovery.countDown()
            awaitProbeStage(AppUpdateStage.AVAILABLE)
            awaitProbeText(appUpdateHeading(AppUpdateStage.AVAILABLE))
            assertEquals(1, probeApplication().state.get().selected)
            probeScreenshot("prompt-default-not-now")
            probeKey(KeyEvent.KEYCODE_BUTTON_A)
            awaitProbeStage(AppUpdateStage.HIDDEN)
            assertEquals(0, probeApplication().downloads.get())
            assertEquals(focus, probeFocusedBounds())
            probeReport("Actual MainActivity default A dismissed; no download; catalog focus $focus preserved")
        } finally { probeInstrumentation().runOnMainSync { activity.finish() } }
    }

    @Test fun actualLauncherDpadSelectsDownloadButBCancelsWithoutDownloading() {
        val activity = startUpdateProbe()
        try {
            probeApplication().discovery.countDown()
            awaitProbeStage(AppUpdateStage.AVAILABLE)
            awaitProbeText(appUpdateHeading(AppUpdateStage.AVAILABLE))
            probeKey(KeyEvent.KEYCODE_DPAD_LEFT)
            awaitProbe("download button selected") { probeApplication().state.get().selected == 0 }
            probeScreenshot("prompt-download-selected")
            probeKey(KeyEvent.KEYCODE_BUTTON_B)
            awaitProbeStage(AppUpdateStage.HIDDEN)
            assertEquals(0, probeApplication().downloads.get())
            probeReport("Actual MainActivity D-pad selects download; B cancels with zero downloads")
        } finally { probeInstrumentation().runOnMainSync { activity.finish() } }
    }
}
