package dev.yougotserved.thorium

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper

/** Lifecycle-owned adapter; callbacks only report status, never perform network I/O. */
internal fun observeAndroidNetwork(context: Context, changed: (NetworkStatus) -> Unit): AutoCloseable {
    val manager = context.getSystemService(ConnectivityManager::class.java)
    val callback = AndroidNetworkCallback(changed)
    manager.registerDefaultNetworkCallback(callback, Handler(Looper.getMainLooper()))
    val initial = manager.activeNetwork
    changed(if (initial == null) NetworkStatus.OFFLINE else NetworkStatus.CHECKING)
    return AutoCloseable { manager.unregisterNetworkCallback(callback) }
}

private class AndroidNetworkCallback(private val changed: (NetworkStatus) -> Unit) :
    ConnectivityManager.NetworkCallback() {
    private var state = NetworkMonitorState()

    override fun onAvailable(network: Network) {
        send(NetworkMonitorEvent.Available(network.networkHandle))
    }

    override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
        val status = networkStatus(
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),
        )
        send(NetworkMonitorEvent.Capabilities(network.networkHandle, status))
    }

    override fun onBlockedStatusChanged(network: Network, blocked: Boolean) {
        send(NetworkMonitorEvent.Blocked(network.networkHandle, blocked))
    }

    override fun onLost(network: Network) {
        send(NetworkMonitorEvent.Lost(network.networkHandle))
    }

    private fun send(event: NetworkMonitorEvent) {
        state = reduceNetworkMonitor(state, event)
        changed(state.visibleStatus)
    }
}
