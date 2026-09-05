package dev.yougotserved.thorium

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceAccountAuthorizationTest {
    @Test
    fun exchangesTheStableInstallCredentialAndCachesTheLiveAccountToken() {
        val connection = DeviceSessionHttpConnection(
            URI("https://games.yougotserved.dev/v1/device-sessions").toURL(),
            JSONObject()
                .put("token", "signed.device.token")
                .put("expiresAt", "2030-01-01T00:00:00Z")
                .toString().toByteArray(),
        )
        var opened = 0
        val adapter = HttpDeviceAccountAuthorizationAdapter(
            baseUrl = "https://games.yougotserved.dev",
            credential = DeviceCredentialPort { CREDENTIAL },
            openConnection = {
                opened += 1
                connection
            },
            nowEpochMs = { NOW },
        )

        assertEquals("signed.device.token", adapter.current().bearerToken)
        assertEquals("signed.device.token", adapter.current().bearerToken)
        assertEquals(1, opened)
        assertEquals(
            JSONObject().put("credential", CREDENTIAL).toString(),
            connection.output.toString(Charsets.UTF_8.name()),
        )
        assertTrue(connection.disconnected)
    }

    @Test
    fun rejectsUnexpectedOrAlreadyExpiringIdentityResponses() {
        val malformed = listOf(
            JSONObject()
                .put("token", "signed.device.token")
                .put("expiresAt", "2030-01-01T00:00:00Z")
                .put("accountId", "must-not-be-exposed"),
            JSONObject()
                .put("token", "signed device token")
                .put("expiresAt", "2030-01-01T00:00:00Z"),
            JSONObject()
                .put("token", "signed.device.token")
                .put("expiresAt", "2023-11-14T22:13:21Z"),
        )

        malformed.forEach { response ->
            val connection = DeviceSessionHttpConnection(
                URI("https://games.yougotserved.dev/v1/device-sessions").toURL(),
                response.toString().toByteArray(),
            )
            val adapter = HttpDeviceAccountAuthorizationAdapter(
                baseUrl = "https://games.yougotserved.dev",
                credential = DeviceCredentialPort { CREDENTIAL },
                openConnection = { connection },
                nowEpochMs = { NOW },
            )

            assertThrows(Exception::class.java) { adapter.current() }
            assertTrue(connection.disconnected)
        }
    }

    @Test
    fun rejectsCredentialsThatDoNotContainThirtyTwoRandomBytes() {
        val adapter = HttpDeviceAccountAuthorizationAdapter(
            baseUrl = "https://games.yougotserved.dev",
            credential = DeviceCredentialPort { "guessable" },
            openConnection = { error("network must not be reached") },
            nowEpochMs = { NOW },
        )

        assertThrows(IllegalArgumentException::class.java) { adapter.current() }
    }

    private companion object {
        const val CREDENTIAL = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        const val NOW = 1_700_000_000_000L
    }
}

private class DeviceSessionHttpConnection(
    url: URL,
    private val response: ByteArray,
    private val status: Int = HttpURLConnection.HTTP_CREATED,
) : HttpURLConnection(url) {
    val output = ByteArrayOutputStream()
    var disconnected = false
        private set

    override fun getResponseCode(): Int = status
    override fun getContentLengthLong(): Long = response.size.toLong()
    override fun getInputStream(): InputStream = ByteArrayInputStream(response)
    override fun getOutputStream(): OutputStream = output

    override fun disconnect() {
        disconnected = true
    }

    override fun usingProxy(): Boolean = false
    override fun connect() = Unit
}
