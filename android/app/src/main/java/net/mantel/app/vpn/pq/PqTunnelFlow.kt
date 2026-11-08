package net.mantel.app.vpn.pq

import com.wireguard.config.Config
import com.wireguard.crypto.Key
import com.wireguard.crypto.KeyPair
import java.util.Arrays

object PqErrors {
    const val UNSUPPORTED = "pq_unsupported"
    const val FAILED = "pq_failed"
    const val MISMATCH = "pq_mismatch"
    const val NOT_ACTIVE = "pq_not_active"
}

class PqFailure(val code: String, message: String, cause: Throwable? = null) : Exception(message, cause)

class PqCancelled : Exception("cancelled")

interface PqTunnelOps {
    fun apply(config: Config)

    fun latestHandshakeMillis(peer: Key): Long

    fun transport(identity: PqConfigs.Identity): PqTransport

    fun now(): Long = System.currentTimeMillis()

    fun sleep(ms: Long)

    fun checkCancelled()
}

class PqTunnelFlow(
    private val ops: PqTunnelOps,
    private val exchangeFactory: (PqTransport) -> PqExchange = { PqExchange(it) },
    private val blackholeKey: () -> Key = { KeyPair().publicKey },
    private val messages: (String) -> String = { it },
) {
    companion object {
        const val MAX_ATTEMPTS = 3
        val PAUSES_MS = longArrayOf(500, 1_000)
        const val EXCHANGE_BUDGET_MS = 20_000L
        const val HANDSHAKE_TIMEOUT_MS = 8_000L
        const val STATUS_TIMEOUT_MS = 4_000L
        const val POLL_MS = 250L

        const val STATUS_DELAY_MS = 300L
    }

    class Result(val sessionKey: Key, val attempts: Int)

    var attempts = 0
        private set

    fun run(base: Config): Result {
        val identity = try {
            PqConfigs.identity(base)
        } catch (e: IllegalArgumentException) {
            throw fail(PqErrors.FAILED, e)
        }
        ops.apply(PqConfigs.phase1(base, blackholeKey()))
        val exchange = exchangeFactory(ops.transport(identity))
        val success = negotiate(exchange, identity)
        val pskKey = try {
            Key.fromBytes(success.psk)
        } finally {
            Arrays.fill(success.psk, 0)
        }
        ops.checkCancelled()
        val switchedAt = ops.now()
        ops.apply(PqConfigs.phase2(base, success.sessionKeyPair, pskKey))
        awaitHandshake(identity.nodeKey, switchedAt)
        ops.sleep(STATUS_DELAY_MS)
        awaitActive(exchange, success.sessionKeyPair.publicKey.bytes)
        return Result(success.sessionKeyPair.publicKey, attempts)
    }

    private fun negotiate(exchange: PqExchange, identity: PqConfigs.Identity): PqExchange.Outcome.Success {
        val start = ops.now()
        val deadline = start + EXCHANGE_BUDGET_MS
        val nodeKey = identity.nodeKey.bytes
        val clientKey = identity.clientKey.bytes
        val ip = identity.tunnelIpv4.address
        var lastCode = PqErrors.FAILED
        for (attempt in 1..MAX_ATTEMPTS) {
            ops.checkCancelled()
            val remaining = deadline - ops.now()
            if (remaining <= 0) break
            attempts = attempt
            val outcome = exchange.attempt(
                nodeKey, clientKey, ip,
                connectTimeoutMs = minOf(PqExchange.CONNECT_TIMEOUT_MS.toLong(), remaining).toInt(),
                readTimeoutMs = minOf(PqExchange.RESPONSE_TIMEOUT_MS.toLong(), remaining).toInt(),
            )
            var pause = if (attempt <= PAUSES_MS.size) PAUSES_MS[attempt - 1] else 0L
            when (outcome) {
                is PqExchange.Outcome.Success -> return outcome
                is PqExchange.Outcome.NodeError -> when (outcome.code) {
                    PqProtocol.ERR_UNSUPPORTED_VERSION, PqProtocol.ERR_UNSUPPORTED_KEM, PqProtocol.ERR_NOT_AVAILABLE ->
                        throw fail(PqErrors.UNSUPPORTED)
                    PqProtocol.ERR_RATE_LIMITED, PqProtocol.ERR_BUSY -> {
                        val wait = outcome.retryAfterSeconds * 1_000L
                        if (ops.now() + wait >= deadline) throw fail(PqErrors.FAILED)
                        pause = maxOf(pause, wait)
                        lastCode = PqErrors.FAILED
                    }
                    else -> lastCode = PqErrors.FAILED
                }
                PqExchange.Outcome.Mismatch -> lastCode = PqErrors.MISMATCH
                is PqExchange.Outcome.Failed -> lastCode = PqErrors.FAILED
            }
            if (attempt == MAX_ATTEMPTS) break
            if (ops.now() + pause >= deadline) break
            ops.sleep(pause)
        }
        throw fail(lastCode)
    }

    private fun awaitHandshake(nodeKey: Key, switchedAt: Long) {
        val after = switchedAt - 1_000
        val deadline = ops.now() + HANDSHAKE_TIMEOUT_MS
        while (true) {
            ops.checkCancelled()
            val handshake = ops.latestHandshakeMillis(nodeKey)
            if (handshake > 0 && handshake >= after) return
            if (ops.now() >= deadline) throw fail(PqErrors.NOT_ACTIVE)
            ops.sleep(POLL_MS)
        }
    }

    private fun awaitActive(exchange: PqExchange, sessionKey: ByteArray) {
        val deadline = ops.now() + STATUS_TIMEOUT_MS
        while (true) {
            ops.checkCancelled()
            val remaining = deadline - ops.now()
            if (remaining <= 0) throw fail(PqErrors.NOT_ACTIVE)
            val budget = remaining.toInt()
            when (val outcome = exchange.status(sessionKey, budget, budget)) {
                is PqExchange.StatusOutcome.State -> when (outcome.state) {
                    PqProtocol.STATE_ACTIVE -> return
                    PqProtocol.STATE_PENDING -> Unit
                    else -> throw fail(PqErrors.NOT_ACTIVE)
                }
                is PqExchange.StatusOutcome.NodeError ->
                    if (outcome.code == PqProtocol.ERR_NOT_AVAILABLE) throw fail(PqErrors.NOT_ACTIVE)
                is PqExchange.StatusOutcome.Failed -> Unit
            }
            if (ops.now() + POLL_MS >= deadline) throw fail(PqErrors.NOT_ACTIVE)
            ops.sleep(POLL_MS)
        }
    }

    private fun fail(code: String, cause: Throwable? = null) = PqFailure(code, messages(code), cause)
}
