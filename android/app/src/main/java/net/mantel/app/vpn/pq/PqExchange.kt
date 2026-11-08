package net.mantel.app.vpn.pq

import com.wireguard.crypto.KeyPair
import java.io.IOException
import java.security.SecureRandom
import java.util.Arrays

fun interface PqTransport {
    @Throws(IOException::class)
    fun roundTrip(request: ByteArray, connectTimeoutMs: Int, readTimeoutMs: Int): ByteArray
}

class PqExchange(
    private val transport: PqTransport,
    private val sessionKeys: () -> KeyPair = { KeyPair() },
    private val kemKeys: () -> PqCrypto.KemKeyPair = { PqCrypto.generateKemKeyPair(SecureRandom()) },
) {
    companion object {
        const val CONNECT_TIMEOUT_MS = 4_000
        const val RESPONSE_TIMEOUT_MS = 6_000
    }

    sealed class Outcome {
        class Success(val sessionKeyPair: KeyPair, val psk: ByteArray) : Outcome()
        data class NodeError(val code: Int, val retryAfterSeconds: Int) : Outcome()
        object Mismatch : Outcome()
        class Failed(val cause: IOException) : Outcome()
    }

    fun attempt(
        nodeKey: ByteArray,
        clientKey: ByteArray,
        tunnelIpv4: ByteArray,
        connectTimeoutMs: Int = CONNECT_TIMEOUT_MS,
        readTimeoutMs: Int = RESPONSE_TIMEOUT_MS,
    ): Outcome {
        val session = sessionKeys()
        val sessionPublic = session.publicKey.bytes
        val kem = kemKeys()
        val reply = try {
            val frame = transport.roundTrip(PqProtocol.encodeHello(sessionPublic, kem.ek), connectTimeoutMs, readTimeoutMs)
            PqProtocol.decode(frame, PqProtocol.TYPE_RESPONSE)
        } catch (e: IOException) {
            kem.destroy()
            return Outcome.Failed(e)
        }
        return when (reply) {
            is PqProtocol.Reply.Error -> Outcome.NodeError(reply.code, reply.retryAfterSeconds).also { kem.destroy() }
            is PqProtocol.Reply.Response -> {
                val ss = try {
                    PqCrypto.decapsulate(kem, reply.ciphertext)
                } finally {
                    kem.destroy()
                }
                val th = PqCrypto.transcript(nodeKey, clientKey, sessionPublic, tunnelIpv4, kem.ek, reply.ciphertext)
                val derived = PqCrypto.derive(ss, th)
                Arrays.fill(ss, 0)
                if (!PqCrypto.constantTimeEquals(derived.confirm, reply.confirm)) {
                    derived.wipe()
                    Outcome.Mismatch
                } else {
                    val psk = derived.psk.copyOf()
                    derived.wipe()
                    Outcome.Success(session, psk)
                }
            }
            else -> Outcome.Failed(PqProtocol.MalformedException("unexpected reply")).also { kem.destroy() }
        }
    }

    sealed class StatusOutcome {
        data class State(val state: Int) : StatusOutcome()
        data class NodeError(val code: Int, val retryAfterSeconds: Int) : StatusOutcome()
        class Failed(val cause: IOException) : StatusOutcome()
    }

    fun status(sessionKey: ByteArray, connectTimeoutMs: Int, readTimeoutMs: Int): StatusOutcome {
        val reply = try {
            val frame = transport.roundTrip(PqProtocol.encodeStatusRequest(sessionKey), connectTimeoutMs, readTimeoutMs)
            PqProtocol.decode(frame, PqProtocol.TYPE_STATUS_RESPONSE)
        } catch (e: IOException) {
            return StatusOutcome.Failed(e)
        }
        return when (reply) {
            is PqProtocol.Reply.Error -> StatusOutcome.NodeError(reply.code, reply.retryAfterSeconds)
            is PqProtocol.Reply.Status ->
                if (!reply.sessionKey.contentEquals(sessionKey)) StatusOutcome.Failed(PqProtocol.MalformedException("status echo mismatch"))
                else StatusOutcome.State(reply.state)
            else -> StatusOutcome.Failed(PqProtocol.MalformedException("unexpected reply"))
        }
    }
}
