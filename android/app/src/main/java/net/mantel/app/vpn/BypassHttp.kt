package net.mantel.app.vpn

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

object BypassHttp {
    const val MAX_BODY_BYTES = 256 * 1024
    const val MIN_TIMEOUT_MS = 1_000
    const val MAX_TIMEOUT_MS = 20_000
    private val ALLOWED_HEADERS = setOf("accept", "accept-language", "authorization", "user-agent")

    data class Response(val status: Int, val body: String, val contentType: String?)

    fun parseUrl(raw: String?): URL? {
        if (raw.isNullOrBlank() || raw.length > 2048) return null
        val url = try {
            URL(raw)
        } catch (_: Exception) {
            return null
        }
        if (url.protocol != "https" && url.protocol != "http") return null
        if (url.host.isNullOrEmpty() || url.userInfo != null || url.ref != null) return null
        return url
    }

    fun sanitizeHeaders(headers: Map<String, Any?>): Map<String, String> =
        headers.entries
            .mapNotNull { (name, value) ->
                val key = name.trim().lowercase()
                val text = value as? String ?: return@mapNotNull null
                if (key !in ALLOWED_HEADERS || text.length > 4096 || text.any { it == '\r' || it == '\n' }) null else key to text
            }
            .toMap()

    fun clampTimeout(ms: Int?): Int = (ms ?: 10_000).coerceIn(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)

    fun readCapped(stream: InputStream?, max: Int = MAX_BODY_BYTES): String {
        if (stream == null) return ""
        stream.use { input ->
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                if (out.size() + read > max) throw IOException("response too large")
                out.write(buffer, 0, read)
            }
            return out.toString(Charsets.UTF_8.name())
        }
    }

    fun underlyingNetwork(context: Context): Network? {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return null
        @Suppress("DEPRECATION")
        val candidates = cm.allNetworks.mapNotNull { network ->
            val caps = cm.getNetworkCapabilities(network) ?: return@mapNotNull null
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return@mapNotNull null
            if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return@mapNotNull null
            if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)) return@mapNotNull null
            network to caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        }
        return (candidates.firstOrNull { it.second } ?: candidates.firstOrNull())?.first
    }

    fun get(context: Context, url: URL, headers: Map<String, String>, timeoutMs: Int): Response {
        val network = underlyingNetwork(context) ?: throw IOException("no network outside the tunnel")
        val connection = network.openConnection(url) as HttpURLConnection
        try {
            connection.requestMethod = "GET"
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            return Response(status, readCapped(stream), connection.contentType)
        } finally {
            connection.disconnect()
        }
    }
}
