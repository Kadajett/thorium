package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateControllerTest {
    @Test fun startupIsNonBlockingAndDefaultAOnlyDismisses() {
        val harness = AppUpdateHarness()
        harness.controller.check()
        assertEquals(AppUpdateStage.HIDDEN, harness.state.stage)
        assertEquals(1, harness.queue.size)
        harness.flush()
        assertTrue(harness.controller.control(CatalogControllerCommand.ACTIVATE))
        assertEquals(AppUpdateStage.HIDDEN, harness.state.stage)
        assertEquals(0, harness.downloads)
    }

    @Test fun promptInterceptsControlsAndRestoresCatalogRoutingAfterB() {
        val harness = AppUpdateHarness()
        harness.available()
        assertTrue(harness.controller.control(CatalogControllerCommand.MOVE_LEFT))
        assertEquals(0, harness.state.selected)
        assertTrue(harness.controller.control(CatalogControllerCommand.BACK_OR_CLEAR))
        assertFalse(harness.controller.control(CatalogControllerCommand.MOVE_RIGHT))
        assertEquals(0, harness.downloads)
    }

    @Test fun explicitDownloadThenSeparateInstallConsent() {
        val harness = AppUpdateHarness()
        harness.available()
        harness.controller.control(CatalogControllerCommand.MOVE_UP)
        harness.controller.control(CatalogControllerCommand.ACTIVATE)
        harness.flush()
        assertEquals(1, harness.downloads)
        assertEquals(0, harness.installs)
        assertEquals(AppUpdateStage.READY, harness.state.stage)
        harness.controller.confirm()
        harness.flush()
        assertEquals(1, harness.installs)
    }

    @Test fun permissionReturnDoesNotAutomaticallyInstall() {
        val harness = AppUpdateHarness()
        harness.permitted = false
        harness.ready()
        harness.controller.confirm()
        harness.flush()
        assertEquals(AppUpdateStage.PERMISSION, harness.state.stage)
        assertEquals(0, harness.settings)
        harness.controller.confirm()
        assertEquals(1, harness.settings)
        harness.permitted = true
        harness.controller.resume()
        harness.flush()
        assertEquals(AppUpdateStage.READY, harness.state.stage)
        assertEquals(1, harness.installs)
    }

    @Test fun cancelledDownloadDiscardsLateResultAndDoesNotShowPromptAgain() {
        val harness = AppUpdateHarness()
        harness.available()
        harness.controller.confirm()
        harness.controller.dismiss()
        harness.flush()
        assertEquals(AppUpdateStage.HIDDEN, harness.state.stage)
        assertEquals(1, harness.discarded.size)
        assertEquals(0, harness.installs)
    }

    @Test fun offlineStartupIsQuietAndClosedControllerCannotOfferLateUpdate() {
        val harness = AppUpdateHarness()
        harness.failure = true
        harness.available()
        assertEquals(AppUpdateStage.HIDDEN, harness.state.stage)
        harness.failure = false
        harness.controller.check()
        harness.controller.close()
        harness.flush()
        assertEquals(AppUpdateStage.HIDDEN, harness.state.stage)
    }
}
