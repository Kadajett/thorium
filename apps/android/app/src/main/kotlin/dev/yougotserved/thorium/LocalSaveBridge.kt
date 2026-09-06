package dev.yougotserved.thorium

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

private object LocalSaveWorkers {
    private val worker = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(32))
    private val timer = ScheduledThreadPoolExecutor(1).apply { removeOnCancelPolicy = true }
    private var store: LocalSaveNamespaces? = null

    @Synchronized
    fun port(context: Context, packageId: String): LocalSavePort {
        val current = store ?: createSqliteLocalSaveStore(context).also { store = it }
        return current.open(packageId)
    }

    fun environment(deliver: (String) -> Unit): LocalSaveDispatchEnvironment {
        val main = Handler(Looper.getMainLooper())
        return LocalSaveDispatchEnvironment(
            submit = { work -> enqueue(work) },
            schedule = { work, delay -> schedule(work, delay) },
            now = { TimeUnit.NANOSECONDS.toMillis(System.nanoTime()) },
            deliver = { response -> main.post { deliver(response) } },
        )
    }

    private fun enqueue(work: Runnable): Boolean = try {
        worker.execute(work)
        true
    } catch (_: RejectedExecutionException) {
        false
    }

    private fun schedule(work: Runnable, delay: Long): () -> Unit {
        val future = timer.schedule(work, delay, TimeUnit.MILLISECONDS)
        return { future.cancel(false) }
    }
}

class LocalSaveBridge private constructor(
    private val enabled: Boolean,
    private val dispatcher: LocalSaveDispatcher,
    private val reply: (String) -> Unit,
) {
    fun accept(raw: String): Boolean {
        val envelope = LocalSaveProtocol.envelope(raw) ?: return false
        LocalSaveProtocol.requestId(envelope)?.let { receive(it, envelope) }
        return true
    }

    private fun receive(id: String, envelope: JSONObject) {
        if (!enabled) {
            reply(LocalSaveProtocol.failure(id, "unsupported"))
            return
        }
        try {
            dispatcher.submit(LocalSaveProtocol.decode(envelope))
        } catch (error: LocalSaveException) {
            reply(LocalSaveProtocol.failure(id, error.code))
        } catch (_: Exception) {
            reply(LocalSaveProtocol.failure(id, "invalid_request"))
        }
    }

    fun close() = dispatcher.close()

    companion object {
        fun create(context: Context, launch: GameLaunch, reply: (String) -> Unit): LocalSaveBridge {
            val port = LocalSaveWorkers.port(context, launch.packageId)
            val dispatcher = LocalSaveDispatcher(port, LocalSaveWorkers.environment(reply))
            return LocalSaveBridge(LocalSaveLimits.CAPABILITY in launch.capabilities, dispatcher, reply)
        }
    }
}
