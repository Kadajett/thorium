package dev.yougotserved.thorium

object LocalSaveLimits {
    const val CAPABILITY = "local-save-v1"
    const val MAX_VALUE_BYTES = 131072
    const val MAX_KEYS = 16
    const val MAX_TOTAL_BYTES = 524288
    const val MAX_ENVELOPE_BYTES = MAX_VALUE_BYTES * 6 + 1024
    const val MAX_REVISION = 9007199254740991L
}

enum class LocalSaveOperation { READ, WRITE, REMOVE }
data class LocalSaveCommand(
    val operation: LocalSaveOperation,
    val key: String,
    val expectedRevision: Long? = null,
    val valueJson: String? = null,
)
data class LocalSaveRequest(val requestId: String, val command: LocalSaveCommand)
data class LocalSaveEntry(val revision: Long, val valueJson: String)
data class LocalSaveUsage(val revision: Long, val keys: Int, val bytes: Int)
data class LocalSaveMutation(val revision: Long, val valueBytes: Int)

sealed interface LocalSaveResult {
    data class Read(val entry: LocalSaveEntry?) : LocalSaveResult
    data class Written(val revision: Long) : LocalSaveResult
    data object Removed : LocalSaveResult
}

class LocalSaveException(val code: String) : IllegalArgumentException("Local save: $code")
fun interface LocalSavePort { fun execute(command: LocalSaveCommand): LocalSaveResult }
fun interface LocalSaveNamespaces { fun open(packageId: String): LocalSavePort }

/** Deterministic policy shared by durable and in-memory effect adapters. */
object LocalSavePolicy {
    private val keyPattern = Regex("^[a-z][a-z0-9._-]{0,63}$")
    fun validate(command: LocalSaveCommand) {
        if (!keyPattern.matches(command.key)) fail("invalid_request")
        when (command.operation) {
            LocalSaveOperation.READ -> requireFields(command, revision = false, value = false)
            LocalSaveOperation.WRITE -> {
                requireFields(command, revision = false, value = true)
                validateValue(command.valueJson ?: fail("invalid_request"))
            }
            LocalSaveOperation.REMOVE -> requireFields(command, revision = true, value = false)
        }
        command.expectedRevision?.let(::validateRevision)
    }

    private fun requireFields(command: LocalSaveCommand, revision: Boolean, value: Boolean) {
        if (revision && command.expectedRevision == null) fail("invalid_request")
        if ((command.valueJson != null) != value) fail("invalid_request")
        if (command.operation == LocalSaveOperation.READ && command.expectedRevision != null) fail("invalid_request")
    }

    fun validateValue(value: String) {
        if (value.length > LocalSaveLimits.MAX_VALUE_BYTES) fail("quota_exceeded")
        if (value.toByteArray(Charsets.UTF_8).size > LocalSaveLimits.MAX_VALUE_BYTES) fail("quota_exceeded")
        LocalSaveJson.requireValid(value)
    }

    fun mutation(command: LocalSaveCommand, current: LocalSaveEntry?, usage: LocalSaveUsage): LocalSaveMutation {
        validate(command)
        if (command.operation == LocalSaveOperation.READ) fail("invalid_request")
        if (current?.revision != command.expectedRevision) fail("conflict")
        val revision = usage.revision + 1
        validateRevision(revision)
        val bytes = command.valueJson?.toByteArray(Charsets.UTF_8)?.size ?: 0
        checkQuota(command, current, usage, bytes)
        return LocalSaveMutation(revision, bytes)
    }

    private fun checkQuota(command: LocalSaveCommand, current: LocalSaveEntry?, usage: LocalSaveUsage, bytes: Int) {
        if (command.operation != LocalSaveOperation.WRITE) return
        val keys = usage.keys + if (current == null) 1 else 0
        val total = usage.bytes - (current?.valueJson?.toByteArray(Charsets.UTF_8)?.size ?: 0) + bytes
        if (keys > LocalSaveLimits.MAX_KEYS || total > LocalSaveLimits.MAX_TOTAL_BYTES) fail("quota_exceeded")
    }

    fun validateRevision(revision: Long) {
        if (revision !in 1..LocalSaveLimits.MAX_REVISION) fail("invalid_request")
    }

    fun fail(code: String): Nothing = throw LocalSaveException(code)
}
