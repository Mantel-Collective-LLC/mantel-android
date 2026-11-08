package net.mantel.app.vpn.obfs

import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.BeforeClass
import org.junit.Test
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.File
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.security.KeyStore
import java.security.cert.X509Certificate
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import javax.net.ssl.ExtendedSSLSession
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLServerSocket
import javax.net.ssl.SSLSocket

class ObfsRelayTest {
    companion object {
        private const val TOKEN = "tok_relay_test_0123456789"
        private const val PASSWORD = "test-only"
        private lateinit var dir: File
        private lateinit var server: EchoServer
        private lateinit var pin: String

        @BeforeClass
        @JvmStatic
        fun startServer() {
            dir = createTempDir()
            val store = File(dir, "obfs-test.p12")
            val keytool = File(System.getProperty("java.home"), "bin/keytool").let { if (it.exists()) it else File(it.path + ".exe") }
            val process = ProcessBuilder(
                keytool.path, "-genkeypair", "-alias", "obfs", "-keyalg", "EC", "-groupname", "secp256r1",
                "-sigalg", "SHA256withECDSA", "-dname", "CN=obfs-test", "-validity", "2", "-storetype", "PKCS12",
                "-keystore", store.path, "-storepass", PASSWORD, "-keypass", PASSWORD, "-noprompt",
            ).redirectErrorStream(true).start()
            val output = process.inputStream.readBytes().decodeToString()
            assertTrue("keytool: $output", process.waitFor(60, TimeUnit.SECONDS) && process.exitValue() == 0)
            val keyStore = KeyStore.getInstance("PKCS12").apply { store.inputStream().use { load(it, PASSWORD.toCharArray()) } }
            pin = ObfsProtocol.pin((keyStore.getCertificate("obfs") as X509Certificate).publicKey.encoded)
            server = EchoServer(keyStore)
        }

        @AfterClass
        @JvmStatic
        fun stopServer() {
            server.close()
            dir.deleteRecursively()
        }

        @Suppress("DEPRECATION")
        private fun createTempDir(): File = kotlin.io.createTempDir("obfs-test")
    }

    class EchoServer(keyStore: KeyStore) : AutoCloseable {
        private val socket: SSLServerSocket
        val accepted = CopyOnWriteArrayList<SSLSocket>()
        val serverNames = CopyOnWriteArrayList<Int>()
        val alpn = CopyOnWriteArrayList<String?>()
        val heads = CopyOnWriteArrayList<String>()
        val port: Int get() = socket.localPort

        init {
            val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(keyStore, PASSWORD.toCharArray()) }
            val context = SSLContext.getInstance("TLS").apply { init(kmf.keyManagers, null, null) }
            socket = context.serverSocketFactory.createServerSocket(0, 50, InetAddress.getLoopbackAddress()) as SSLServerSocket
            socket.sslParameters = socket.sslParameters.apply { applicationProtocols = arrayOf("http/1.1") }
            Thread({
                while (!socket.isClosed) {
                    val client = runCatching { socket.accept() as SSLSocket }.getOrNull() ?: break
                    accepted.add(client)
                    Thread({ runCatching { handle(client) }; runCatching { client.close() } }, "echo-conn").apply { isDaemon = true }.start()
                }
            }, "echo-accept").apply { isDaemon = true }.start()
        }

        private fun handle(client: SSLSocket) {
            client.startHandshake()
            serverNames.add((client.session as ExtendedSSLSession).requestedServerNames.size)
            alpn.add(client.applicationProtocol)
            val input = DataInputStream(BufferedInputStream(client.inputStream))
            val head = StringBuilder()
            while (!head.endsWith("\r\n\r\n")) head.append(input.read().takeIf { it >= 0 }?.toChar() ?: return)
            heads.add(head.toString())
            val ok = head.contains("Authorization: Bearer $TOKEN\r\n") && head.contains("Upgrade: mantel/1\r\n") &&
                head.contains("Connection: Upgrade\r\n")
            val out = client.outputStream
            if (!ok) {
                out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".toByteArray())
                out.flush()
                return
            }
            out.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: mantel/1\r\n\r\n".toByteArray())
            out.flush()
            val buf = ByteArray(ObfsProtocol.MAX_FRAME)
            while (true) {
                val n = ObfsProtocol.readFrame(input, buf)
                ObfsProtocol.writeFrame(out, buf, n)
            }
        }

        fun dropAll() = accepted.forEach { runCatching { it.close() } }

        override fun close() {
            socket.close()
            dropAll()
        }
    }

    private fun endpoint(token: String = TOKEN, pin: String = Companion.pin) =
        ObfsEndpoint.of("127.0.0.1", server.port, pin, token)!!

    private fun echo(wg: DatagramSocket, relayPort: Int, payload: ByteArray, timeoutMs: Long = 10_000): ByteArray {
        val deadline = System.currentTimeMillis() + timeoutMs
        val buf = ByteArray(2048)
        wg.soTimeout = 300
        while (System.currentTimeMillis() < deadline) {
            wg.send(DatagramPacket(payload, payload.size, InetSocketAddress(ObfsRelay.HOST, relayPort)))
            val packet = DatagramPacket(buf, buf.size)
            try {
                wg.receive(packet)
                return buf.copyOf(packet.length)
            } catch (_: SocketTimeoutException) {
            }
        }
        fail("no echo within $timeoutMs ms")
        error("unreachable")
    }

    @Test
    fun relaysDatagramsThroughTlsAndRedials() {
        ObfsRelay(endpoint()).start().use { relay ->
            DatagramSocket(InetSocketAddress(InetAddress.getLoopbackAddress(), 0)).use { wg ->
                val first = "handshake initiation".toByteArray()
                assertEquals(String(first), String(echo(wg, relay.port, first)))
                val big = ByteArray(1420) { (it % 251).toByte() }
                assertTrue(big.contentEquals(echo(wg, relay.port, big)))

                server.dropAll()
                val after = "after reconnect".toByteArray()
                assertEquals(String(after), String(echo(wg, relay.port, after)))
            }
        }
        assertTrue("no SNI", server.serverNames.all { it == 0 })
        assertTrue("ALPN http/1.1", server.alpn.all { it == "http/1.1" })
        assertTrue(server.heads.first().startsWith("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n"))
    }

    @Test
    fun wrongTokenIsRejected() {
        try {
            ObfsRelay(endpoint(token = "tok_wrong_0000000000")).start()
            fail("expected a rejection")
        } catch (e: ObfsRejected) {
            assertEquals(404, e.status)
        }
    }

    @Test
    fun wrongPinFailsTheHandshake() {
        try {
            ObfsRelay(endpoint(pin = ObfsProtocol.pin(ByteArray(1)))).start()
            fail("expected a pin mismatch")
        } catch (e: Exception) {
            assertTrue("pin mismatch in $e", ObfsClient.isPinMismatch(e))
        }
    }
}
