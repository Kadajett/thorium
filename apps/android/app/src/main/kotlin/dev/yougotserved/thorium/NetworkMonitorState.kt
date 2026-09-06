package dev.yougotserved.thorium

internal data class NetworkMonitorState(
    val networkId: Long? = null,
    val status: NetworkStatus = NetworkStatus.CHECKING,
    val blocked: Boolean = false,
) {
    val visibleStatus: NetworkStatus
        get() = if (blocked) NetworkStatus.LIMITED else status
}

internal sealed interface NetworkMonitorEvent {
    val networkId: Long
    data class Available(override val networkId: Long) : NetworkMonitorEvent
    data class Lost(override val networkId: Long) : NetworkMonitorEvent
    data class Capabilities(override val networkId: Long, val status: NetworkStatus) : NetworkMonitorEvent
    data class Blocked(override val networkId: Long, val blocked: Boolean) : NetworkMonitorEvent
}

internal fun reduceNetworkMonitor(state: NetworkMonitorState, event: NetworkMonitorEvent): NetworkMonitorState {
    if (event is NetworkMonitorEvent.Available) return NetworkMonitorState(event.networkId)
    return if (event.networkId != state.networkId) state else updateCurrentNetwork(state, event)
}

private fun updateCurrentNetwork(state: NetworkMonitorState, event: NetworkMonitorEvent): NetworkMonitorState =
    when (event) {
        is NetworkMonitorEvent.Capabilities -> state.copy(status = event.status)
        is NetworkMonitorEvent.Blocked -> state.copy(blocked = event.blocked)
        is NetworkMonitorEvent.Lost -> NetworkMonitorState(status = NetworkStatus.OFFLINE)
        is NetworkMonitorEvent.Available -> state
    }
