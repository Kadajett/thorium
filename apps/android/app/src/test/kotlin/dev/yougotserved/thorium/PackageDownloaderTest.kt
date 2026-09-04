package dev.yougotserved.thorium

import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.nio.file.Files
import java.nio.file.Path
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PackageDownloaderTest {
    @get:Rule
    val temporary = TemporaryFolder()

    @Test
    fun streamsAValidPackageToACompleteTemporaryFile() {
        val fixture = TestPackages.valid()
        val root = temporary.newFolder("success").toPath()
        val input = ChunkedInputStream(fixture.archive, maximumChunkSize = 7)
        val connection = FakeHttpConnection(
            url = URI(fixture.release.bundle.url).toURL(),
            declaredContentLength = fixture.archive.size.toLong(),
            input = input,
        )

        val downloaded = PackageDownloader(root) { requestedUri ->
            assertEquals(fixture.release.bundle.url, requestedUri.toString())
            connection
        }.download(fixture.release)

        assertArrayEquals(fixture.archive, Files.readAllBytes(downloaded))
        assertEquals(fixture.archive.size.toLong(), input.bytesRead)
        assertTrue(connection.disconnected)
    }

    @Test
    fun rejectsAnHttpErrorWithoutOpeningTheResponseBodyOrLeavingAPartFile() {
        val fixture = TestPackages.valid()
        val root = temporary.newFolder("http-error").toPath()
        val connection = FakeHttpConnection(
            url = URI(fixture.release.bundle.url).toURL(),
            responseCode = HttpURLConnection.HTTP_UNAVAILABLE,
            input = FailingInputStream("HTTP error bodies must not be consumed"),
        )

        val error = assertThrows(PackageInstallException::class.java) {
            PackageDownloader(root) { connection }.download(fixture.release)
        }

        assertEquals("Package download failed (503)", error.message)
        assertNoPartialFiles(root)
        assertTrue(connection.disconnected)
    }

    @Test
    fun cleansUpThePartFileWhenOpeningTheConnectionFails() {
        val fixture = TestPackages.valid()
        val root = temporary.newFolder("connection-error").toPath()

        val error = assertThrows(IOException::class.java) {
            PackageDownloader(root) { throw IOException("network unavailable") }
                .download(fixture.release)
        }

        assertEquals("network unavailable", error.message)
        assertNoPartialFiles(root)
    }

    @Test
    fun rejectsAContentLengthThatDisagreesWithTheCatalog() {
        val fixture = TestPackages.valid()
        val root = temporary.newFolder("length-mismatch").toPath()
        val connection = FakeHttpConnection(
            url = URI(fixture.release.bundle.url).toURL(),
            declaredContentLength = fixture.archive.size + 1L,
            input = FailingInputStream("A mismatched declared length must fail before streaming"),
        )

        val error = assertThrows(PackageInstallException::class.java) {
            PackageDownloader(root) { connection }.download(fixture.release)
        }

        assertEquals("Downloaded Content-Length does not match the catalog", error.message)
        assertNoPartialFiles(root)
    }

    @Test
    fun rejectsSameSizeDigestTamperingAndCleansUp() {
        val fixture = TestPackages.valid()
        val root = temporary.newFolder("tampered").toPath()
        val tampered = fixture.archive.copyOf().also { bytes ->
            bytes[bytes.lastIndex / 2] = (bytes[bytes.lastIndex / 2].toInt() xor 1).toByte()
        }
        val connection = FakeHttpConnection(
            url = URI(fixture.release.bundle.url).toURL(),
            declaredContentLength = tampered.size.toLong(),
            input = ByteArrayInputStream(tampered),
        )

        val error = assertThrows(PackageInstallException::class.java) {
            PackageDownloader(root) { connection }.download(fixture.release)
        }

        assertEquals("Downloaded package does not match the catalog", error.message)
        assertNoPartialFiles(root)
    }

    @Test
    fun stopsAnUnknownLengthResponseOnceItExceedsTheCatalogSize() {
        val fixture = TestPackages.valid()
        val root = temporary.newFolder("stream-oversize").toPath()
        val oversized = fixture.archive + ByteArray(DEFAULT_BUFFER_SIZE * 2)
        val input = ChunkedInputStream(oversized, maximumChunkSize = 13)
        val connection = FakeHttpConnection(
            url = URI(fixture.release.bundle.url).toURL(),
            declaredContentLength = -1,
            input = input,
        )

        val error = assertThrows(PackageInstallException::class.java) {
            PackageDownloader(root) { connection }.download(fixture.release)
        }

        assertEquals("Package download exceeds its byte limit", error.message)
        assertTrue(input.bytesRead < oversized.size)
        assertNoPartialFiles(root)
    }

    private fun assertNoPartialFiles(root: Path) {
        Files.list(root).use { files ->
            assertFalse(files.anyMatch { path -> path.fileName.toString().endsWith(".part") })
        }
    }
}

private class FakeHttpConnection(
    url: URL,
    private val responseCode: Int = HttpURLConnection.HTTP_OK,
    private val declaredContentLength: Long = -1,
    private val input: InputStream,
) : HttpURLConnection(url) {
    var disconnected = false
        private set

    override fun getResponseCode(): Int = responseCode

    override fun getContentLengthLong(): Long = declaredContentLength

    override fun getInputStream(): InputStream = input

    override fun disconnect() {
        disconnected = true
    }

    override fun usingProxy(): Boolean = false

    override fun connect() = Unit
}

private class ChunkedInputStream(
    private val bytes: ByteArray,
    private val maximumChunkSize: Int,
) : InputStream() {
    var bytesRead = 0L
        private set

    override fun read(): Int {
        if (bytesRead >= bytes.size) return -1
        return bytes[bytesRead++.toInt()].toInt() and 0xff
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (bytesRead >= bytes.size) return -1
        val count = minOf(length, maximumChunkSize, bytes.size - bytesRead.toInt())
        bytes.copyInto(buffer, offset, bytesRead.toInt(), bytesRead.toInt() + count)
        bytesRead += count
        return count
    }
}

private class FailingInputStream(private val message: String) : InputStream() {
    override fun read(): Int = throw AssertionError(message)
}
