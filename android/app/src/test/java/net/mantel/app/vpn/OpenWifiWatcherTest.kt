package net.mantel.app.vpn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OpenWifiWatcherTest {
    @Test
    fun classifiesTheSecurityType() {
        assertEquals(OpenWifiWatcher.UNKNOWN, OpenWifiWatcher.classify(null))
        assertEquals(OpenWifiWatcher.UNKNOWN, OpenWifiWatcher.classify(-1))
        assertEquals(OpenWifiWatcher.OPEN, OpenWifiWatcher.classify(0))
        assertEquals(OpenWifiWatcher.SECURED, OpenWifiWatcher.classify(1))
        assertEquals(OpenWifiWatcher.SECURED, OpenWifiWatcher.classify(2))
        assertEquals(OpenWifiWatcher.SECURED, OpenWifiWatcher.classify(6))
    }

    @Test
    fun connectsOnlyOnceOnANewOpenWifiWithoutTunnel() {
        val open = OpenWifiWatcher.OPEN
        assertTrue(OpenWifiWatcher.shouldAutoConnect(open, enabled = true, newNetwork = true, tunnelActive = false, canStart = true))
        assertFalse(OpenWifiWatcher.shouldAutoConnect(open, enabled = false, newNetwork = true, tunnelActive = false, canStart = true))
        assertFalse(OpenWifiWatcher.shouldAutoConnect(open, enabled = true, newNetwork = false, tunnelActive = false, canStart = true))
        assertFalse(OpenWifiWatcher.shouldAutoConnect(open, enabled = true, newNetwork = true, tunnelActive = true, canStart = true))
        assertFalse(OpenWifiWatcher.shouldAutoConnect(open, enabled = true, newNetwork = true, tunnelActive = false, canStart = false))
        assertFalse(OpenWifiWatcher.shouldAutoConnect(OpenWifiWatcher.SECURED, enabled = true, newNetwork = true, tunnelActive = false, canStart = true))
        assertFalse(OpenWifiWatcher.shouldAutoConnect(OpenWifiWatcher.UNKNOWN, enabled = true, newNetwork = true, tunnelActive = false, canStart = true))
    }
}
