package dev.yougotserved.thorium

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalSaveDispatcherTest {
    @Test
    fun requestsRunOnlyOnWorkerAndCompleteOnce() {
        val fixture = SaveDispatchFixture()
        fixture.dispatcher.submit(request("first"))
        assertEquals(0, fixture.calls)
        fixture.work.single().run()
        fixture.work.single().run()
        assertEquals(1, fixture.calls)
        assertEquals("ok", JSONObject(fixture.responses.single()).getString("status"))
        assertTrue(fixture.timers.isEmpty())
    }

    @Test
    fun queueAndPendingRequestsAreBounded() {
        val fixture = SaveDispatchFixture()
        repeat(5) { fixture.dispatcher.submit(request("save-$it")) }
        assertEquals(4, fixture.work.size)
        assertEquals("busy", error(fixture.responses.single()))
        fixture.dispatcher.close()
        fixture.work.forEach(Runnable::run)
        assertEquals(0, fixture.calls)
        assertTrue(fixture.timers.isEmpty())
    }

    @Test
    fun timedOutQueuedWriteNeverReachesStorage() {
        val fixture = SaveDispatchFixture()
        fixture.dispatcher.submit(request("first"))
        fixture.timers.values.single().run()
        fixture.work.single().run()
        assertEquals(0, fixture.calls)
        assertEquals("timeout", error(fixture.responses.single()))
    }

    @Test
    fun expiredDeadlineRejectsEvenBeforeTimerCallbackRuns() {
        val fixture = SaveDispatchFixture()
        fixture.dispatcher.submit(request("first"))
        fixture.time = 5000
        fixture.work.single().run()
        assertEquals(0, fixture.calls)
        assertEquals("timeout", error(fixture.responses.single()))
    }

    @Test
    fun saturatedWorkerReleasesPendingRequestAndTimer() {
        val fixture = SaveDispatchFixture()
        fixture.acceptWork = false
        fixture.dispatcher.submit(request("first"))
        assertEquals("busy", error(fixture.responses.single()))
        assertTrue(fixture.timers.isEmpty())
    }

    @Test
    fun inFlightCommitMayFinishAfterCloseButCannotReplyToDestroyedSurface() {
        val fixture = SaveDispatchFixture()
        fixture.beforeCommit = { fixture.dispatcher.close() }
        fixture.dispatcher.submit(request("first"))
        fixture.work.single().run()
        assertEquals(1, fixture.calls)
        assertTrue(fixture.responses.isEmpty())
        assertTrue(fixture.timers.isEmpty())
    }

    private fun request(id: String) = LocalSaveRequest(
        id, LocalSaveCommand(LocalSaveOperation.WRITE, "run", valueJson = "1"),
    )
    private fun error(response: String) = JSONObject(response).getString("error")
}

private class SaveDispatchFixture {
    val work = mutableListOf<Runnable>()
    val timers = mutableMapOf<Int, Runnable>()
    val responses = mutableListOf<String>()
    var time = 0L
    var calls = 0
    var acceptWork = true
    var beforeCommit: () -> Unit = {}
    private var timerSequence = 0
    private val port = LocalSavePort {
        beforeCommit()
        calls++
        LocalSaveResult.Written(1)
    }
    val dispatcher = LocalSaveDispatcher(port, LocalSaveDispatchEnvironment(
        submit = { if (acceptWork) work.add(it) else false },
        schedule = ::schedule,
        now = { time },
        deliver = { responses.add(it) },
    ))

    private fun schedule(task: Runnable, delay: Long): () -> Unit {
        assertEquals(5000L, delay)
        val id = ++timerSequence
        timers[id] = task
        return { timers.remove(id) }
    }
}
