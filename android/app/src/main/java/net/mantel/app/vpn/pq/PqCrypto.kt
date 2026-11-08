package net.mantel.app.vpn.pq

import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.generators.MLKEMKeyPairGenerator
import org.bouncycastle.crypto.kems.MLKEMExtractor
import org.bouncycastle.crypto.params.HKDFParameters
import org.bouncycastle.crypto.params.MLKEMKeyGenerationParameters
import org.bouncycastle.crypto.params.MLKEMParameters
import org.bouncycastle.crypto.params.MLKEMPrivateKeyParameters
import org.bouncycastle.crypto.params.MLKEMPublicKeyParameters
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Arrays

object PqCrypto {
    const val TRANSCRIPT_LABEL = "mantel-pq-v1/transcript"
    const val INFO_PSK = "mantel-pq-v1/wireguard-psk"
    const val INFO_CONFIRM = "mantel-pq-v1/confirm"

    class KemKeyPair(val ek: ByteArray, internal val dk: MLKEMPrivateKeyParameters) {
        fun destroy() {
            runCatching { dk.destroy() }
        }
    }

    fun generateKemKeyPair(random: SecureRandom = SecureRandom()): KemKeyPair {
        val generator = MLKEMKeyPairGenerator()
        generator.init(MLKEMKeyGenerationParameters(random, MLKEMParameters.ml_kem_768))
        val pair = generator.generateKeyPair()
        val pub = pair.public as MLKEMPublicKeyParameters
        return KemKeyPair(pub.encoded, pair.private as MLKEMPrivateKeyParameters)
    }

    fun kemKeyPairFromSeed(seed: ByteArray): KemKeyPair {
        val dk = MLKEMPrivateKeyParameters(MLKEMParameters.ml_kem_768, seed)
        return KemKeyPair(dk.publicKey, dk)
    }

    fun decapsulate(keyPair: KemKeyPair, ciphertext: ByteArray): ByteArray {
        require(ciphertext.size == PqProtocol.CT_SIZE) { "ciphertext must be ${PqProtocol.CT_SIZE} bytes" }
        return MLKEMExtractor(keyPair.dk).extractSecret(ciphertext)
    }

    fun transcript(
        nodeKey: ByteArray,
        clientKey: ByteArray,
        sessionKey: ByteArray,
        tunnelIpv4: ByteArray,
        ek: ByteArray,
        ct: ByteArray,
    ): ByteArray {
        require(nodeKey.size == 32 && clientKey.size == 32 && sessionKey.size == 32) { "keys must be 32 bytes" }
        require(tunnelIpv4.size == 4) { "tunnel address must be IPv4" }
        require(ek.size == PqProtocol.EK_SIZE && ct.size == PqProtocol.CT_SIZE) { "bad ek/ct size" }
        val h = MessageDigest.getInstance("SHA-256")
        h.update(TRANSCRIPT_LABEL.toByteArray(StandardCharsets.US_ASCII))
        h.update(byteArrayOf(0x00, PqProtocol.VERSION.toByte()))
        h.update(PqProtocol.u16(PqProtocol.KEM_ML_KEM_768))
        h.update(nodeKey)
        h.update(clientKey)
        h.update(sessionKey)
        h.update(tunnelIpv4)
        h.update(ek)
        h.update(ct)
        return h.digest()
    }

    fun hkdf(ikm: ByteArray, salt: ByteArray, info: String, length: Int = 32): ByteArray {
        val generator = HKDFBytesGenerator(SHA256Digest())
        generator.init(HKDFParameters(ikm, salt, info.toByteArray(StandardCharsets.US_ASCII)))
        val out = ByteArray(length)
        generator.generateBytes(out, 0, length)
        return out
    }

    class Derived(val psk: ByteArray, val confirm: ByteArray) {
        fun wipe() {
            Arrays.fill(psk, 0)
            Arrays.fill(confirm, 0)
        }
    }

    fun derive(sharedSecret: ByteArray, transcriptHash: ByteArray): Derived =
        Derived(hkdf(sharedSecret, transcriptHash, INFO_PSK), hkdf(sharedSecret, transcriptHash, INFO_CONFIRM))

    fun constantTimeEquals(a: ByteArray, b: ByteArray): Boolean {
        if (a.size != b.size) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].toInt() xor b[i].toInt())
        return diff == 0
    }

    fun ipv4Bytes(address: String): ByteArray {
        val parts = address.trim().split('.')
        require(parts.size == 4) { "not an IPv4 address" }
        return ByteArray(4) { i ->
            val p = parts[i]
            require(p.isNotEmpty() && p.length <= 3 && p.all { it in '0'..'9' }) { "not an IPv4 address" }
            val v = p.toInt()
            require(v in 0..255) { "not an IPv4 address" }
            v.toByte()
        }
    }
}
