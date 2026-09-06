package dev.yougotserved.thorium

import android.os.Process
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assume.assumeNotNull
import org.junit.Test
import org.junit.runner.RunWith

/** Run the two methods in separate instrumentation invocations with the same saveProbe argument. */
@RunWith(AndroidJUnit4::class)
class LocalSaveRestartProbe {
    @Test
    fun writeBeforeProcessRestart() {
        val nonce = probeNonce()
        val value = JSONObject().put("nonce", nonce).put("pid", Process.myPid()).put("turn", 7).toString()
        deviceSaveStore().use { store ->
            val save = store.open("dev.thorium.restart.$nonce")
            assertEquals(LocalSaveResult.Written(1), save.execute(saveWrite(value)))
        }
    }

    @Test
    fun readAfterProcessRestart() {
        val nonce = probeNonce()
        deviceSaveStore().use { store ->
            val result = store.open("dev.thorium.restart.$nonce").execute(saveRead()) as LocalSaveResult.Read
            val entry = requireNotNull(result.entry)
            val value = JSONObject(entry.valueJson)
            assertEquals(1L, entry.revision)
            assertEquals(nonce, value.getString("nonce"))
            assertEquals(7, value.getInt("turn"))
            assertNotEquals(value.getInt("pid"), Process.myPid())
        }
    }

    private fun probeNonce(): String {
        val nonce = InstrumentationRegistry.getArguments().getString("saveProbe")
        assumeNotNull(nonce)
        return requireNotNull(nonce).also { require(Regex("^[a-z0-9-]{1,64}$").matches(it)) }
    }
}
