package dev.yougotserved.thorium

internal enum class AppUpdateInstallResult { SUBMITTED, PERMISSION_REQUIRED }

internal data class AppUpdateInstallerPort(
    val install: (AppUpdatePrepared) -> AppUpdateInstallResult,
    val permitted: () -> Boolean,
    val settings: () -> Unit,
    val outcome: () -> Boolean? = { null },
)

internal data class AppUpdatePorts(
    val discover: () -> AppUpdateCandidate?,
    val prepare: (AppUpdateCandidate) -> AppUpdatePrepared,
    val discard: (AppUpdatePrepared) -> Unit,
    val installer: AppUpdateInstallerPort,
)

internal data class AppUpdateExecution(
    val background: (() -> Unit) -> (() -> Unit),
    val foreground: (() -> Unit) -> Unit,
    val cleanup: (() -> Unit) -> Unit,
)

/** Mutable effect adapter. All state changes are serialized on the foreground executor. */
internal class AppUpdateController(
    private val ports: AppUpdatePorts,
    execution: AppUpdateExecution,
    changed: (AppUpdateState) -> Unit,
) : AutoCloseable {
    private var state = AppUpdateState()
    private val jobs = AppUpdateJobs(execution, ports.discard)
    private var closed = false
    private var active = true
    private val publish: (AppUpdateState) -> Unit = { next -> state = next; changed(next) }

    fun check() {
        if (closed || !active) return
        if (jobs.busy || state.stage != AppUpdateStage.HIDDEN) return
        runEffect(ports.discover) { candidate ->
            if (candidate != null) publish(AppUpdateState(AppUpdateStage.AVAILABLE, candidate))
        }
    }

    fun control(command: CatalogControllerCommand): Boolean {
        if (state.stage == AppUpdateStage.HIDDEN) return false
        when (command) {
            CatalogControllerCommand.ACTIVATE -> if (state.selected == 0) confirm() else dismiss()
            CatalogControllerCommand.BACK_OR_CLEAR -> dismiss()
            else -> publish(appUpdateMove(state, command))
        }
        return true
    }

    fun confirm() {
        when (state.stage) {
            AppUpdateStage.AVAILABLE -> download()
            AppUpdateStage.READY -> install()
            AppUpdateStage.PERMISSION -> runCatching(ports.installer.settings).onFailure { fail() }
            else -> Unit
        }
    }

    fun resume() {
        active = true
        if (jobs.busy) return
        val snapshot = state
        if (snapshot.stage !in setOf(AppUpdateStage.PERMISSION, AppUpdateStage.INSTALLING)) return
        runEffect({ resumeAppUpdate(snapshot, ports.installer) }, publish)
    }

    fun pause() {
        active = false
        if (state.stage == AppUpdateStage.HIDDEN || state.stage == AppUpdateStage.AVAILABLE) dismiss()
    }

    fun dismiss() {
        jobs.invalidate()
        state.prepared?.let(jobs::cleanup)
        publish(AppUpdateState())
    }

    override fun close() {
        dismiss()
        closed = true
    }

    private fun download() {
        val candidate = state.candidate ?: return
        publish(state.copy(stage = AppUpdateStage.DOWNLOADING))
        runEffect({ ports.prepare(candidate) }) { prepared ->
            publish(state.copy(stage = AppUpdateStage.READY, prepared = prepared, selected = 1))
        }
    }

    private fun install() {
        val prepared = state.prepared ?: return
        publish(state.copy(stage = AppUpdateStage.INSTALLING))
        runEffect({ ports.installer.install(prepared) }) { result ->
            val stage = if (result == AppUpdateInstallResult.PERMISSION_REQUIRED) {
                AppUpdateStage.PERMISSION
            } else { AppUpdateStage.INSTALLING }
            publish(state.copy(stage = stage, selected = 1))
            if (result == AppUpdateInstallResult.SUBMITTED) resume()
        }
    }

    private fun <T> runEffect(work: () -> T, complete: (T) -> Unit) {
        jobs.run(work) { result ->
            result.onSuccess(complete).onFailure {
                if (state.stage != AppUpdateStage.HIDDEN) fail()
            }
        }
    }

    private fun fail() {
        state.prepared?.let(jobs::cleanup)
        publish(state.copy(stage = AppUpdateStage.FAILED, prepared = null, selected = 1))
    }

}

private fun resumeAppUpdate(state: AppUpdateState, installer: AppUpdateInstallerPort): AppUpdateState {
    if (state.stage == AppUpdateStage.PERMISSION) {
        val stage = if (installer.permitted()) AppUpdateStage.READY else AppUpdateStage.PERMISSION
        return state.copy(stage = stage, selected = 1)
    }
    val stage = when (installer.outcome()) {
        true -> AppUpdateStage.HIDDEN
        false -> AppUpdateStage.FAILED
        null -> AppUpdateStage.INSTALLING
    }
    return state.copy(stage = stage, prepared = null, selected = 1)
}
