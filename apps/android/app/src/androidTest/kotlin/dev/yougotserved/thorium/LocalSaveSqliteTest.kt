package dev.yougotserved.thorium

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class LocalSaveSqliteTest {
    @Test
    fun closingAndReopeningPreservesExactSavedDocumentAndRevision() {
        val namespace = saveTestNamespace()
        val value = "{\"turn\":7,\"hand\":[\"火\",\"ward\"],\"schemaVersion\":1}"
        deviceSaveStore().use { store ->
            assertEquals(LocalSaveResult.Written(1), store.open(namespace).execute(saveWrite(value)))
        }
        deviceSaveStore().use { store ->
            val saved = store.open(namespace).execute(saveRead())
            assertEquals(LocalSaveResult.Read(LocalSaveEntry(1, value)), saved)
        }
    }

    @Test
    fun independentConnectionsCannotBothCommitAgainstTheSameRevision() {
        val namespace = saveTestNamespace()
        deviceSaveStore().use { store -> store.open(namespace).execute(saveWrite("1")) }
        val executor = Executors.newFixedThreadPool(2)
        val start = CountDownLatch(1)
        try {
            val outcomes = listOf("2", "3").map { value ->
                executor.submit<String> { competingWrite(namespace, value, start) }
            }
            start.countDown()
            val results = outcomes.map { it.get(5, TimeUnit.SECONDS) }
            assertEquals(listOf("conflict", "written"), results.sorted())
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun failedAggregateQuotaTransactionPreservesPreviousKeysAndRevision() {
        deviceSaveStore().use { store ->
            val save = store.open(saveTestNamespace())
            val full = "\"" + "x".repeat(LocalSaveLimits.MAX_VALUE_BYTES - 2) + "\""
            listOf("one", "two", "three", "four").forEach { key ->
                save.execute(saveWrite(full).copy(key = key))
            }
            assertSaveFailure("quota_exceeded") { save.execute(saveWrite("0")) }
            assertEquals(LocalSaveResult.Read(null), save.execute(saveRead()))
            save.execute(LocalSaveCommand(LocalSaveOperation.REMOVE, "one", 1))
            assertEquals(LocalSaveResult.Written(6), save.execute(saveWrite("0")))
        }
    }

    @Test
    fun packageIsolationAndDeleteRecreateRevisionProtectionSurviveReopening() {
        val namespace = saveTestNamespace()
        deviceSaveStore().use { store ->
            val save = store.open(namespace)
            save.execute(saveWrite("1"))
            assertEquals(LocalSaveResult.Read(null), store.open(saveTestNamespace()).execute(saveRead()))
            save.execute(LocalSaveCommand(LocalSaveOperation.REMOVE, "run", 1))
        }
        deviceSaveStore().use { store ->
            val save = store.open(namespace)
            assertEquals(LocalSaveResult.Written(3), save.execute(saveWrite("3")))
            assertSaveFailure("conflict") { save.execute(saveWrite("4", 1)) }
            assertEquals(LocalSaveResult.Read(LocalSaveEntry(3, "3")), save.execute(saveRead()))
        }
    }

    @Test
    fun invalidInputIsRejectedBeforeTouchingAnExistingSave() {
        deviceSaveStore().use { store ->
            val save = store.open(saveTestNamespace())
            save.execute(saveWrite("null"))
            assertSaveFailure("invalid_request") { save.execute(saveWrite("[1,]", 1)) }
            assertSaveFailure("invalid_request") { save.execute(saveRead().copy(key = "../other")) }
            assertSaveFailure("quota_exceeded") { save.execute(saveWrite("\"" + "é".repeat(65536) + "\"", 1)) }
            assertEquals(LocalSaveResult.Read(LocalSaveEntry(1, "null")), save.execute(saveRead()))
        }
    }

    private fun competingWrite(namespace: String, value: String, start: CountDownLatch): String {
        assertTrue(start.await(5, TimeUnit.SECONDS))
        return deviceSaveStore().use { store ->
            try {
                store.open(namespace).execute(saveWrite(value, 1))
                "written"
            } catch (error: LocalSaveException) {
                error.code
            }
        }
    }
}
