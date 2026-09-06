package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class LocalSavePortTest {
    @Test
    fun reopenedSurfacesSharePackageSavesButOtherPackagesCannotReadThem() {
        val store = createMemoryLocalSaveStore()
        val saved = store.open("dev.a").execute(write("{\"turn\":3}"))
        assertEquals(LocalSaveResult.Written(1), saved)
        assertEquals(
            LocalSaveResult.Read(LocalSaveEntry(1, "{\"turn\":3}")),
            store.open("dev.a").execute(read()),
        )
        assertEquals(LocalSaveResult.Read(null), store.open("dev.b").execute(read()))
    }

    @Test
    fun staleSurfaceCannotOverwriteAnotherSurfaceOrRecreatedSave() {
        val store = createMemoryLocalSaveStore()
        val first = store.open("dev.a")
        val second = store.open("dev.a")
        first.execute(write("1"))
        second.execute(write("2", 1))
        fails("conflict") { first.execute(write("3", 1)) }
        second.execute(LocalSaveCommand(LocalSaveOperation.REMOVE, "run", 2))
        assertEquals(LocalSaveResult.Written(4), first.execute(write("4")))
        fails("conflict") { second.execute(write("5", 2)) }
    }

    @Test
    fun utf8QuotaFailureDoesNotModifySaveOrConsumeRevision() {
        val save = createMemoryLocalSaveStore().open("dev.a")
        val exact = "\"" + "x".repeat(LocalSaveLimits.MAX_VALUE_BYTES - 2) + "\""
        save.execute(write(exact))
        fails("quota_exceeded") { save.execute(write("\"" + "é".repeat(65536) + "\"", 1)) }
        assertEquals(LocalSaveResult.Read(LocalSaveEntry(1, exact)), save.execute(read()))
        assertEquals(LocalSaveResult.Written(2), save.execute(write("null", 1)))
    }

    @Test
    fun keyQuotaAndPathValidationApplyThroughPublicPort() {
        val save = createMemoryLocalSaveStore().open("dev.a")
        repeat(16) { save.execute(write("0").copy(key = "slot.$it")) }
        fails("quota_exceeded") { save.execute(write("1")) }
        fails("invalid_request") { save.execute(read().copy(key = "../dev.b")) }
    }

    private fun read() = LocalSaveCommand(LocalSaveOperation.READ, "run")
    private fun write(value: String, revision: Long? = null) =
        LocalSaveCommand(LocalSaveOperation.WRITE, "run", revision, value)

    private fun fails(code: String, action: () -> Unit) {
        assertEquals(code, assertThrows(LocalSaveException::class.java, action).code)
    }
}
