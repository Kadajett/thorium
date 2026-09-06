package dev.yougotserved.thorium

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class LocalSaveProtocolTest {
    @Test
    fun validRequestContainsNoCallerChosenNamespace() {
        val request = LocalSaveProtocol.decode(envelope())
        assertEquals("save-1", request.requestId)
        assertEquals(LocalSaveCommand(LocalSaveOperation.READ, "run"), request.command)
        assertThrows(LocalSaveException::class.java) {
            LocalSaveProtocol.decode(envelope().put("packageId", "dev.other"))
        }
    }

    @Test
    fun writeRequiresExplicitCasAndRejectsFractionalRevisions() {
        val write = envelope().put("operation", "write").put("valueJson", "null")
        assertThrows(LocalSaveException::class.java) { LocalSaveProtocol.decode(write) }
        write.put("expectedRevision", JSONObject.NULL)
        assertEquals(null, LocalSaveProtocol.decode(write).command.expectedRevision)
        write.put("expectedRevision", 1.5)
        assertThrows(LocalSaveException::class.java) { LocalSaveProtocol.decode(write) }
    }

    @Test
    fun malformedEnvelopesAndOtherMessageKindsAreNotSaveRequests() {
        assertNull(LocalSaveProtocol.envelope("{\"kind\":\"local-save-request\",}"))
        assertNull(LocalSaveProtocol.envelope("{\"kind\":\"ready\"}"))
        assertNull(LocalSaveProtocol.envelope(" ".repeat(LocalSaveLimits.MAX_ENVELOPE_BYTES + 1)))
    }

    @Test
    fun successPreservesRevisionAndJsonWithoutExpandingTheSavedObject() {
        val wire = LocalSaveProtocol.success("save-1", LocalSaveResult.Read(LocalSaveEntry(8, "{\"turn\":3}")))
        val result = JSONObject(wire).getJSONObject("result").getJSONObject("entry")
        assertEquals(8, result.getLong("revision"))
        assertEquals("{\"turn\":3}", result.getString("valueJson"))
    }

    private fun envelope(): JSONObject = JSONObject()
        .put("kind", "local-save-request").put("protocolVersion", 1)
        .put("requestId", "save-1").put("operation", "read").put("key", "run")
}
