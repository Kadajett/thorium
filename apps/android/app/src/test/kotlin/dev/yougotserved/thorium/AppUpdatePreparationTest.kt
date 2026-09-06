package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.InterruptedIOException
import java.nio.file.Files

class AppUpdatePreparationTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun interruptedPartialDownloadRemovesOnlyItsOwnFile() {
        val directory = temporary.root.toPath()
        val sentinel = Files.write(directory.resolve("keep.txt"), byteArrayOf(1))
        val port = AppUpdatePreparationPort(::updateInstalled, { updateArchive() }, { _, path, _ ->
            Files.write(path, byteArrayOf(2))
            throw InterruptedIOException("cancelled")
        }, directory)
        assertThrows(InterruptedIOException::class.java) { prepareAppUpdate(port, updateCandidate()) }
        Files.list(directory).use { assertEquals(listOf(sentinel), it.toList()) }
    }

    @Test fun signerFailureRemovesDownloadedCandidate() {
        val directory = temporary.root.toPath()
        val port = AppUpdatePreparationPort(
            ::updateInstalled, { updateArchive().copy(signerDigests = setOf("foreign")) },
            { _, path, _ -> Files.write(path, updateBytes) }, directory)
        assertThrows(AppUpdateException::class.java) { prepareAppUpdate(port, updateCandidate()) }
        Files.list(directory).use { assertEquals(0L, it.count()) }
    }

    @Test fun successfulPreparationKeepsVerifiedFile() {
        val directory = temporary.root.toPath()
        val port = AppUpdatePreparationPort(::updateInstalled, { updateArchive() },
            { _, path, _ -> Files.write(path, updateBytes) }, directory)
        val prepared = prepareAppUpdate(port, updateCandidate())
        assertEquals(updateCandidate(), prepared.candidate)
        assertEquals(updateBytes.toList(), Files.readAllBytes(prepared.path).toList())
    }
}
