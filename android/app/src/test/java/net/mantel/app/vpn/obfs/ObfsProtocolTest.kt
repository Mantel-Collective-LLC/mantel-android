package net.mantel.app.vpn.obfs

import com.wireguard.config.Config
import net.mantel.app.vpn.SavedTunnel
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.BufferedReader
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.IOException
import java.io.StringReader

class ObfsProtocolTest {
    private val pin = ObfsProtocol.pin(ByteArray(0))
    private val endpoint = ObfsEndpoint.of("198.51.100.7", 443, pin, "tok_abc")!!

    @Test
    fun pinIsBase64Sha256OfTheSpki() {
        assertEquals("47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=", pin)
        assertTrue(ObfsProtocol.pinMatches(ByteArray(0), pin))
        assertFalse(ObfsProtocol.pinMatches(byteArrayOf(1), pin))
    }

    @Test
    fun upgradeRequestMatchesTheGoClient() {
        assertEquals(
            "GET / HTTP/1.1\r\nHost: 198.51.100.7\r\nConnection: Upgrade\r\nUpgrade: mantel/1\r\nAuthorization: Bearer tok\r\n\r\n",
            String(ObfsProtocol.upgradeRequest("198.51.100.7", "tok"), Charsets.US_ASCII),
        )
        assertTrue(String(ObfsProtocol.upgradeRequest("2001:db8::1", "tok"), Charsets.US_ASCII).contains("Host: [2001:db8::1]\r\n"))
    }

    @Test
    fun statusParserStopsAtTheBlankLine() {
        val frame = byteArrayOf(0, 2, 7, 8)
        val bytes = "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: mantel/1\r\n\r\n".toByteArray() + frame
        val input = DataInputStream(ByteArrayInputStream(bytes))
        assertEquals(101, ObfsProtocol.readStatus(input))
        val buf = ByteArray(ObfsProtocol.MAX_FRAME)
        assertEquals(2, ObfsProtocol.readFrame(input, buf))
        assertArrayEquals(byteArrayOf(7, 8), buf.copyOf(2))

        assertEquals(404, ObfsProtocol.readStatus(ByteArrayInputStream("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".toByteArray())))
        assertThrows { ObfsProtocol.readStatus(ByteArrayInputStream("SSH-2.0-x\r\n\r\n".toByteArray())) }
        assertThrows { ObfsProtocol.readStatus(ByteArrayInputStream("HTTP/1.1 101".toByteArray())) }
        assertThrows { ObfsProtocol.readStatus(ByteArrayInputStream(ByteArray(9000) { 'a'.code.toByte() })) }
    }

    @Test
    fun framesRoundTripAndRejectBadLengths() {
        val out = ByteArrayOutputStream()
        val packet = ByteArray(ObfsProtocol.MAX_FRAME) { it.toByte() }
        ObfsProtocol.writeFrame(out, packet, 3)
        ObfsProtocol.writeFrame(out, packet, ObfsProtocol.MAX_FRAME)
        val bytes = out.toByteArray()
        assertArrayEquals(byteArrayOf(0, 3, 0, 1, 2), bytes.copyOf(5))
        assertEquals(0x40.toByte(), bytes[5])
        val input = DataInputStream(ByteArrayInputStream(bytes))
        val buf = ByteArray(ObfsProtocol.MAX_FRAME)
        assertEquals(3, ObfsProtocol.readFrame(input, buf))
        assertEquals(ObfsProtocol.MAX_FRAME, ObfsProtocol.readFrame(input, buf))
        assertArrayEquals(packet, buf)

        assertThrows { ObfsProtocol.writeFrame(ByteArrayOutputStream(), packet, 0) }
        assertThrows { ObfsProtocol.writeFrame(ByteArrayOutputStream(), ByteArray(20000), 16385) }
        assertThrows { ObfsProtocol.readFrame(DataInputStream(ByteArrayInputStream(byteArrayOf(0, 0))), buf) }
        assertThrows { ObfsProtocol.readFrame(DataInputStream(ByteArrayInputStream(byteArrayOf(0x40, 1))), buf) }
        assertThrows { ObfsProtocol.readFrame(DataInputStream(ByteArrayInputStream(byteArrayOf(0, 5, 1))), buf) }
    }

    @Test
    fun endpointValidationKeepsHeadersClean() {
        assertEquals("198.51.100.7:443", endpoint.display)
        assertEquals("[2001:db8::1]:443", ObfsEndpoint.of("2001:db8::1", 443, pin, "t")!!.display)
        assertNull(ObfsEndpoint.of("198.51.100.7", 443, pin, "tok\r\nX-Evil: 1"))
        assertNull(ObfsEndpoint.of("198.51.100.7", 443, pin, "tok en"))
        assertNull(ObfsEndpoint.of("198.51.100.7", 443, pin, "a".repeat(257)))
        assertNull(ObfsEndpoint.of("bad host", 443, pin, "tok"))
        assertNull(ObfsEndpoint.of("198.51.100.7", 0, pin, "tok"))
        assertNull(ObfsEndpoint.of("198.51.100.7", 443, "short", "tok"))
        assertNull(ObfsEndpoint.of("198.51.100.7", 443, pin, null))
        assertEquals(endpoint, ObfsEndpoint.fromJson(endpoint.toJson()))
        assertFalse(endpoint.toString().contains("tok_abc"))
    }

    @Test
    fun savedTunnelKeepsTheOffer() {
        val saved = SavedTunnel("cfg", "fra", "Frankfurt", listOf("a.b"), postQuantum = true, obfuscation = endpoint)
        assertEquals(saved, SavedTunnel.fromJson(saved.toJson()))
        val old = SavedTunnel.fromJson("""{"config":"cfg","nodeId":"fra","label":"F","excludedApps":[]}""")
        assertNull(old.obfuscation)
    }

    @Test
    fun planFollowsTheSetting() {
        val plan = Obfuscation::plan
        assertEquals(Obfuscation.Plan.Classic, plan(Obfuscation.OFF, endpoint, 36, true))
        assertEquals(Obfuscation.Plan.Direct(endpoint), plan(Obfuscation.ON, endpoint, 36, false))
        assertEquals(Obfuscation.Plan.Unavailable(Obfuscation.ERROR_UNAVAILABLE), plan(Obfuscation.ON, null, 36, false))
        assertEquals(Obfuscation.Plan.Unavailable(Obfuscation.ERROR_OLD_ANDROID), plan(Obfuscation.ON, endpoint, 28, false))
        assertEquals(Obfuscation.Plan.Probe(endpoint), plan(Obfuscation.AUTO, endpoint, 36, false))
        assertEquals(Obfuscation.Plan.Direct(endpoint), plan(Obfuscation.AUTO, endpoint, 36, true))
        assertEquals(Obfuscation.Plan.Classic, plan(Obfuscation.AUTO, null, 36, true))
        assertEquals(Obfuscation.Plan.Classic, plan(Obfuscation.AUTO, endpoint, 28, false))
        assertEquals(Obfuscation.Plan.Probe(endpoint), plan("unknown", endpoint, 36, false))
    }

    @Test
    fun networksAreRememberedInMemoryWithACap() {
        val networks = ObfsNetworks(max = 2)
        assertFalse(networks.contains(null))
        networks.remember(null)
        networks.remember(1)
        networks.remember(2)
        assertTrue(networks.contains(1))
        networks.remember(1)
        networks.remember(3)
        assertFalse(networks.contains(2))
        assertTrue(networks.contains(1) && networks.contains(3))
    }

    @Test
    fun configGoesThroughTheRelayWithKeepalive() {
        val text = """
            [Interface]
            PrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=
            Address = 10.64.0.2/32
            DNS = 10.64.0.1

            [Peer]
            PublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=
            PresharedKey = FpCyhws9cxwWoV4xELtfJvjJN+zQVRPISllRWgeopVE=
            AllowedIPs = 0.0.0.0/0, ::/0
            Endpoint = 198.51.100.7:51820
        """.trimIndent()
        val config = Config.parse(BufferedReader(StringReader(text)))
        val through = Obfuscation.throughRelay(config, 40000)
        val peer = through.peers.single()
        assertEquals("127.0.0.1:40000", peer.endpoint.get().toString())
        assertEquals(25, peer.persistentKeepalive.get())
        assertEquals(config.peers[0].allowedIps, peer.allowedIps)
        assertEquals(config.peers[0].preSharedKey, peer.preSharedKey)
        assertEquals(config.peers[0].publicKey, peer.publicKey)
        assertEquals(config.`interface`, through.`interface`)
    }

    private fun assertThrows(block: () -> Unit) {
        try {
            block()
        } catch (_: IOException) {
            return
        }
        fail("expected an IOException")
    }
}
