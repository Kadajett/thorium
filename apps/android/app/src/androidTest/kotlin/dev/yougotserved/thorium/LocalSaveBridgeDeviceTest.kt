package dev.yougotserved.thorium

import android.os.Looper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(AndroidJUnit4::class)
class LocalSaveBridgeDeviceTest {
    @Test
    fun hostGrantAndTwoSurfaceBridgesShareDurableRevisionCheckedState() {
        val launch = saveTestLaunch()
        val bootstrap = JSONObject(GameBootstrapMessage.create(launch, SurfaceRole.COMPANION, "probe"))
        assertEquals(1, bootstrap.getJSONObject("bootstrap").getJSONObject("localSave").getInt("protocolVersion"))
        DeviceSaveBridge(launch).use { first ->
            assertEquals(1, first.request(writeRequest()).getJSONObject("result").getLong("revision"))
        }
        DeviceSaveBridge(launch).use { reopened ->
            val saved = reopened.request(readRequest()).getJSONObject("result").getJSONObject("entry")
            assertEquals("{\"turn\":7}", saved.getString("valueJson"))
            assertEquals("conflict", reopened.request(writeRequest()).getString("error"))
        }
    }

    @Test
    fun missingCapabilityDoesNotGrantStorageOrWriteData() {
        val launch = saveTestLaunch().copy(capabilities = emptySet())
        val bootstrap = JSONObject(GameBootstrapMessage.create(launch, SurfaceRole.MAIN, "probe"))
        assertFalse(bootstrap.getJSONObject("bootstrap").has("localSave"))
        DeviceSaveBridge(launch).use { surface ->
            assertEquals("unsupported", surface.request(writeRequest()).getString("error"))
        }
        deviceSaveStore().use { store ->
            assertEquals(LocalSaveResult.Read(null), store.open(launch.packageId).execute(saveRead()))
        }
    }

    @Test
    fun callerCannotOverrideVerifiedPackageNamespace() {
        val launch = saveTestLaunch()
        DeviceSaveBridge(launch).use { surface ->
            val forged = writeRequest().put("packageId", saveTestNamespace())
            assertEquals("invalid_request", surface.request(forged).getString("error"))
            assertTrue(surface.request(readRequest()).getJSONObject("result").isNull("entry"))
        }
    }

    private fun readRequest(): JSONObject = JSONObject().put("operation", "read")

    private fun writeRequest(): JSONObject = JSONObject().put("operation", "write")
        .put("expectedRevision", JSONObject.NULL).put("valueJson", "{\"turn\":7}")
}

private class DeviceSaveBridge(launch: GameLaunch) : AutoCloseable {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val responses = LinkedBlockingQueue<JSONObject>()
    private val mainThreadReply = AtomicBoolean(false)
    private val bridge = LocalSaveBridge.create(instrumentation.targetContext, launch) {
        mainThreadReply.set(Looper.myLooper() == Looper.getMainLooper())
        responses.add(JSONObject(it))
    }

    fun request(fields: JSONObject): JSONObject {
        val id = UUID.randomUUID().toString()
        val wire = fields.put("kind", "local-save-request").put("protocolVersion", 1)
            .put("requestId", id).put("key", "run").toString()
        instrumentation.runOnMainSync { assertTrue(bridge.accept(wire)) }
        val response = requireNotNull(responses.poll(10, TimeUnit.SECONDS)) { "No save response" }
        assertTrue(mainThreadReply.get())
        assertEquals(id, response.getString("requestId"))
        return response
    }

    override fun close() = instrumentation.runOnMainSync { bridge.close() }
}
