package net.mantel.app.vpn.obfs

import android.util.Log
import java.io.Closeable
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketAddress

class ObfsRelay(
    private val endpoint: ObfsEndpoint,
    private val connect: (socket: Socket, host: String, port: Int, timeoutMs: Int) -> Unit =
        { socket, host, port, timeoutMs -> socket.connect(InetSocketAddress(host, port), timeoutMs) },
) : Closeable {
    companion object {
        private const val TAG = "MantelObfs"
        const val BACKOFF_START_MS = 1_000L
        const val BACKOFF_MAX_MS = 30_000L
    }

    private val udp = DatagramSocket(InetSocketAddress(InetAddress.getLoopbackAddress(), 0))

    val port: Int = udp.localPort

    @Volatile private var closed = false
    @Volatile private var current: ObfsConnection? = null
    @Volatile private var dialing: Socket? = null
    @Volatile private var peer: SocketAddress? = null
    private var upstream: Thread? = null
    private var downstream: Thread? = null

    fun dial(): ObfsConnection {
        val socket = Socket()
        dialing = socket
        try {
            if (closed) throw IOException("relay closed")
            connect(socket, endpoint.host, endpoint.port, ObfsClient.TIMEOUT_MS)
            return ObfsClient.dial(endpoint, socket)
        } catch (e: Exception) {
            runCatching { socket.close() }
            throw e
        } finally {
            dialing = null
        }
    }

    fun start(): ObfsRelay {
        val first = try {
            dial()
        } catch (e: Exception) {
            close()
            throw e
        }
        current = first
        upstream = Thread({ upstreamLoop(first) }, "mantel-obfs-up").apply { isDaemon = true; start() }
        downstream = Thread(::downstreamLoop, "mantel-obfs-down").apply { isDaemon = true; start() }
        return this
    }

    private fun upstreamLoop(first: ObfsConnection) {
        val buf = ByteArray(ObfsProtocol.MAX_FRAME)
        var conn: ObfsConnection? = first
        var backoff = BACKOFF_START_MS
        while (!closed) {
            if (conn == null) {
                conn = try {
                    dial()
                } catch (e: Exception) {
                    if (closed) break
                    Log.w(TAG, "redial failed (${e.javaClass.simpleName}), next try in ${backoff / 1000} s")
                    try {
                        Thread.sleep(backoff)
                    } catch (_: InterruptedException) {
                        break
                    }
                    backoff = minOf(backoff * 2, BACKOFF_MAX_MS)
                    continue
                }
                if (closed) {
                    conn.close()
                    break
                }
                backoff = BACKOFF_START_MS
                current = conn
                Log.i(TAG, "reconnected")
            }
            try {
                while (true) {
                    val n = conn.readPacket(buf)
                    val to = peer ?: continue
                    udp.send(DatagramPacket(buf, n, to))
                }
            } catch (_: IOException) {
            }
            current = null
            conn.close()
            conn = null
        }
        current?.close()
    }

    private fun downstreamLoop() {
        val buf = ByteArray(ObfsProtocol.MAX_FRAME)
        val packet = DatagramPacket(buf, buf.size)
        while (!closed) {
            try {
                packet.length = buf.size
                udp.receive(packet)
            } catch (_: IOException) {
                if (closed) return
                continue
            }
            if (!packet.address.isLoopbackAddress) continue
            peer = packet.socketAddress
            val conn = current ?: continue
            try {
                conn.writePacket(buf, packet.length)
            } catch (_: IOException) {
                conn.close()
            }
        }
    }

    override fun close() {
        closed = true
        udp.close()
        current?.close()
        dialing?.let { runCatching { it.close() } }
        upstream?.interrupt()
    }
}
