package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateCallbackTest {
    @Test fun callbackRequiresExactActionAndTrackedSession() {
        assertTrue(appUpdateCallbackMatches(APP_UPDATE_RESULT_ACTION, 7, 7))
        assertFalse(appUpdateCallbackMatches("foreign", 7, 7))
        assertFalse(appUpdateCallbackMatches(APP_UPDATE_RESULT_ACTION, 7, 8))
        assertFalse(appUpdateCallbackMatches(APP_UPDATE_RESULT_ACTION, -1, -1))
    }

    @Test fun installerCancellationEndsInstallingState() {
        val harness = AppUpdateHarness()
        harness.ready()
        harness.controller.confirm()
        harness.flush()
        harness.outcome = false
        harness.controller.resume()
        harness.flush()
        assertEquals(AppUpdateStage.FAILED, harness.state.stage)
        harness.controller.dismiss()
        assertEquals(AppUpdateStage.HIDDEN, harness.state.stage)
    }

    @Test fun outcomeArrivingDuringInstallIsConsumedAfterSubmission() {
        val harness = AppUpdateHarness()
        harness.ready()
        harness.outcome = false
        harness.controller.confirm()
        harness.controller.resume()
        harness.flush()
        assertEquals(AppUpdateStage.FAILED, harness.state.stage)
    }

    @Test fun stoppedLauncherCannotReceiveLatePromptOrStartNetworkCheck() {
        val harness = AppUpdateHarness()
        harness.controller.check()
        harness.controller.pause()
        harness.flush()
        assertEquals(AppUpdateStage.HIDDEN, harness.state.stage)
        harness.controller.check()
        assertEquals(0, harness.queue.size)
        harness.controller.resume()
        harness.available()
        assertEquals(AppUpdateStage.AVAILABLE, harness.state.stage)
    }
}
