package dev.yougotserved.thorium

import android.app.Application
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

internal data class AppUpdateProbeReceipt(val sessionId: Int, val status: Int)

internal class AppUpdateProbeApplication : Application(), AppUpdateComposition {
    val state = AtomicReference(AppUpdateState())
    val receipts = LinkedBlockingQueue<AppUpdateProbeReceipt>()
    val downloads = AtomicInteger()
    var discovery = CountDownLatch(1)

    override fun http(): AppUpdateHttpPort = appUpdateProbeHttp(this)
    override fun stateChanged(state: AppUpdateState) { this.state.set(state) }
    override fun installerResult(sessionId: Int, status: Int) {
        receipts.add(AppUpdateProbeReceipt(sessionId, status))
    }

    fun reset() {
        state.set(AppUpdateState())
        receipts.clear()
        downloads.set(0)
        discovery = CountDownLatch(1)
        check(appUpdatePreferences(this).edit().clear().commit())
    }
}
