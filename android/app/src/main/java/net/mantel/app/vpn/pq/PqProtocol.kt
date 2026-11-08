package net.mantel.app.vpn.pq

import java.io.IOException
import java.io.InputStream

object PqProtocol {
    val MAGIC = byteArrayOf(0x4d, 0x54, 0x50, 0x51)
    const val VERSION = 1
    const val KEM_ML_KEM_768 = 0x0001

    const val TYPE_HELLO = 0x01
    const val TYPE_RESPONSE = 0x02
    const val TYPE_STATUS_REQUEST = 0x03
    const val TYPE_STATUS_RESPONSE = 0x04
    const val TYPE_ERROR = 0x7F

    const val HEADER_SIZE = 8
    const val KEY_SIZE = 32
    const val EK_SIZE = 1184
    const val CT_SIZE = 1088
    const val CONFIRM_SIZE = 32

    const val HELLO_PAYLOAD = 2 + KEY_SIZE + EK_SIZE
    const val RESPONSE_PAYLOAD = 2 + CT_SIZE + CONFIRM_SIZE
    const val STATUS_REQUEST_PAYLOAD = KEY_SIZE
    const val STATUS_RESPONSE_PAYLOAD = 1 + KEY_SIZE
    const val ERROR_PAYLOAD = 4

    const val MAX_RESPONSE_FRAME = HEADER_SIZE + RESPONSE_PAYLOAD

    const val PQ_ADDR = "10.8.255.1"
    const val PQ_PORT = 1337

    const val STATE_NONE = 0
    const val STATE_PENDING = 1
    const val STATE_ACTIVE = 2

    const val ERR_UNSUPPORTED_VERSION = 1
    const val ERR_UNSUPPORTED_KEM = 2
    const val ERR_MALFORMED = 3
    const val ERR_UNKNOWN_PEER = 4
    const val ERR_RATE_LIMITED = 5
    const val ERR_BUSY = 6
    const val ERR_INTERNAL = 7
    const val ERR_INVALID_SESSION_KEY = 8
    const val ERR_NOT_AVAILABLE = 9

    fun frame(type: Int, vararg parts: ByteArray): ByteArray {
        val length = parts.sumOf { it.size }
        require(length <= 0xFFFF) { "payload too large" }
        val out = ByteArray(HEADER_SIZE + length)
        MAGIC.copyInto(out, 0)
        out[4] = VERSION.toByte()
        out[5] = type.toByte()
        out[6] = (length shr 8).toByte()
        out[7] = length.toByte()
        var offset = HEADER_SIZE
        for (p in parts) {
            p.copyInto(out, offset)
            offset += p.size
        }
        return out
    }

    fun u16(value: Int): ByteArray = byteArrayOf((value shr 8).toByte(), value.toByte())

    fun encodeHello(sessionKey: ByteArray, ek: ByteArray): ByteArray {
        require(sessionKey.size == KEY_SIZE) { "session key must be 32 bytes" }
        require(ek.size == EK_SIZE) { "ek must be $EK_SIZE bytes" }
        return frame(TYPE_HELLO, u16(KEM_ML_KEM_768), sessionKey, ek)
    }

    fun encodeStatusRequest(sessionKey: ByteArray): ByteArray {
        require(sessionKey.size == KEY_SIZE) { "session key must be 32 bytes" }
        return frame(TYPE_STATUS_REQUEST, sessionKey)
    }

    sealed class Reply {
        class Response(val ciphertext: ByteArray, val confirm: ByteArray) : Reply()
        class Status(val state: Int, val sessionKey: ByteArray) : Reply()
        data class Error(val code: Int, val retryAfterSeconds: Int) : Reply()
    }

    class MalformedException(message: String) : IOException(message)

    fun decode(frame: ByteArray, expectedType: Int): Reply {
        if (frame.size < HEADER_SIZE) throw MalformedException("short frame")
        for (i in MAGIC.indices) if (frame[i] != MAGIC[i]) throw MalformedException("bad magic")
        if (frame[4].toInt() and 0xFF != VERSION) throw MalformedException("unsupported version")
        val type = frame[5].toInt() and 0xFF
        val length = ((frame[6].toInt() and 0xFF) shl 8) or (frame[7].toInt() and 0xFF)
        if (frame.size != HEADER_SIZE + length) throw MalformedException("length mismatch")
        val payload = frame.copyOfRange(HEADER_SIZE, frame.size)
        return when (type) {
            TYPE_ERROR -> {
                if (length != ERROR_PAYLOAD) throw MalformedException("bad error length")
                Reply.Error(readU16(payload, 0), readU16(payload, 2))
            }
            expectedType -> when (type) {
                TYPE_RESPONSE -> {
                    if (length != RESPONSE_PAYLOAD) throw MalformedException("bad response length")
                    if (readU16(payload, 0) != KEM_ML_KEM_768) throw MalformedException("unexpected kem")
                    Reply.Response(payload.copyOfRange(2, 2 + CT_SIZE), payload.copyOfRange(2 + CT_SIZE, RESPONSE_PAYLOAD))
                }
                TYPE_STATUS_RESPONSE -> {
                    if (length != STATUS_RESPONSE_PAYLOAD) throw MalformedException("bad status length")
                    Reply.Status(payload[0].toInt() and 0xFF, payload.copyOfRange(1, STATUS_RESPONSE_PAYLOAD))
                }
                else -> throw MalformedException("unexpected type")
            }
            else -> throw MalformedException("unexpected type")
        }
    }

    fun readFrame(input: InputStream, maxFrame: Int = MAX_RESPONSE_FRAME): ByteArray {
        val header = readExactly(input, HEADER_SIZE)
        val length = ((header[6].toInt() and 0xFF) shl 8) or (header[7].toInt() and 0xFF)
        if (HEADER_SIZE + length > maxFrame) throw MalformedException("frame too large")
        val payload = readExactly(input, length)
        return header + payload
    }

    private fun readExactly(input: InputStream, n: Int): ByteArray {
        val out = ByteArray(n)
        var read = 0
        while (read < n) {
            val r = input.read(out, read, n - read)
            if (r < 0) throw IOException("connection closed by node")
            read += r
        }
        return out
    }

    private fun readU16(b: ByteArray, offset: Int): Int =
        ((b[offset].toInt() and 0xFF) shl 8) or (b[offset + 1].toInt() and 0xFF)
}
