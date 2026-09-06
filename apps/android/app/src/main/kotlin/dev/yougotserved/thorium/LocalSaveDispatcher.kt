package dev.yougotserved.thorium

import java.util.concurrent.atomic.AtomicBoolean

data class LocalSaveDispatchEnvironment(
    val submit: (Runnable) -> Boolean,
    val schedule: (Runnable, Long) -> (() -> Unit),
    val now: () -> Long,
    val deliver: (String) -> Unit,
)
private class LocalSaveTask(val request: LocalSaveRequest, val deadline: Long) {
    val finished = AtomicBoolean(false)
    var cancelTimer: () -> Unit = {}
}

/** Bounded asynchronous effect adapter. Accepted in-flight writes may commit after caller timeout. */
class LocalSaveDispatcher(
    private val port: LocalSavePort,
    private val environment: LocalSaveDispatchEnvironment,
) {
    private val pending = mutableMapOf<String, LocalSaveTask>()
    private val closed = AtomicBoolean(false)

    fun submit(request: LocalSaveRequest) {
        val task = reserve(request) ?: return
        task.cancelTimer = environment.schedule(Runnable { complete(task, "timeout") }, TIMEOUT_MS)
        if (!environment.submit(Runnable { execute(task) })) complete(task, "busy")
    }

    private fun reserve(request: LocalSaveRequest): LocalSaveTask? = synchronized(pending) {
        if (closed.get()) return@synchronized null
        if (pending.size >= MAX_PENDING || request.requestId in pending) {
            environment.deliver(LocalSaveProtocol.failure(request.requestId, "busy"))
            return@synchronized null
        }
        LocalSaveTask(request, environment.now() + TIMEOUT_MS).also { pending[request.requestId] = it }
    }

    private fun execute(task: LocalSaveTask) {
        if (task.finished.get() || closed.get()) return
        if (environment.now() >= task.deadline) {
            complete(task, "timeout")
            return
        }
        val response = try {
            LocalSaveProtocol.success(task.request.requestId, port.execute(task.request.command))
        } catch (error: LocalSaveException) {
            LocalSaveProtocol.failure(task.request.requestId, error.code)
        } catch (_: Exception) {
            LocalSaveProtocol.failure(task.request.requestId, "io_error")
        }
        deliver(task, response)
    }

    private fun complete(task: LocalSaveTask, code: String) {
        deliver(task, LocalSaveProtocol.failure(task.request.requestId, code))
    }

    private fun deliver(task: LocalSaveTask, response: String) {
        if (!task.finished.compareAndSet(false, true)) return
        task.cancelTimer()
        synchronized(pending) { pending.remove(task.request.requestId) }
        if (!closed.get()) environment.deliver(response)
    }

    fun close() {
        closed.set(true)
        val tasks = synchronized(pending) { pending.values.toList().also { pending.clear() } }
        tasks.forEach { it.finished.set(true); it.cancelTimer() }
    }

    companion object {
        private const val MAX_PENDING = 4
        private const val TIMEOUT_MS = 5000L
    }
}
