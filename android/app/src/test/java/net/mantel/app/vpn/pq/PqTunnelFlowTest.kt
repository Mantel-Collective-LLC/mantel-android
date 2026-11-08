package net.mantel.app.vpn.pq

import com.wireguard.config.Config
import com.wireguard.config.InetNetwork
import com.wireguard.crypto.Key
import net.mantel.app.vpn.SavedTunnel
import org.bouncycastle.crypto.kems.MLKEMGenerator
import org.bouncycastle.crypto.params.MLKEMParameters
import org.bouncycastle.crypto.params.MLKEMPublicKeyParameters
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.BufferedReader
import java.io.IOException
import java.io.StringReader
import java.net.Inet4Address
import java.net.InetAddress
import java.security.SecureRandom

class PqTunnelFlowTest {

    companion object {
        const val CLIENT_PRIVATE = "pSR7d2h8H6wS0RjX9z/ftpIAVDAsuu/flQQStRtweZ0="
        const val CLIENT_PUBLIC = "pLLGZN3M20E9HOfCw9BTwB1UWPNJLHZEkJS0Bi4uKxw="
        const val NODE_PUBLIC = "h2lcXP+HuIipSc5D9u5MMVC139EotqrfTZ6u/c++XwA="
        const val MIGRATION_PSK = "YY2M2RrUzzVU66QarTVCV21NmqHvvRUE3wEqlHN+FEU="

        fun baseConfig(
            allowedIps: String = "0.0.0.0/0, ::/0",
            address: String = "10.8.0.2/32, fd00:8::2/128",
            psk: Boolean = false,
        ): Config = Config.parse(
            BufferedReader(
                StringReader(
                    """
                    [Interface]
                    PrivateKey = $CLIENT_PRIVATE
                    Address = $address
                    DNS = 10.8.0.1
                    ExcludedApplications = com.example.bank

                    [Peer]
                    PublicKey = $NODE_PUBLIC
                    ${if (psk) "PresharedKey = $MIGRATION_PSK" else ""}
                    Endpoint = 203.0.113.10:51820
                    AllowedIPs = $allowedIps
                    PersistentKeepalive = 25
                    """.trimIndent(),
                ),
            ),
        )
    }

    private inner class FakeNode : PqTransport {
        val hellos = mutableListOf<ByteArray>()
        val statusRequests = mutableListOf<ByteArray>()
        val helloScript = ArrayDeque<(ByteArray) -> ByteArray>()
        val statusScript = ArrayDeque<(ByteArray) -> ByteArray>()
        var lastPsk: ByteArray? = null
        var lastSessionKey: ByteArray? = null
        var corruptConfirm = false
        var helloCost = 10L

        override fun roundTrip(request: ByteArray, connectTimeoutMs: Int, readTimeoutMs: Int): ByteArray {
            assertTrue("connect timeout capped", connectTimeoutMs in 1..PqExchange.CONNECT_TIMEOUT_MS)
            return when (request[5].toInt()) {
                PqProtocol.TYPE_HELLO -> {
                    ops.clock += helloCost
                    hellos += request
                    helloScript.removeFirstOrNull()?.invoke(request) ?: answerHello(request)
                }
                PqProtocol.TYPE_STATUS_REQUEST -> {
                    statusRequests += request
                    statusScript.removeFirstOrNull()?.invoke(request) ?: status(request, PqProtocol.STATE_ACTIVE)
                }
                else -> throw AssertionError("unexpected request type")
            }
        }

        fun answerHello(hello: ByteArray): ByteArray {
            assertEquals(1226, hello.size)
            assertEquals(PqProtocol.KEM_ML_KEM_768, ((hello[8].toInt() and 0xFF) shl 8) or (hello[9].toInt() and 0xFF))
            val e = hello.copyOfRange(10, 42)
            val ek = hello.copyOfRange(42, 42 + PqProtocol.EK_SIZE)
            val enc = MLKEMGenerator(SecureRandom()).generateEncapsulated(MLKEMPublicKeyParameters(MLKEMParameters.ml_kem_768, ek))
            val ct = enc.encapsulation
            val th = PqCrypto.transcript(
                Key.fromBase64(NODE_PUBLIC).bytes, Key.fromBase64(CLIENT_PUBLIC).bytes, e,
                PqCrypto.ipv4Bytes("10.8.0.2"), ek, ct,
            )
            val derived = PqCrypto.derive(enc.secret, th)
            lastPsk = derived.psk
            lastSessionKey = e
            val confirm = derived.confirm.copyOf().also { if (corruptConfirm) it[0] = (it[0].toInt() xor 1).toByte() }
            return PqProtocol.frame(PqProtocol.TYPE_RESPONSE, PqProtocol.u16(1), ct, confirm)
        }

        fun status(request: ByteArray, state: Int, echo: ByteArray = request.copyOfRange(8, 40)): ByteArray =
            PqProtocol.frame(PqProtocol.TYPE_STATUS_RESPONSE, byteArrayOf(state.toByte()), echo)
    }

    private fun error(code: Int, retryAfter: Int = 0) =
        PqProtocol.frame(PqProtocol.TYPE_ERROR, PqProtocol.u16(code), PqProtocol.u16(retryAfter))

    private inner class FakeOps : PqTunnelOps {
        var clock = 1_000_000L
        val applied = mutableListOf<Config>()
        val sleeps = mutableListOf<Long>()
        var handshakeDelayMs: Long? = 300
        var switchedAt = 0L
        var cancelAfterSleeps = Int.MAX_VALUE

        override fun apply(config: Config) {
            applied += config
            if (applied.size == 2) switchedAt = clock
        }

        override fun latestHandshakeMillis(peer: Key): Long {
            assertEquals(NODE_PUBLIC, peer.toBase64())
            val delay = handshakeDelayMs ?: return 0
            if (applied.size < 2) return 0
            return if (clock >= switchedAt + delay) switchedAt + delay else 0
        }

        override fun transport(identity: PqConfigs.Identity): PqTransport {
            assertEquals(InetAddress.getByName("10.8.0.2"), identity.tunnelIpv4)
            return node
        }

        override fun now() = clock

        override fun sleep(ms: Long) {
            sleeps += ms
            clock += ms
            if (sleeps.size >= cancelAfterSleeps) throw PqCancelled()
        }

        override fun checkCancelled() {
            if (sleeps.size >= cancelAfterSleeps) throw PqCancelled()
        }
    }

    private val node = FakeNode()
    private val ops = FakeOps()
    private val blackhole = Key.fromBase64("ejqd4twcfZWlQG8T4dACy/csyXxL4l27C/NQT2+BYhw=")
    private fun flow() = PqTunnelFlow(ops, blackholeKey = { blackhole })

    private fun failure(block: () -> Unit): PqFailure {
        try {
            block()
        } catch (e: PqFailure) {
            return e
        }
        fail("expected PqFailure")
        throw IllegalStateException()
    }

    private val pq = InetNetwork.parse("10.8.255.1/32")

    @Test
    fun successBuildsPhase1ThenPhase2WithTheNegotiatedPsk() {
        val result = flow().run(baseConfig(psk = true))
        assertEquals(1, result.attempts)
        assertEquals(2, ops.applied.size)
        assertEquals(1, node.hellos.size)
        assertEquals(PqTunnelFlow.STATUS_DELAY_MS, ops.sleeps.last())

        val phase1 = ops.applied[0]
        assertEquals(CLIENT_PUBLIC, phase1.`interface`.keyPair.publicKey.toBase64())
        assertEquals(setOf("com.example.bank"), phase1.`interface`.excludedApplications)
        assertEquals(2, phase1.peers.size)
        val s1 = phase1.peers.first { it.publicKey.toBase64() == NODE_PUBLIC }
        assertEquals(setOf(pq), s1.allowedIps)
        assertEquals("203.0.113.10:51820", s1.endpoint.get().toString())
        assertEquals(25, s1.persistentKeepalive.get())
        assertEquals(MIGRATION_PSK, s1.preSharedKey.get().toBase64())
        val d = phase1.peers.first { it.publicKey == blackhole }
        assertFalse("blackhole has no endpoint", d.endpoint.isPresent)
        assertFalse(d.preSharedKey.isPresent)
        assertEquals(setOf(InetNetwork.parse("0.0.0.0/0"), InetNetwork.parse("::/0")), d.allowedIps)

        val phase2 = ops.applied[1]
        val e = phase2.`interface`.keyPair.publicKey
        assertArrayEquals("interface key = E from HELLO", node.lastSessionKey, e.bytes)
        assertNotEquals(CLIENT_PUBLIC, e.toBase64())
        assertEquals(phase1.`interface`.addresses, phase2.`interface`.addresses)
        assertEquals(phase1.`interface`.dnsServers, phase2.`interface`.dnsServers)
        assertEquals(setOf("com.example.bank"), phase2.`interface`.excludedApplications)
        assertEquals(1, phase2.peers.size)
        val s2 = phase2.peers[0]
        assertEquals(NODE_PUBLIC, s2.publicKey.toBase64())
        assertArrayEquals("PSK = node's PSK", node.lastPsk, s2.preSharedKey.get().bytes)
        assertEquals(setOf(InetNetwork.parse("0.0.0.0/0"), InetNetwork.parse("::/0"), pq), s2.allowedIps)
        assertEquals("203.0.113.10:51820", s2.endpoint.get().toString())
        assertEquals(25, s2.persistentKeepalive.get())

        assertEquals(1, node.statusRequests.size)
        assertArrayEquals(e.bytes, node.statusRequests[0].copyOfRange(8, 40))
        assertEquals(e, result.sessionKey)
    }

    @Test
    fun splitRoutingKeepsItsAllowedIpsAndAddsThePqEndpointInPhase2() {
        flow().run(baseConfig(allowedIps = "10.8.0.1/32, 192.168.0.0/16"))
        val d = ops.applied[0].peers.first { it.publicKey == blackhole }
        assertEquals(setOf(InetNetwork.parse("10.8.0.1/32"), InetNetwork.parse("192.168.0.0/16")), d.allowedIps)
        assertEquals(
            setOf(InetNetwork.parse("10.8.0.1/32"), InetNetwork.parse("192.168.0.0/16"), pq),
            ops.applied[1].peers[0].allowedIps,
        )
    }

    @Test
    fun pendingStatusIsAskedAgainUntilActive() {
        node.statusScript += { node.status(it, PqProtocol.STATE_PENDING) }
        node.statusScript += { throw IOException("SYN dropped before activation") }
        flow().run(baseConfig())
        assertEquals(3, node.statusRequests.size)
    }

    @Test
    fun retriesWithPausesAndNewKeysThenSucceeds() {
        node.helloScript += { throw IOException("connection refused") }
        node.helloScript += { error(PqProtocol.ERR_INVALID_SESSION_KEY) }
        assertEquals(3, flow().run(baseConfig()).attempts)
        assertEquals(3, node.hellos.size)
        assertEquals(listOf(500L, 1_000L), ops.sleeps.take(2))
        val sessionKeys = node.hellos.map { it.copyOfRange(10, 42).toList() }.toSet()
        val eks = node.hellos.map { it.copyOfRange(42, 42 + 1184).toList() }.toSet()
        assertEquals("new E per attempt", 3, sessionKeys.size)
        assertEquals("new ML-KEM key per attempt", 3, eks.size)
        assertEquals(2, ops.applied.size)
    }

    @Test
    fun threeFailuresFailClosedWithoutPhase2() {
        repeat(3) { node.helloScript += { throw IOException("timeout") } }
        val e = failure { flow().run(baseConfig()) }
        assertEquals(PqErrors.FAILED, e.code)
        assertEquals(3, node.hellos.size)
        assertEquals("only phase 1 was ever applied (no user traffic outside PQ)", 1, ops.applied.size)
    }

    @Test
    fun retryableNodeErrorsAreRetriedThenFail() {
        for (code in listOf(PqProtocol.ERR_MALFORMED, PqProtocol.ERR_UNKNOWN_PEER, PqProtocol.ERR_INTERNAL, 42)) {
            val n = FakeNode()
            repeat(3) { n.helloScript += { error(code) } }
            val o = FakeOps()
            val e = failure { PqTunnelFlow(object : PqTunnelOps by o { override fun transport(identity: PqConfigs.Identity) = n }).run(baseConfig()) }
            assertEquals("code $code", PqErrors.FAILED, e.code)
            assertEquals("code $code", 3, n.hellos.size)
            assertEquals(1, o.applied.size)
        }
    }

    @Test
    fun unsupportedCodesAbortImmediately() {
        for (code in listOf(PqProtocol.ERR_UNSUPPORTED_VERSION, PqProtocol.ERR_UNSUPPORTED_KEM, PqProtocol.ERR_NOT_AVAILABLE)) {
            val n = FakeNode()
            n.helloScript += { error(code) }
            val o = FakeOps()
            val e = failure { PqTunnelFlow(object : PqTunnelOps by o { override fun transport(identity: PqConfigs.Identity) = n }).run(baseConfig()) }
            assertEquals("code $code", PqErrors.UNSUPPORTED, e.code)
            assertEquals("no retry for code $code", 1, n.hellos.size)
            assertEquals(1, o.applied.size)
        }
    }

    @Test
    fun rateLimitWaitsRetryAfterWithinTheBudget() {
        node.helloScript += { error(PqProtocol.ERR_RATE_LIMITED, 2) }
        flow().run(baseConfig())
        assertEquals(2_000L, ops.sleeps[0])
        assertEquals(2, node.hellos.size)
    }

    @Test
    fun rateLimitBeyondTheBudgetFailsAtOnce() {
        node.helloScript += { error(PqProtocol.ERR_BUSY, 30) }
        val e = failure { flow().run(baseConfig()) }
        assertEquals(PqErrors.FAILED, e.code)
        assertEquals(1, node.hellos.size)
        assertTrue(ops.sleeps.isEmpty())
    }

    @Test
    fun totalBudgetOf20SecondsLimitsAttempts() {
        node.helloCost = 10_000
        repeat(3) { node.helloScript += { throw IOException("timeout") } }
        val e = failure { flow().run(baseConfig()) }
        assertEquals(PqErrors.FAILED, e.code)
        assertEquals(2, node.hellos.size)
    }

    @Test
    fun confirmMismatchIsReportedAndNeverApplied() {
        node.corruptConfirm = true
        val e = failure { flow().run(baseConfig()) }
        assertEquals(PqErrors.MISMATCH, e.code)
        assertEquals(3, node.hellos.size)
        assertEquals(1, ops.applied.size)
    }

    @Test
    fun tamperedCiphertextFromTheVectorsIsAMismatch() {
        val v = PqVectors.vector("basic")
        @Suppress("UNCHECKED_CAST") val input = v["inputs"] as Map<String, Any?>
        @Suppress("UNCHECKED_CAST") val out = v["outputs"] as Map<String, Any?>
        @Suppress("UNCHECKED_CAST") val tampered = out["tamperedCiphertext"] as Map<String, Any?>
        @Suppress("UNCHECKED_CAST") val session = input["sessionKey"] as Map<String, Any?>
        val seed = PqVectors.unhex(input["mlkemSeed"] as String)
        val sessionPair = { com.wireguard.crypto.KeyPair(Key.fromBase64(session["privateKey"] as String)) }
        val honest = PqVectors.unhex(out["responseFrame"] as String)
        val nodeKey = Key.fromBase64(NODE_PUBLIC).bytes
        val clientKey = Key.fromBase64(CLIENT_PUBLIC).bytes
        val ip = PqCrypto.ipv4Bytes("10.8.0.2")

        val ok = PqExchange({ req, _, _ ->
            assertEquals(out["helloFrame"], PqVectors.toHex(req))
            honest
        }, sessionPair, { PqCrypto.kemKeyPairFromSeed(seed) }).attempt(nodeKey, clientKey, ip)
        assertTrue(ok is PqExchange.Outcome.Success)
        assertEquals(out["psk"], PqVectors.toHex((ok as PqExchange.Outcome.Success).psk))

        val forged = PqProtocol.frame(
            PqProtocol.TYPE_RESPONSE, PqProtocol.u16(1),
            PqVectors.unhex(tampered["ciphertext"] as String), PqVectors.unhex(out["confirm"] as String),
        )
        val bad = PqExchange({ _, _, _ -> forged }, sessionPair, { PqCrypto.kemKeyPairFromSeed(seed) }).attempt(nodeKey, clientKey, ip)
        assertEquals(PqExchange.Outcome.Mismatch, bad)
    }

    @Test
    fun noHandshakeAfterTheSwitchIsNotActive() {
        ops.handshakeDelayMs = null
        val e = failure { flow().run(baseConfig()) }
        assertEquals(PqErrors.NOT_ACTIVE, e.code)
        assertTrue(node.statusRequests.isEmpty())
        assertTrue("waited ~8 s", ops.sleeps.sum() in 7_500L..8_500L)
    }

    @Test
    fun unknownSessionInStatusIsNotActive() {
        node.statusScript += { node.status(it, PqProtocol.STATE_NONE) }
        assertEquals(PqErrors.NOT_ACTIVE, failure { flow().run(baseConfig()) }.code)
    }

    @Test
    fun statusThatStaysPendingTimesOut() {
        repeat(100) { node.statusScript += { req -> node.status(req, PqProtocol.STATE_PENDING) } }
        assertEquals(PqErrors.NOT_ACTIVE, failure { flow().run(baseConfig()) }.code)
        assertTrue(node.statusRequests.size in 10..17)
    }

    @Test
    fun statusWithAnotherSessionKeyIsNotAccepted() {
        repeat(100) { node.statusScript += { req -> node.status(req, PqProtocol.STATE_ACTIVE, ByteArray(32) { 7 }) } }
        assertEquals(PqErrors.NOT_ACTIVE, failure { flow().run(baseConfig()) }.code)
    }

    @Test
    fun stopDuringNegotiationCancels() {
        repeat(3) { node.helloScript += { throw IOException("timeout") } }
        ops.cancelAfterSleeps = 1
        try {
            flow().run(baseConfig())
            fail("expected cancel")
        } catch (_: PqCancelled) {
        }
        assertEquals(1, ops.applied.size)
    }

    @Test
    fun configWithoutIpv4OrWithSeveralPeersIsRejectedBeforeAnyTunnel() {
        assertEquals(PqErrors.FAILED, failure { flow().run(baseConfig(address = "fd00:8::2/128")) }.code)
        assertTrue(ops.applied.isEmpty())
    }

    @Test
    fun identityComesFromTheBaseConfig() {
        val id = PqConfigs.identity(baseConfig())
        assertEquals(NODE_PUBLIC, id.nodeKey.toBase64())
        assertEquals(CLIENT_PUBLIC, id.clientKey.toBase64())
        assertEquals(InetAddress.getByName("10.8.0.2") as Inet4Address, id.tunnelIpv4)
    }

    @Test
    fun postQuantumSettingIsPersistedAndOffByDefault() {
        val on = SavedTunnel("cfg", "node-1", "Berlin", listOf("a.b"), postQuantum = true)
        assertEquals(on, SavedTunnel.fromJson(on.toJson()))
        val off = SavedTunnel("cfg", "node-1", "Berlin", emptyList())
        assertFalse(off.postQuantum)
        assertFalse(SavedTunnel.fromJson(off.toJson()).postQuantum)
        assertFalse(SavedTunnel.fromJson("""{"config":"cfg","nodeId":"n","label":"","excludedApps":[]}""").postQuantum)
    }
}
