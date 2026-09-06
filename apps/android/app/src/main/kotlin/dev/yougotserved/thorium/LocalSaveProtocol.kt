package dev.yougotserved.thorium

import org.json.JSONObject

object LocalSaveProtocol {
    private val kindPattern = Regex("\"kind\"\\s*:\\s*\"local-save-request\"")
    private val requestPattern = Regex("^[a-zA-Z0-9_-]{1,128}$")
    private val baseKeys = setOf("kind", "protocolVersion", "requestId", "operation", "key")
    fun envelope(raw: String): JSONObject? {
        return raw.takeIf(::withinEnvelopeLimit)?.takeIf(kindPattern::containsMatchIn)?.let { runCatching {
            LocalSaveJson.requireValid(raw)
            JSONObject(raw).takeIf { it.opt("kind") == "local-save-request" }
        }.getOrNull() }
    }

    fun requestId(envelope: JSONObject): String? =
        (envelope.opt("requestId") as? String)?.takeIf(requestPattern::matches)

    fun decode(envelope: JSONObject): LocalSaveRequest {
        val id = requestId(envelope) ?: LocalSavePolicy.fail("invalid_request")
        if (envelope.opt("protocolVersion") != 1) LocalSavePolicy.fail("invalid_request")
        val operation = when (envelope.opt("operation") as? String) {
            "read" -> LocalSaveOperation.READ
            "write" -> LocalSaveOperation.WRITE
            "remove" -> LocalSaveOperation.REMOVE
            else -> LocalSavePolicy.fail("invalid_request")
        }
        checkKeys(envelope, operation)
        val command = command(envelope, operation)
        LocalSavePolicy.validate(command)
        return LocalSaveRequest(id, command)
    }

    private fun checkKeys(envelope: JSONObject, operation: LocalSaveOperation) {
        val extra = when (operation) {
            LocalSaveOperation.READ -> emptySet()
            LocalSaveOperation.WRITE -> setOf("valueJson", "expectedRevision")
            LocalSaveOperation.REMOVE -> setOf("expectedRevision")
        }
        if (envelope.keys().asSequence().toSet() != baseKeys + extra) LocalSavePolicy.fail("invalid_request")
    }

    private fun command(envelope: JSONObject, operation: LocalSaveOperation): LocalSaveCommand {
        val key = envelope.opt("key") as? String ?: LocalSavePolicy.fail("invalid_request")
        val revision = revision(envelope.opt("expectedRevision"))
        val value = if (operation == LocalSaveOperation.WRITE) {
            envelope.opt("valueJson") as? String ?: LocalSavePolicy.fail("invalid_request")
        } else null
        return LocalSaveCommand(operation, key, revision, value)
    }

    private fun revision(raw: Any?): Long? = when (raw) {
        null, JSONObject.NULL -> null
        is Int -> raw.toLong()
        is Long -> raw
        else -> LocalSavePolicy.fail("invalid_request")
    }

    fun success(requestId: String, result: LocalSaveResult): String =
        response(requestId).put("status", "ok").put("result", resultJson(result)).toString()

    fun failure(requestId: String, code: String): String =
        response(requestId).put("status", "error").put("error", code).toString()

    private fun response(requestId: String): JSONObject = JSONObject()
        .put("kind", "local-save-result").put("protocolVersion", 1).put("requestId", requestId)

    private fun resultJson(result: LocalSaveResult): JSONObject = when (result) {
        is LocalSaveResult.Read -> JSONObject().put("operation", "read").put("entry", localSaveEntryJson(result.entry))
        is LocalSaveResult.Written -> JSONObject().put("operation", "write").put("revision", result.revision)
        LocalSaveResult.Removed -> JSONObject().put("operation", "remove")
    }

    fun grant(): JSONObject = JSONObject().put("protocolVersion", 1)
        .put("maxValueBytes", LocalSaveLimits.MAX_VALUE_BYTES).put("maxKeys", LocalSaveLimits.MAX_KEYS)
        .put("maxTotalBytes", LocalSaveLimits.MAX_TOTAL_BYTES)
}

private fun withinEnvelopeLimit(raw: String): Boolean =
    raw.length <= LocalSaveLimits.MAX_ENVELOPE_BYTES &&
        raw.toByteArray(Charsets.UTF_8).size <= LocalSaveLimits.MAX_ENVELOPE_BYTES

private fun localSaveEntryJson(entry: LocalSaveEntry?): Any = if (entry == null) JSONObject.NULL else {
    JSONObject().put("revision", entry.revision).put("valueJson", entry.valueJson)
}
