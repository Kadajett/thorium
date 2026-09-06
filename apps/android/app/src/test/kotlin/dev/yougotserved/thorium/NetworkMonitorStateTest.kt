package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Test

class NetworkMonitorStateTest {
    @Test
    fun wifiHandoverIgnoresOldNetworkCallbacks() {
        val old = NetworkMonitorState(1, NetworkStatus.ONLINE)
        val fresh = reduceNetworkMonitor(old, NetworkMonitorEvent.Available(2))
        assertEquals(NetworkStatus.CHECKING, fresh.visibleStatus)
        assertEquals(fresh, reduceNetworkMonitor(fresh, NetworkMonitorEvent.Lost(1)))
        assertEquals(fresh, reduceNetworkMonitor(fresh, NetworkMonitorEvent.Blocked(1, true)))
        assertEquals(fresh, reduceNetworkMonitor(fresh, NetworkMonitorEvent.Capabilities(1, NetworkStatus.ONLINE)))
        val online = reduceNetworkMonitor(fresh, NetworkMonitorEvent.Capabilities(2, NetworkStatus.ONLINE))
        assertEquals(NetworkStatus.ONLINE, online.visibleStatus)
        assertEquals(NetworkStatus.ONLINE, old.visibleStatus)
    }

    @Test
    fun deviceNetworkBlockingOverridesValidationUntilAccessIsRestored() {
        val state = NetworkMonitorState(1, NetworkStatus.ONLINE)
        val blocked = reduceNetworkMonitor(state, NetworkMonitorEvent.Blocked(1, true))
        assertEquals(NetworkStatus.LIMITED, blocked.visibleStatus)
        val validated = reduceNetworkMonitor(blocked, NetworkMonitorEvent.Capabilities(1, NetworkStatus.ONLINE))
        assertEquals(NetworkStatus.LIMITED, validated.visibleStatus)
        val restored = reduceNetworkMonitor(validated, NetworkMonitorEvent.Blocked(1, false))
        assertEquals(NetworkStatus.ONLINE, restored.visibleStatus)
        val lost = reduceNetworkMonitor(blocked, NetworkMonitorEvent.Lost(1))
        assertEquals(NetworkStatus.OFFLINE, lost.visibleStatus)
        assertEquals(null, lost.networkId)
    }
}
