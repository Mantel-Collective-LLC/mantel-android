package net.mantel.app.vpn.obfs

import android.content.Context
import com.wireguard.config.Config
import com.wireguard.config.InetEndpoint
import com.wireguard.config.Peer

object Obfuscation {
    const val AUTO = "auto"
    const val OFF = "off"
    const val ON = "on"
    val MODES = setOf(AUTO, OFF, ON)

    const val MIN_SDK = 29

    const val PROBE_MS = 6_000L
    const val KEEPALIVE_SECONDS = 25

    const val ERROR_UNAVAILABLE = "obfs_unavailable"
    const val ERROR_OLD_ANDROID = "obfs_old_android"
    const val ERROR_FAILED = "obfs_failed"

    private const val PREFS = "mantel_obfuscation"
    private const val KEY_MODE = "mode"

    fun mode(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_MODE, AUTO)?.takeIf { it in MODES } ?: AUTO

    fun setMode(context: Context, mode: String) {
        require(mode in MODES)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_MODE, mode).apply()
    }

    sealed interface Plan {
        data object Classic : Plan

        data class Direct(val endpoint: ObfsEndpoint) : Plan

        data class Probe(val endpoint: ObfsEndpoint) : Plan

        data class Unavailable(val code: String) : Plan
    }

    fun plan(mode: String, endpoint: ObfsEndpoint?, sdkInt: Int, rememberedNetwork: Boolean): Plan = when (mode) {
        OFF -> Plan.Classic
        ON -> when {
            endpoint == null -> Plan.Unavailable(ERROR_UNAVAILABLE)
            sdkInt < MIN_SDK -> Plan.Unavailable(ERROR_OLD_ANDROID)
            else -> Plan.Direct(endpoint)
        }
        else -> when {
            endpoint == null || sdkInt < MIN_SDK -> Plan.Classic
            rememberedNetwork -> Plan.Direct(endpoint)
            else -> Plan.Probe(endpoint)
        }
    }

    fun throughRelay(config: Config, port: Int): Config {
        val peers = config.peers.map { src ->
            Peer.Builder()
                .setPublicKey(src.publicKey)
                .addAllowedIps(src.allowedIps)
                .setEndpoint(InetEndpoint.parse("127.0.0.1:$port"))
                .setPersistentKeepalive(KEEPALIVE_SECONDS)
                .apply { src.preSharedKey.ifPresent { setPreSharedKey(it) } }
                .build()
        }
        return Config.Builder().setInterface(config.`interface`).addPeers(peers).build()
    }
}

class ObfsNetworks(private val max: Int = 16) {
    private val handles = LinkedHashSet<Long>()

    @Synchronized
    fun contains(handle: Long?): Boolean = handle != null && handle in handles

    @Synchronized
    fun remember(handle: Long?) {
        if (handle == null) return
        handles.remove(handle)
        handles.add(handle)
        while (handles.size > max) handles.remove(handles.first())
    }
}
