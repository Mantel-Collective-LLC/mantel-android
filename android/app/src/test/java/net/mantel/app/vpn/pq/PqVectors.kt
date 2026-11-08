package net.mantel.app.vpn.pq

import java.io.File

object PqVectors {
    val root: Map<String, Any?> by lazy {
        val path = System.getProperty("mantel.pqVectors") ?: "src/test/resources/pq-test-vectors.json"
        @Suppress("UNCHECKED_CAST")
        MiniJson(File(path).readText()).value() as Map<String, Any?>
    }

    @Suppress("UNCHECKED_CAST")
    val constants: Map<String, Any?> get() = root["constants"] as Map<String, Any?>

    @Suppress("UNCHECKED_CAST")
    val vectors: List<Map<String, Any?>> get() = root["vectors"] as List<Map<String, Any?>>

    @Suppress("UNCHECKED_CAST")
    val errorFrames: List<Map<String, Any?>> get() = root["errorFrames"] as List<Map<String, Any?>>

    fun vector(name: String) = vectors.first { it["name"] == name }

    @Suppress("UNCHECKED_CAST")
    fun Map<String, Any?>.obj(key: String): Map<String, Any?> = this[key] as Map<String, Any?>
    fun Map<String, Any?>.str(key: String): String = this[key] as String
    fun Map<String, Any?>.hex(key: String): ByteArray = unhex(this[key] as String)
    fun Map<String, Any?>.num(key: String): Int = (this[key] as Number).toInt()

    fun unhex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(2 * it, 2 * it + 2).toInt(16).toByte() }
    fun toHex(b: ByteArray): String = b.joinToString("") { "%02x".format(it) }
}

class MiniJson(private val s: String) {
    private var i = 0

    fun value(): Any? {
        skip()
        return when (val c = s[i]) {
            '{' -> {
                i++
                val m = LinkedHashMap<String, Any?>()
                skip()
                if (s[i] == '}') { i++; return m }
                while (true) {
                    skip()
                    val key = value() as String
                    skip(); expect(':')
                    m[key] = value()
                    skip()
                    if (s[i++] == '}') return m
                }
            }
            '[' -> {
                i++
                val l = ArrayList<Any?>()
                skip()
                if (s[i] == ']') { i++; return l }
                while (true) {
                    l.add(value())
                    skip()
                    if (s[i++] == ']') return l
                }
            }
            '"' -> {
                i++
                val b = StringBuilder()
                while (s[i] != '"') {
                    val ch = s[i++]
                    if (ch == '\\') {
                        val n = s[i++]
                        b.append(if (n == 'n') '\n' else n)
                    } else b.append(ch)
                }
                i++
                b.toString()
            }
            else -> when {
                s.startsWith("true", i) -> { i += 4; true }
                s.startsWith("false", i) -> { i += 5; false }
                s.startsWith("null", i) -> { i += 4; null }
                else -> {
                    val start = i
                    while (i < s.length && "-+.eE0123456789".indexOf(s[i]) >= 0) i++
                    require(i > start) { "unexpected '$c' at $start" }
                    s.substring(start, i).toDouble()
                }
            }
        }
    }

    private fun expect(c: Char) {
        require(s[i] == c) { "expected '$c' at $i" }
        i++
    }

    private fun skip() {
        while (s[i].isWhitespace()) i++
    }
}
