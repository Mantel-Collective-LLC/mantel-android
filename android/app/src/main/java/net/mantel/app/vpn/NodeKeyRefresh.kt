package net.mantel.app.vpn

import android.content.Context
import android.util.Log
import com.wireguard.crypto.Key
import net.mantel.app.vpn.obfs.ObfsEndpoint
import org.json.JSONArray
import org.json.JSONObject

data class NodeApi(val baseUrl: String, val token: String) {
    fun toJson(): JSONObject = JSONObject().put("baseUrl", baseUrl).put("token", token)

    override fun toString() = "NodeApi($baseUrl)"

    companion object {
        private val TOKEN = Regex("^[A-Za-z0-9._~+/=-]{1,512}$")

        fun of(baseUrl: String?, token: String?): NodeApi? {
            val url = baseUrl?.trimEnd('/') ?: return null
            if (BypassHttp.parseUrl("$url/api/v1/nodes") == null || token == null || !TOKEN.matches(token)) return null
            return NodeApi(url, token)
        }

        fun fromJson(o: JSONObject?): NodeApi? = o?.let { of(it.optString("baseUrl", ""), it.optString("token", "")) }
    }
}

object NodeKeyRefresh {
    private const val TAG = "MantelNodeKey"
    const val TIMEOUT_MS = 4_000

    const val STALE_CHECK_MS = 60_000L

    data class NodeKeys(val serverPublicKey: String?, val obfsPort: Int?, val obfsPin: String?)

    fun parse(body: String, nodeId: String): NodeKeys? {
        val nodes = try {
            JSONArray(body)
        } catch (_: Exception) {
            return null
        }
        for (i in 0 until nodes.length()) {
            val node = nodes.optJSONObject(i) ?: continue
            if (node.optString("id") != nodeId) continue
            val key = node.optString("serverPublicKey", "").takeIf(::isKey)
            val obfs = node.optJSONObject("obfuscation")
            return NodeKeys(key, obfs?.optInt("port", 0)?.takeIf { it in 1..65535 }, obfs?.optString("pin", null))
        }
        return null
    }

    fun apply(saved: SavedTunnel, node: NodeKeys): SavedTunnel {
        val config = node.serverPublicKey?.let { withPeerKey(saved.config, it) } ?: saved.config
        val current = saved.obfuscation
        val obfuscation = if (current != null && node.obfsPort != null && node.obfsPin != null) {
            ObfsEndpoint.of(current.host, node.obfsPort, node.obfsPin, current.token) ?: current
        } else {
            current
        }
        if (config == saved.config && obfuscation == current) return saved
        return saved.copy(config = config, obfuscation = obfuscation)
    }

    fun withPeerKey(config: String, key: String): String {
        if (!isKey(key)) return config
        var inPeer = false
        return config.lines().joinToString("\n") { line ->
            val trimmed = line.trim()
            if (trimmed.startsWith("[")) inPeer = trimmed.equals("[Peer]", ignoreCase = true)
            if (inPeer && trimmed.substringBefore('=').trim().equals("PublicKey", ignoreCase = true)) "PublicKey = $key" else line
        }
    }

    private fun isKey(value: String?): Boolean = value != null && runCatching { Key.fromBase64(value) }.isSuccess

    fun refresh(context: Context, saved: SavedTunnel): SavedTunnel {
        val api = saved.api ?: return saved
        return try {
            val url = BypassHttp.parseUrl("${api.baseUrl}/api/v1/nodes") ?: return saved
            val response = BypassHttp.get(
                context,
                url,
                mapOf("accept" to "application/json", "authorization" to "Bearer ${api.token}"),
                TIMEOUT_MS,
            )
            if (response.status != 200) {
                Log.i(TAG, "node list: HTTP ${response.status}")
                return saved
            }
            val node = parse(response.body, saved.nodeId) ?: return saved
            apply(saved, node).also { if (it !== saved) Log.i(TAG, "node ${saved.nodeId} has new keys") }
        } catch (e: Exception) {
            Log.i(TAG, "node list not reachable: ${e.javaClass.simpleName}")
            saved
        }
    }
}
