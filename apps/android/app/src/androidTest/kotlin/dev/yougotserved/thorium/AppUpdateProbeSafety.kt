package dev.yougotserved.thorium

import android.os.Build
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeNotNull

internal fun requireDisposableUpdateProbe() {
    val arguments = InstrumentationRegistry.getArguments()
    assumeNotNull(arguments.getString("disposableSerial"))
    assertEquals("emulator-5566", arguments.getString("disposableSerial"))
    assertEquals("ranchu", Build.HARDWARE)
    val expected = probeInstrumentation().context.assets.open("probe-certificate.txt")
        .bufferedReader().use { it.readText().trim() }
    val installed = androidAppUpdateInstalled(probeApplication())
    assertEquals(AppUpdateLimits.PACKAGE_ID, installed.version.packageId)
    assertEquals(setOf(expected), installed.signerDigests)
}
