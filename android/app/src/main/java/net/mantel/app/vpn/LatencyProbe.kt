package net.mantel.app.vpn

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.security.SecureRandom
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object LatencyProbe {
    const val PINGS = 3
    const val TIMEOUT_MS = 1_500
    const val CONCURRENCY = 4
    const val MAX_TARGETS = 200
    const val REQUEST_SIZE = 32
    const val REPLY_SIZE = 24
    private const val NONCE_OFFSET = 8
    private const val NONCE_SIZE = 16
    private val MAGIC = byteArrayOf(0x4d, 0x4e, 0x54, 0x50)
    private val ID = Regex("^[A-Za-z0-9_-]{1,64}$")
    private val HOST = Regex("^[A-Za-z0-9.:-]{1,253}$")
    private val random = SecureRandom()

    data class Target(val id: String, val host: String, val port: Int)
    data class Measurement(val id: String, val samples: List<Double?>)

    fun sanitize(raw: List<Map<String, Any?>>): List<Target> =
        raw.asSequence()
            .mapNotNull { entry ->
                val id = entry["id"] as? String ?: return@mapNotNull null
                val host = (entry["host"] as? String)?.trim()?.removePrefix("[")?.removeSuffix("]") ?: return@mapNotNull null
                val port = (entry["port"] as? Number)?.toInt() ?: return@mapNotNull null
                if (!ID.matches(id) || !HOST.matches(host) || port !in 1..65535) null else Target(id, host, port)
            }
            .take(MAX_TARGETS)
            .toList()

    fun buildRequest(nonce: ByteArray): ByteArray {
        require(nonce.size == NONCE_SIZE) { "nonce must be 16 bytes" }
        val packet = ByteArray(REQUEST_SIZE)
        MAGIC.copyInto(packet, 0)
        packet[4] = 1
        packet[5] = 1
        nonce.copyInto(packet, NONCE_OFFSET)
        return packet
    }

    fun isReply(packet: ByteArray, length: Int, nonce: ByteArray): Boolean {
        if (length != REPLY_SIZE || nonce.size != NONCE_SIZE) return false
        for (i in 0 until 4) if (packet[i] != MAGIC[i]) return false
        if (packet[4].toInt() != 1 || packet[5].toInt() != 2 || packet[6].toInt() != 0 || packet[7].toInt() != 0) return false
        for (i in 0 until NONCE_SIZE) if (packet[NONCE_OFFSET + i] != nonce[i]) return false
        return true
    }

    private fun pingOnce(socket: DatagramSocket, address: InetAddress, port: Int, timeoutMs: Int): Double? {
        val nonce = ByteArray(NONCE_SIZE).also { random.nextBytes(it) }
        val request = buildRequest(nonce)
        val buffer = ByteArray(64)
        val started = System.nanoTime()
        val deadline = started + TimeUnit.MILLISECONDS.toNanos(timeoutMs.toLong())
        return try {
            socket.send(DatagramPacket(request, request.size, address, port))
            var rtt: Double? = null
            while (rtt == null) {
                val left = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime())
                if (left <= 0) break
                socket.soTimeout = left.toInt().coerceAtLeast(1)
                val packet = DatagramPacket(buffer, buffer.size)
                socket.receive(packet)
                if (isReply(packet.data, packet.length, nonce)) rtt = (System.nanoTime() - started) / 1_000_000.0
            }
            rtt
        } catch (_: SocketTimeoutException) {
            null
        } catch (_: Exception) {
            null
        }
    }

    fun measure(
        target: Target,
        pings: Int = PINGS,
        timeoutMs: Int = TIMEOUT_MS,
        resolve: (String) -> InetAddress = { InetAddress.getByName(it) },
        socketFactory: () -> DatagramSocket = { DatagramSocket() },
    ): Measurement {
        val empty = Measurement(target.id, List(pings) { null })
        val address = try {
            resolve(target.host)
        } catch (_: Exception) {
            return empty
        }
        val socket = try {
            socketFactory()
        } catch (_: Exception) {
            return empty
        }
        return socket.use { open -> Measurement(target.id, List(pings) { pingOnce(open, address, target.port, timeoutMs) }) }
    }

    fun measureAll(targets: List<Target>, timeoutMs: Int = TIMEOUT_MS, socketFactory: () -> DatagramSocket = { DatagramSocket() }): List<Measurement> {
        if (targets.isEmpty()) return emptyList()
        val pool = Executors.newFixedThreadPool(CONCURRENCY.coerceAtMost(targets.size)) { r -> Thread(r, "mantel-latency") }
        try {
            val futures = targets.map { target -> pool.submit(Callable { measure(target, timeoutMs = timeoutMs, socketFactory = socketFactory) }) }
            return futures.map { it.get() }
        } finally {
            pool.shutdownNow()
        }
    }
}
