package net.mantel.app.vpn

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TunnelStatusStaleTest {
    private val now = 1_800_000_000_000L
    private fun up(lastHandshakeAt: Long?, startedAt: Long? = now - 600_000) =
        TunnelStatus(state = TunnelStatus.STATE_UP, startedAt = startedAt, lastHandshakeAt = lastHandshakeAt)

    @Test
    fun freshHandshakeIsNotStale() {
        assertFalse(up(now - 10_000).isStale(now))
        assertFalse(up(now - TunnelStatus.STALE_HANDSHAKE_MS).isStale(now))
    }

    @Test
    fun noHandshakeForMoreThanThreeMinutesIsStale() {
        assertTrue(up(now - TunnelStatus.STALE_HANDSHAKE_MS - 1).isStale(now))
    }

    @Test
    fun noHandshakeAtAllCountsFromTheStartAfterTheGracePeriod() {
        assertFalse(up(null, startedAt = now - 5_000).isStale(now))
        assertTrue(up(null, startedAt = now - TunnelStatus.HANDSHAKE_GRACE_MS - 1).isStale(now))
        assertFalse(up(null, startedAt = null).isStale(now))
    }

    @Test
    fun onlyARunningTunnelCanBeStale() {
        assertFalse(TunnelStatus(state = TunnelStatus.STATE_DOWN, lastHandshakeAt = now - 999_999).isStale(now))
        assertFalse(TunnelStatus(state = TunnelStatus.STATE_CONNECTING, startedAt = now - 999_999).isStale(now))
    }
}
