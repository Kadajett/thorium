package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI

class AppUpdateHttpTest {
    @Test fun streamRequiresExactSizeAndChecksum() {
        val output = ByteArrayOutputStream()
        copyAppUpdate(ByteArrayInputStream(updateBytes), output, updateApk)
        assertEquals(updateBytes.toList(), output.toByteArray().toList())
        rejectsBytes(updateBytes + byteArrayOf(1), updateApk)
        rejectsBytes(updateBytes.dropLast(1).toByteArray(), updateApk)
        rejectsBytes(updateBytes, updateApk.copy(sha256 = "0".repeat(64)))
    }

    @Test fun boundedHttpRejectsRateLimitAndClosesConnection() {
        val connection = AppUpdateTestConnection(429, byteArrayOf())
        val http = createAppUpdateHttp { connection }
        assertThrows(AppUpdateException::class.java) { http.read(appUpdateListUrl(1), 20) }
        assertTrue(connection.disconnected)
    }

    @Test fun chunkedResponsesCannotExceedReadBudget() {
        val connection = AppUpdateTestConnection(200, ByteArray(21))
        val http = createAppUpdateHttp { connection }
        assertThrows(AppUpdateException::class.java) { http.read(appUpdateListUrl(1), 20) }
        assertTrue(connection.disconnected)
    }

    @Test fun redirectsCannotDowngradeOrLeaveGithub() {
        val source = URI(updateCandidate().url)
        assertEquals("release-assets.githubusercontent.com", appUpdateRedirect(
            source, "https://release-assets.githubusercontent.com/asset?signature=fixture",
        ).host)
        listOf("http://github.com/file", "https://evil.test/file", "https://github.com/other/repo/file",
            "https://user@release-assets.githubusercontent.com/file").forEach { target ->
            assertThrows(AppUpdateException::class.java) { appUpdateRedirect(source, target) }
        }
    }

    private fun rejectsBytes(bytes: ByteArray, apk: AppUpdateApk) {
        assertThrows(AppUpdateException::class.java) {
            copyAppUpdate(ByteArrayInputStream(bytes), ByteArrayOutputStream(), apk)
        }
    }
}

internal class AppUpdateTestConnection(private val status: Int, private val bytes: ByteArray) :
    HttpURLConnection(URI("https://api.github.com").toURL()) {
    var disconnected = false
    override fun disconnect() { disconnected = true }
    override fun usingProxy(): Boolean = false
    override fun connect() = Unit
    override fun getResponseCode(): Int = status
    override fun getContentLengthLong(): Long = -1
    override fun getInputStream(): InputStream = ByteArrayInputStream(bytes)
}
