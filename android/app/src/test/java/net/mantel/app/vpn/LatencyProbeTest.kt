package net.mantel.app.vpn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import kotlin.concurrent.thread

class LatencyProbeTest {
    private fun startEcho(answer: Boolean = true, wrongNonce: Boolean = false): DatagramSocket {
        val socket = DatagramSocket(0, InetAddress.getLoopbackAddress())
        thread(isDaemon = true) {
            val buffer = ByteArray(64)
            while (!socket.isClosed) {
                val packet = DatagramPacket(buffer, buffer.size)
                try {
                    socket.receive(packet)
                } catch (_: Exception) {
                    break
                }
                if (!answer || packet.length != LatencyProbe.REQUEST_SIZE) continue
                val reply = packet.data.copyOfRange(0, LatencyProbe.REPLY_SIZE)
                reply[5] = 2
                if (wrongNonce) reply[8] = (reply[8] + 1).toByte()
                socket.send(DatagramPacket(reply, reply.size, packet.address, packet.port))
            }
        }
        return socket
    }

    @Test
    fun requestAndReplyFormat() {
        val nonce = ByteArray(16) { (it + 1).toByte() }
        val request = LatencyProbe.buildRequest(nonce)
        assertEquals(32, request.size)
        assertEquals(listOf(0x4d, 0x4e, 0x54, 0x50, 1, 1, 0, 0), request.take(8).map { it.toInt() })
        assertTrue(request.copyOfRange(24, 32).all { it.toInt() == 0 })
        val reply = request.copyOfRange(0, 24).also { it[5] = 2 }
        assertTrue(LatencyProbe.isReply(reply, 24, nonce))
        assertFalse(LatencyProbe.isReply(reply, 23, nonce))
        assertFalse(LatencyProbe.isReply(request, 32, nonce))
        assertFalse(LatencyProbe.isReply(reply, 24, ByteArray(16)))
        assertFalse(LatencyProbe.isReply(reply.copyOf().also { it[0] = 0 }, 24, nonce))
    }

    @Test
    fun sanitizeKeepsOnlyWellFormedTargets() {
        val targets = LatencyProbe.sanitize(
            listOf(
                mapOf("id" to "fra", "host" to "198.51.100.7", "port" to 51821),
                mapOf("id" to "v6", "host" to "[2001:db8::1]", "port" to 51821.0),
                mapOf("id" to "bad id", "host" to "198.51.100.7", "port" to 51821),
                mapOf("id" to "x", "host" to "evil host/../", "port" to 51821),
                mapOf("id" to "y", "host" to "198.51.100.7", "port" to 0),
                mapOf("id" to "z", "host" to null, "port" to 51821),
            ),
        )
        assertEquals(listOf(LatencyProbe.Target("fra", "198.51.100.7", 51821), LatencyProbe.Target("v6", "2001:db8::1", 51821)), targets)
        val many = (0 until 300).map { mapOf("id" to "n$it", "host" to "198.51.100.7", "port" to 51821) }
        assertEquals(LatencyProbe.MAX_TARGETS, LatencyProbe.sanitize(many).size)
    }

    @Test
    fun measuresThreeRoundTripsAgainstAnEcho() {
        val echo = startEcho()
        try {
            val result = LatencyProbe.measure(LatencyProbe.Target("local", "127.0.0.1", echo.localPort))
            assertEquals("local", result.id)
            assertEquals(3, result.samples.size)
            result.samples.forEach { sample ->
                assertNotNull(sample)
                assertTrue(sample!! >= 0 && sample < LatencyProbe.TIMEOUT_MS)
            }
        } finally {
            echo.close()
        }
    }

    @Test
    fun silenceOrForeignRepliesGiveNullSamples() {
        val silent = startEcho(answer = false)
        val liar = startEcho(wrongNonce = true)
        try {
            val results = LatencyProbe.measureAll(
                listOf(
                    LatencyProbe.Target("silent", "127.0.0.1", silent.localPort),
                    LatencyProbe.Target("liar", "127.0.0.1", liar.localPort),
                ),
                timeoutMs = 150,
            )
            assertEquals(listOf("silent", "liar"), results.map { it.id })
            results.forEach { assertEquals(listOf<Double?>(null, null, null), it.samples) }
        } finally {
            silent.close()
            liar.close()
        }
        val unresolved = LatencyProbe.measure(LatencyProbe.Target("u", "nodes.invalid", 51821), resolve = { throw java.net.UnknownHostException(it) })
        assertEquals(listOf<Double?>(null, null, null), unresolved.samples)
    }
}
