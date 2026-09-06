package dev.yougotserved.thorium

/** Cancels work and rejects stale completions without putting scheduling inside update policy. */
internal class AppUpdateJobs(
    private val execution: AppUpdateExecution,
    private val discard: (AppUpdatePrepared) -> Unit,
) {
    private var generation = 0
    private var cancel: (() -> Unit)? = null
    val busy: Boolean get() = cancel != null

    fun invalidate() { generation += 1; cancel?.invoke(); cancel = null }

    fun cleanup(prepared: AppUpdatePrepared) {
        execution.cleanup { discard(prepared) }
    }

    fun <T> run(work: () -> T, complete: (Result<T>) -> Unit) {
        val request = ++generation
        cancel = execution.background {
            val result = runCatching(work)
            execution.foreground { finish(request, result, complete) }
        }
    }

    private fun <T> finish(request: Int, result: Result<T>, complete: (Result<T>) -> Unit) {
        if (request != generation) {
            (result.getOrNull() as? AppUpdatePrepared)?.let(::cleanup)
        } else {
            cancel = null
            complete(result)
        }
    }
}
