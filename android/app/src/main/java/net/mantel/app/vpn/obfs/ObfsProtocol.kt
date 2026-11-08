package net.mantel.app.vpn.obfs

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.DataInputStream
import java.io.EOFException
import java.io.IOException
import java.io.BufferedInputStream
import java.io.OutputStream
import java.net.Socket
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.Base64
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509ExtendedTrustManager

data class ObfsEndpoint(val host: String, val port: Int, val pin: String, val token: String) {
    val display: String get() = "${ObfsProtocol.hostHeader(host)}:$port"

    fun toJson(): JSONObject = JSONObject().put("host", host).put("port", port).put("pin", pin).put("token", token)

    override fun toString() = "ObfsEndpoint($display)"

    companion object {
        private val PIN = Regex("^[A-Za-z0-9+/]{43}=$")
        private val TOKEN = Regex("^[A-Za-z0-9._~+/=-]{1,256}$")
        private val HOST = Regex("^[A-Za-z0-9.:-]{1,253}$")

        fun of(host: String?, port: Int?, pin: String?, token: String?): ObfsEndpoint? {
            if (host == null || !HOST.matches(host) || port == null || port !in 1..65535) return null
            if (pin == null || !PIN.matches(pin) || token == null || !TOKEN.matches(token)) return null
            return ObfsEndpoint(host, port, pin, token)
        }

        fun fromJson(o: JSONObject?): ObfsEndpoint? =
            o?.let { of(it.optString("host", ""), it.optInt("port", 0), it.optString("pin", ""), it.optString("token", "")) }
    }
}

class ObfsRejected(val status: Int) : IOException("server rejected the tunnel (HTTP $status)")

class ObfsPinMismatch : CertificateException("server key does not match the pin")

object ObfsProtocol {
    const val VERSION = 1
    const val UPGRADE = "mantel/1"
    const val MAX_FRAME = 16384
    private const val MAX_HEAD = 8 * 1024

    fun pin(spki: ByteArray): String =
        Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(spki))

    fun pinMatches(spki: ByteArray, pin: String): Boolean =
        MessageDigest.isEqual(pin(spki).toByteArray(Charsets.US_ASCII), pin.toByteArray(Charsets.US_ASCII))

    fun hostHeader(host: String): String = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host

    fun upgradeRequest(host: String, token: String): ByteArray =
        ("GET / HTTP/1.1\r\nHost: ${hostHeader(host)}\r\nConnection: Upgrade\r\nUpgrade: $UPGRADE\r\n" +
            "Authorization: Bearer $token\r\n\r\n").toByteArray(Charsets.US_ASCII)

    fun readStatus(input: java.io.InputStream): Int {
        val head = ByteArrayOutputStream()
        var matched = 0
        while (matched < 4) {
            val b = input.read()
            if (b < 0) throw EOFException("connection closed before the response")
            if (head.size() >= MAX_HEAD) throw IOException("response head too large")
            head.write(b)
            matched = when {
                b == '\r'.code -> if (matched == 2) 3 else 1
                b == '\n'.code && (matched == 1 || matched == 3) -> matched + 1
                else -> 0
            }
        }
        val parts = head.toString(Charsets.US_ASCII.name()).substringBefore("\r\n").split(' ')
        if (parts.size < 2 || !parts[0].startsWith("HTTP/1.")) throw IOException("not an HTTP response")
        return parts[1].toIntOrNull() ?: throw IOException("no HTTP status")
    }

    fun writeFrame(out: OutputStream, packet: ByteArray, length: Int) {
        if (length !in 1..MAX_FRAME) throw IOException("invalid frame length $length")
        val frame = ByteArray(2 + length)
        frame[0] = (length ushr 8).toByte()
        frame[1] = length.toByte()
        System.arraycopy(packet, 0, frame, 2, length)
        out.write(frame)
        out.flush()
    }

    fun readFrame(input: DataInputStream, buf: ByteArray): Int {
        val size = input.readUnsignedShort()
        if (size == 0 || size > buf.size) throw IOException("invalid frame length $size")
        input.readFully(buf, 0, size)
        return size
    }
}

class ObfsConnection internal constructor(private val socket: SSLSocket, private val input: DataInputStream) : Closeable {
    private val output = socket.outputStream

    fun readPacket(buf: ByteArray): Int = ObfsProtocol.readFrame(input, buf)

    @Synchronized
    fun writePacket(packet: ByteArray, length: Int) = ObfsProtocol.writeFrame(output, packet, length)

    override fun close() {
        runCatching { socket.close() }
    }
}

object ObfsClient {
    const val TIMEOUT_MS = 15_000

    const val READ_IDLE_MS = 180_000

    fun dial(endpoint: ObfsEndpoint, plain: Socket): ObfsConnection {
        try {
            plain.soTimeout = TIMEOUT_MS
            plain.tcpNoDelay = true
            val ip = plain.inetAddress?.hostAddress ?: throw IOException("socket not connected")
            val context = SSLContext.getInstance("TLS")
            context.init(null, arrayOf(PinTrustManager(endpoint.pin)), null)
            val ssl = context.socketFactory.createSocket(plain, ip, endpoint.port, true) as SSLSocket
            ssl.sslParameters = ssl.sslParameters.apply {
                protocols = arrayOf("TLSv1.3")
                serverNames = emptyList()
                applicationProtocols = arrayOf("http/1.1")
                endpointIdentificationAlgorithm = null
            }
            ssl.startHandshake()
            ssl.outputStream.apply {
                write(ObfsProtocol.upgradeRequest(ip, endpoint.token))
                flush()
            }
            val input = DataInputStream(BufferedInputStream(ssl.inputStream, ObfsProtocol.MAX_FRAME + 2))
            val status = ObfsProtocol.readStatus(input)
            if (status != 101) throw ObfsRejected(status)
            ssl.soTimeout = READ_IDLE_MS
            return ObfsConnection(ssl, input)
        } catch (e: Exception) {
            runCatching { plain.close() }
            throw e
        }
    }

    fun isPinMismatch(error: Throwable): Boolean = generateSequence(error) { it.cause }.take(8).any { it is ObfsPinMismatch }
}

private class PinTrustManager(private val pin: String) : X509ExtendedTrustManager() {
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val leaf = chain?.firstOrNull() ?: throw CertificateException("no server certificate")
        if (!ObfsProtocol.pinMatches(leaf.publicKey.encoded, pin)) throw ObfsPinMismatch()
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) =
        checkServerTrusted(chain, authType)

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) =
        checkServerTrusted(chain, authType)

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) =
        throw CertificateException("client certificates are not accepted")

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) =
        checkClientTrusted(chain, authType)

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) =
        checkClientTrusted(chain, authType)

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}
