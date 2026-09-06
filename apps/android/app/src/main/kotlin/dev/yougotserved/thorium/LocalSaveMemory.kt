package dev.yougotserved.thorium

private data class LocalSaveMemoryState(
    val revision: Long = 0,
    val entries: Map<String, LocalSaveEntry> = emptyMap(),
)

private fun transitionSave(
    state: LocalSaveMemoryState,
    command: LocalSaveCommand,
): Pair<LocalSaveMemoryState, LocalSaveResult> {
    LocalSavePolicy.validate(command)
    val entry = state.entries[command.key]
    if (command.operation == LocalSaveOperation.READ) return state to LocalSaveResult.Read(entry)
    val usage = LocalSaveUsage(
        state.revision, state.entries.size,
        state.entries.values.sumOf { it.valueJson.toByteArray(Charsets.UTF_8).size },
    )
    val mutation = LocalSavePolicy.mutation(command, entry, usage)
    return if (command.operation == LocalSaveOperation.REMOVE) {
        LocalSaveMemoryState(mutation.revision, state.entries - command.key) to LocalSaveResult.Removed
    } else {
        saveMemoryEntry(state, command, mutation)
    }
}

private fun saveMemoryEntry(
    state: LocalSaveMemoryState,
    command: LocalSaveCommand,
    mutation: LocalSaveMutation,
): Pair<LocalSaveMemoryState, LocalSaveResult> {
    val saved = LocalSaveEntry(mutation.revision, command.valueJson ?: LocalSavePolicy.fail("invalid_request"))
    val next = LocalSaveMemoryState(mutation.revision, state.entries + (command.key to saved))
    return next to LocalSaveResult.Written(mutation.revision)
}

/** Storage adapter; state and synchronization are private, callers use the same port as SQLite. */
fun createMemoryLocalSaveStore(): LocalSaveNamespaces {
    val packages = mutableMapOf<String, LocalSaveMemoryState>()
    return LocalSaveNamespaces { packageId ->
        LocalSavePort { command ->
            synchronized(packages) {
                val (next, result) = transitionSave(packages[packageId] ?: LocalSaveMemoryState(), command)
                packages[packageId] = next
                result
            }
        }
    }
}
