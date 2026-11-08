package net.mantel.app.vpn.pq

import com.wireguard.crypto.Key
import com.wireguard.crypto.KeyPair
import net.mantel.app.vpn.pq.PqVectors.hex
import net.mantel.app.vpn.pq.PqVectors.num
import net.mantel.app.vpn.pq.PqVectors.obj
import net.mantel.app.vpn.pq.PqVectors.str
import net.mantel.app.vpn.pq.PqVectors.toHex
import org.bouncycastle.crypto.kems.MLKEMGenerator
import org.bouncycastle.crypto.params.MLKEMParameters
import org.bouncycastle.crypto.params.MLKEMPublicKeyParameters
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.security.MessageDigest
import java.util.Base64

class PqVectorsTest {
    private fun b64(s: String) = Base64.getDecoder().decode(s)

    @Test
    fun constantsMatchTheImplementation() {
        val c = PqVectors.constants
        assertEquals(PqProtocol.CT_SIZE, c.num("ciphertextSize"))
        assertEquals(PqProtocol.EK_SIZE, c.num("encapsulationKeySize"))
        assertEquals(PqProtocol.HEADER_SIZE + PqProtocol.HELLO_PAYLOAD, c.num("helloFrameSize"))
        assertEquals(PqProtocol.MAX_RESPONSE_FRAME, c.num("responseFrameSize"))
        assertEquals(PqProtocol.KEM_ML_KEM_768, c.num("kemId"))
        assertEquals(PqProtocol.VERSION, c.num("protocolVersion"))
        assertEquals(toHex(PqProtocol.MAGIC), c.str("magic"))
        assertEquals(PqCrypto.TRANSCRIPT_LABEL, c.str("transcriptLabel"))
        assertEquals(PqCrypto.INFO_PSK, c.str("infoPsk"))
        assertEquals(PqCrypto.INFO_CONFIRM, c.str("infoConfirm"))
        assertEquals(32, c.num("sharedSecretSize"))
    }

    @Test
    fun allVectors() {
        assertTrue("expected vectors", PqVectors.vectors.size >= 3)
        for (v in PqVectors.vectors) checkVector(v)
    }

    private fun checkVector(v: Map<String, Any?>) {
        val name = v.str("name")
        val input = v.obj("inputs")
        val out = v.obj("outputs")
        val s = b64(input.obj("nodeKey").str("publicKey"))
        val k = b64(input.obj("clientKey").str("publicKey"))
        val e = b64(input.obj("sessionKey").str("publicKey"))
        val ip = PqCrypto.ipv4Bytes(input.str("tunnelIpv4"))

        for (role in listOf("nodeKey", "clientKey", "sessionKey")) {
            val pair = KeyPair(Key.fromBase64(input.obj(role).str("privateKey")))
            assertEquals("$name: $role", input.obj(role).str("publicKey"), pair.publicKey.toBase64())
        }

        val kem = PqCrypto.kemKeyPairFromSeed(input.hex("mlkemSeed"))
        assertArrayEquals("$name: ek from seed", out.hex("encapsulationKey"), kem.ek)
        assertEquals("$name: sha256(ek)", out.str("encapsulationKeySha256"), toHex(MessageDigest.getInstance("SHA-256").digest(kem.ek)))

        val enc = MLKEMGenerator.internalGenerateEncapsulated(
            MLKEMPublicKeyParameters(MLKEMParameters.ml_kem_768, kem.ek),
            input.hex("encapsRandomness"),
        )
        assertArrayEquals("$name: ciphertext", out.hex("ciphertext"), enc.encapsulation)
        assertArrayEquals("$name: shared secret (encaps)", out.hex("sharedSecret"), enc.secret)

        val ct = out.hex("ciphertext")
        val ss = PqCrypto.decapsulate(kem, ct)
        assertArrayEquals("$name: shared secret (decaps)", out.hex("sharedSecret"), ss)

        val th = PqCrypto.transcript(s, k, e, ip, kem.ek, ct)
        assertArrayEquals("$name: transcript", out.hex("transcriptHash"), th)
        val derived = PqCrypto.derive(ss, th)
        assertArrayEquals("$name: psk", out.hex("psk"), derived.psk)
        assertEquals("$name: psk base64", out.str("pskBase64"), Base64.getEncoder().encodeToString(derived.psk))
        assertEquals("$name: psk as WireGuard key", out.str("pskBase64"), Key.fromBytes(derived.psk).toBase64())
        assertArrayEquals("$name: confirm", out.hex("confirm"), derived.confirm)

        assertEquals("$name: hello", out.str("helloFrame"), toHex(PqProtocol.encodeHello(e, kem.ek)))
        assertEquals("$name: status request", out.str("statusRequestFrame"), toHex(PqProtocol.encodeStatusRequest(e)))
        val response = PqProtocol.decode(out.hex("responseFrame"), PqProtocol.TYPE_RESPONSE) as PqProtocol.Reply.Response
        assertArrayEquals("$name: response ct", ct, response.ciphertext)
        assertArrayEquals("$name: response confirm", out.hex("confirm"), response.confirm)
        assertEquals(
            "$name: response frame re-encoded",
            out.str("responseFrame"),
            toHex(PqProtocol.frame(PqProtocol.TYPE_RESPONSE, PqProtocol.u16(1), ct, derived.confirm)),
        )
        val status = PqProtocol.decode(out.hex("statusResponseFrame"), PqProtocol.TYPE_STATUS_RESPONSE) as PqProtocol.Reply.Status
        assertEquals("$name: status state", PqProtocol.STATE_ACTIVE, status.state)
        assertArrayEquals("$name: status echo", e, status.sessionKey)

        val t = out.obj("tamperedCiphertext")
        val badCt = t.hex("ciphertext")
        val badSs = PqCrypto.decapsulate(kem, badCt)
        assertArrayEquals("$name: tampered ss", t.hex("sharedSecret"), badSs)
        val badTh = PqCrypto.transcript(s, k, e, ip, kem.ek, badCt)
        assertArrayEquals("$name: tampered transcript", t.hex("transcriptHash"), badTh)
        val bad = PqCrypto.derive(badSs, badTh)
        assertArrayEquals("$name: tampered psk", t.hex("psk"), bad.psk)
        assertArrayEquals("$name: tampered confirm", t.hex("confirm"), bad.confirm)
        assertFalse("$name: tampered confirm must not match", PqCrypto.constantTimeEquals(bad.confirm, out.hex("confirm")))
        assertFalse(PqCrypto.constantTimeEquals(bad.confirm, response.confirm))
    }

    @Test
    fun errorFrames() {
        assertTrue(PqVectors.errorFrames.isNotEmpty())
        for (f in PqVectors.errorFrames) {
            val reply = PqProtocol.decode(f.hex("errorFrame"), PqProtocol.TYPE_RESPONSE)
            assertEquals(f.str("name"), PqProtocol.Reply.Error(f.num("code"), f.num("retryAfterS")), reply)
            assertEquals(PqProtocol.Reply.Error(f.num("code"), f.num("retryAfterS")), PqProtocol.decode(f.hex("errorFrame"), PqProtocol.TYPE_STATUS_RESPONSE))
            assertEquals(f.str("errorFrame"), toHex(PqProtocol.frame(PqProtocol.TYPE_ERROR, PqProtocol.u16(f.num("code")), PqProtocol.u16(f.num("retryAfterS")))))
        }
    }

    @Test
    fun strictDecoder() {
        val good = PqVectors.vector("basic").obj("outputs").hex("responseFrame")
        fun malformed(frame: ByteArray, type: Int = PqProtocol.TYPE_RESPONSE) {
            try {
                PqProtocol.decode(frame, type)
                fail("accepted malformed frame")
            } catch (_: PqProtocol.MalformedException) {
            }
        }
        malformed(good.copyOf(7))
        malformed(good.copyOf().also { it[0] = 0 })
        malformed(good.copyOf().also { it[4] = 2 })
        malformed(good.copyOf(good.size - 1))
        malformed(good + byteArrayOf(0))
        malformed(good.copyOf().also { it[9] = 2 })
        malformed(good, PqProtocol.TYPE_STATUS_RESPONSE)
        malformed(PqProtocol.frame(PqProtocol.TYPE_HELLO, ByteArray(PqProtocol.HELLO_PAYLOAD)))
        malformed(PqProtocol.frame(PqProtocol.TYPE_ERROR, ByteArray(3)))
        malformed(PqProtocol.frame(PqProtocol.TYPE_STATUS_RESPONSE, ByteArray(32)), PqProtocol.TYPE_STATUS_RESPONSE)
    }

    @Test
    fun readFrameReadsExactlyOneFrameAndLimitsSize() {
        val good = PqVectors.vector("basic").obj("outputs").hex("responseFrame")
        assertArrayEquals(good, PqProtocol.readFrame((good + byteArrayOf(1, 2, 3)).inputStream()))
        try {
            PqProtocol.readFrame(good.copyOf(100).inputStream())
            fail("EOF inside the frame must fail")
        } catch (_: java.io.IOException) {
        }
        val huge = PqProtocol.frame(PqProtocol.TYPE_RESPONSE, ByteArray(PqProtocol.RESPONSE_PAYLOAD + 1))
        try {
            PqProtocol.readFrame(huge.inputStream())
            fail("oversized frame must fail")
        } catch (_: PqProtocol.MalformedException) {
        }
    }

    @Test
    fun ipv4Parsing() {
        assertArrayEquals(byteArrayOf(10, 8, 15, 254.toByte()), PqCrypto.ipv4Bytes("10.8.15.254"))
        for (bad in listOf("10.8.0", "10.8.0.256", "10.8.0.-1", "a.b.c.d", "fd00::1", "10.8.0.2.1", "")) {
            try {
                PqCrypto.ipv4Bytes(bad)
                fail("accepted $bad")
            } catch (_: IllegalArgumentException) {
            }
        }
    }
}
