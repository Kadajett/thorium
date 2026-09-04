package dev.yougotserved.thorium

import java.nio.file.Files
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AtomicDirectoryPromoterTest {
    @get:Rule
    val temporary = TemporaryFolder()

    @Test
    fun movesTheCompleteStagedDirectoryAsOneFilesystemOperation() {
        val root = temporary.newFolder("atomic").toPath()
        val staged = root.resolve("staged")
        val target = root.resolve("releases/game/version/digest")
        Files.createDirectory(staged)
        Files.writeString(staged.resolve("payload"), "verified")

        assertTrue(AtomicDirectoryPromoter.promote(staged, target))
        assertFalse(Files.exists(staged))
        assertTrue(Files.isRegularFile(target.resolve("payload")))
    }
}
