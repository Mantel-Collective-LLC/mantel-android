package net.mantel.app.vpn

import com.wireguard.config.Config
import com.wireguard.crypto.Key
import com.wireguard.crypto.KeyPair
import net.mantel.app.vpn.obfs.ObfsEndpoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import java.io.BufferedReader
import java.io.StringReader

class NodeKeyRefreshTest {
    private val oldKey = KeyPair().publicKey.toBase64()
    private val newKey = KeyPair().publicKey.toBase64()
    private val pinA = "A".repeat(43) + "="
    private val pinB = "B".repeat(43) + "="
    private val config = """
        [Interface]
        PrivateKey = ${KeyPair().privateKey.toBase64()}
        Address = 10.8.0.2/32

        [Peer]
        PublicKey = $oldKey
        AllowedIPs = 0.0.0.0/0
        Endpoint = 203.0.113.7:51820
    """.trimIndent()
    private val obfs = ObfsEndpoint("203.0.113.7", 443, pinA, "tok")
    private val saved = SavedTunnel(config, "hk-2", "Hong Kong", emptyList(), obfuscation = obfs, api = NodeApi("https://api.example.net", "t0k"))

    private fun body(key: String?, port: Int = 443, pin: String = pinA) = """
        [{"id":"fra","city":"Frankfurt","serverPublicKey":"$oldKey"},
         {"id":"hk-2","city":"Hong Kong"${key?.let { ",\"serverPublicKey\":\"$it\"" } ?: ""},"obfuscation":{"version":1,"port":$port,"pin":"$pin"}}]
    """.trimIndent()

    private fun peerKey(text: String): Key = Config.parse(BufferedReader(StringReader(text))).peers.single().publicKey

    @Test
    fun newKeyReplacesThePeerKeyOnly() {
        val fresh = NodeKeyRefresh.apply(saved, NodeKeyRefresh.parse(body(newKey), "hk-2")!!)
        assertEquals(newKey, peerKey(fresh.config).toBase64())
        assertEquals(saved.config.replace(oldKey, newKey), fresh.config)
        assertEquals(obfs, fresh.obfuscation)
        assertEquals(saved.api, fresh.api)
    }

    @Test
    fun sameKeyAndPinKeepTheSavedTunnel() {
        assertSame(saved, NodeKeyRefresh.apply(saved, NodeKeyRefresh.parse(body(oldKey), "hk-2")!!))
        assertSame(saved, NodeKeyRefresh.apply(saved, NodeKeyRefresh.parse(body(null), "hk-2")!!))
    }

    @Test
    fun newObfuscationPinIsTakenTokenStays() {
        val fresh = NodeKeyRefresh.apply(saved, NodeKeyRefresh.parse(body(oldKey, port = 8443, pin = pinB), "hk-2")!!)
        assertEquals(ObfsEndpoint("203.0.113.7", 8443, pinB, "tok"), fresh.obfuscation)
        assertEquals(saved.config, fresh.config)
        assertSame(saved, NodeKeyRefresh.apply(saved, NodeKeyRefresh.parse(body(oldKey, pin = "nope"), "hk-2")!!))
    }

    @Test
    fun unknownNodeOrBrokenAnswerChangesNothing() {
        assertNull(NodeKeyRefresh.parse(body(newKey), "ams"))
        assertNull(NodeKeyRefresh.parse("<html>", "hk-2"))
        assertNull(NodeKeyRefresh.parse("""{"error":"unauthorized"}""", "hk-2"))
        assertEquals(null, NodeKeyRefresh.parse(body("not-a-key"), "hk-2")!!.serverPublicKey)
        assertEquals(config, NodeKeyRefresh.withPeerKey(config, "not-a-key"))
    }

    @Test
    fun apiDataRoundTripsAndIsValidated() {
        assertEquals(saved, SavedTunnel.fromJson(saved.toJson()))
        assertNull(SavedTunnel.fromJson(saved.copy(api = null).toJson()).api)
        assertEquals(NodeApi("http://10.0.2.2:3000", "abc"), NodeApi.of("http://10.0.2.2:3000/", "abc"))
        assertNull(NodeApi.of("file:///x", "abc"))
        assertNull(NodeApi.of("https://api.example.net", "a\r\nX-Evil: 1"))
        assertNull(NodeApi.of("https://api.example.net", ""))
        assertEquals("NodeApi(https://api.example.net)", saved.api.toString())
    }
}
