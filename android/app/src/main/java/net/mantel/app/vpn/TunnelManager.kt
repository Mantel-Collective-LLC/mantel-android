package net.mantel.app.vpn

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import com.wireguard.android.backend.BackendException
import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Tunnel
import com.wireguard.config.BadConfigException
import com.wireguard.config.Config
import com.wireguard.config.Interface
import com.wireguard.crypto.Key
import androidx.core.content.ContextCompat
import net.mantel.app.R
import net.mantel.app.vpn.obfs.ObfsClient
import net.mantel.app.vpn.obfs.ObfsEndpoint
import net.mantel.app.vpn.obfs.ObfsNetworks
import net.mantel.app.vpn.obfs.ObfsRelay
import net.mantel.app.vpn.obfs.Obfuscation
import net.mantel.app.vpn.pq.PqCancelled
import net.mantel.app.vpn.pq.PqConfigs
import net.mantel.app.vpn.pq.PqErrors
import net.mantel.app.vpn.pq.PqFailure
import net.mantel.app.vpn.pq.PqTransport
import net.mantel.app.vpn.pq.PqTunnelFlow
import net.mantel.app.vpn.pq.PqTunnelOps
import net.mantel.app.vpn.pq.VpnSocketTransport
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.IOException
import java.io.StringReader
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

data class TunnelStatus(
    val state: String = STATE_DOWN,
    val nodeId: String? = null,
    val label: String? = null,
    val startedAt: Long? = null,
    val lastHandshakeAt: Long? = null,
    val rxBytes: Long = 0,
    val txBytes: Long = 0,
    val endpoint: String? = null,
    val error: String? = null,
    val errorCode: String? = null,
    val quantum: String = QUANTUM_OFF,
    val obfuscated: Boolean = false,
) {
    companion object {
        const val STATE_DOWN = "down"
        const val STATE_CONNECTING = "connecting"
        const val STATE_UP = "up"
        const val QUANTUM_OFF = "off"
        const val QUANTUM_NEGOTIATING = "negotiating"
        const val QUANTUM_ACTIVE = "active"
        const val STALE_HANDSHAKE_MS = 180_000L
        const val HANDSHAKE_GRACE_MS = 30_000L
    }

    val isActive: Boolean get() = state != STATE_DOWN

    fun isStale(now: Long): Boolean {
        if (state != STATE_UP) return false
        val last = lastHandshakeAt ?: return startedAt != null && now - startedAt > HANDSHAKE_GRACE_MS
        return now - last > STALE_HANDSHAKE_MS
    }
}

data class SavedTunnel(
    val config: String,
    val nodeId: String,
    val label: String,
    val excludedApps: List<String>,
    val postQuantum: Boolean = false,
    val obfuscation: ObfsEndpoint? = null,
    val api: NodeApi? = null,
) {
    fun toJson(): String = JSONObject()
        .put("config", config)
        .put("nodeId", nodeId)
        .put("label", label)
        .put("excludedApps", JSONArray(excludedApps))
        .put("postQuantum", postQuantum)
        .apply { obfuscation?.let { put("obfuscation", it.toJson()) } }
        .apply { api?.let { put("api", it.toJson()) } }
        .toString()

    companion object {
        fun fromJson(json: String): SavedTunnel {
            val o = JSONObject(json)
            val apps = o.optJSONArray("excludedApps") ?: JSONArray()
            return SavedTunnel(
                config = o.getString("config"),
                nodeId = o.getString("nodeId"),
                label = o.optString("label", ""),
                excludedApps = List(apps.length()) { apps.getString(it) },
                postQuantum = o.optBoolean("postQuantum", false),
                obfuscation = ObfsEndpoint.fromJson(o.optJSONObject("obfuscation")),
                api = NodeApi.fromJson(o.optJSONObject("api")),
            )
        }
    }
}

class TunnelException(val code: String, message: String, cause: Throwable? = null) : Exception(message, cause)

class TunnelManager private constructor(context: Context) {
    companion object {
        private const val TAG = "MantelTunnel"
        private const val TUNNEL_NAME = "mantel"
        private const val SAVED_TUNNEL_KEY = "saved_tunnel"
        private const val POLL_MS = 2_000L
        private const val POLL_SCREEN_OFF_MS = 30_000L

        @Volatile private var instance: TunnelManager? = null

        fun get(context: Context): TunnelManager =
            instance ?: synchronized(this) {
                instance ?: TunnelManager(context.applicationContext).also { instance = it }
            }
    }

    private val appContext = context.applicationContext

    private fun text(id: Int, vararg args: Any): String = AppLanguage.localized(appContext).getString(id, *args)
    private val mainHandler = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "mantel-tunnel") }
    private val internalStore = SecureStore(appContext, SecureStore.PREFS_INTERNAL)
    private val backend: GoBackend by lazy { GoBackend(appContext) }
    private val tunnel = MantelTunnel()
    private val listeners = CopyOnWriteArrayList<(TunnelStatus) -> Unit>()

    private var pollTask: ScheduledFuture<*>? = null
    private val power = appContext.getSystemService(PowerManager::class.java)

    private var lastKeyCheck = 0L

    private var relay: ObfsRelay? = null

    private val obfsNetworks = ObfsNetworks()

    @Volatile private var stopping = false

    private val stopRequests = AtomicInteger(0)

    @Volatile
    var status: TunnelStatus = TunnelStatus()
        private set

    init {
        val screen = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
        }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                worker.execute {
                    if (pollTask == null) return@execute
                    stopPolling()
                    refreshStats()
                    startPolling()
                }
            }
        }
        ContextCompat.registerReceiver(appContext, receiver, screen, ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    private inner class MantelTunnel : Tunnel {
        override fun getName() = TUNNEL_NAME

        override fun onStateChange(newState: Tunnel.State) {
            if (newState == Tunnel.State.DOWN && !stopping) {
                worker.execute { reconcileUnexpectedDown() }
            }
        }
    }

    fun addListener(listener: (TunnelStatus) -> Unit) = listeners.add(listener)

    fun removeListener(listener: (TunnelStatus) -> Unit) = listeners.remove(listener)

    private fun publish(next: TunnelStatus) {
        val changedState = next.state != status.state
        status = next
        if (changedState) Log.i(TAG, "state → ${next.state}${next.error?.let { " ($it)" } ?: ""}")
        for (l in listeners) {
            try {
                l(next)
            } catch (e: Exception) {
                Log.w(TAG, "status listener failed", e)
            }
        }
        if (changedState) mainHandler.post { TunnelUi.onStateChanged(appContext, next) }
        else if (next.state == TunnelStatus.STATE_UP) mainHandler.post { TunnelUi.onStatsChanged(appContext, next) }
    }

    fun savedTunnel(): SavedTunnel? =
        internalStore.get(SAVED_TUNNEL_KEY)?.let {
            try {
                SavedTunnel.fromJson(it)
            } catch (e: Exception) {
                Log.w(TAG, "saved tunnel unreadable, dropping", e)
                internalStore.remove(SAVED_TUNNEL_KEY)
                null
            }
        }

    fun hasSavedTunnel(): Boolean = savedTunnel() != null

    fun start(saved: SavedTunnel, persist: Boolean = true): Future<TunnelStatus> {
        val stops = stopRequests.get()
        return worker.submit<TunnelStatus> { startBlocking(saved, persist, stops) }
    }

    fun startSaved(reason: String): Future<TunnelStatus?> {
        val stops = stopRequests.get()
        return worker.submit<TunnelStatus?> { startSavedBlocking(reason, stops) }
    }

    private fun startSavedBlocking(reason: String, stops: Int): TunnelStatus? {
        val stored = savedTunnel()
        if (stored == null) {
            Log.i(TAG, "$reason: no saved tunnel, nothing to start")
            return null
        }
        if (status.state == TunnelStatus.STATE_UP && status.nodeId == stored.nodeId &&
            backend.getState(tunnel) == Tunnel.State.UP
        ) {
            Log.i(TAG, "$reason: tunnel already up")
            return status
        }
        val saved = NodeKeyRefresh.refresh(appContext, stored)
        Log.i(TAG, "$reason: starting saved tunnel for node ${saved.nodeId}")
        return try {
            startBlocking(saved, persist = saved !== stored, stops = stops)
        } catch (e: TunnelException) {
            Log.w(TAG, "$reason: start failed: ${e.message}")
            status
        }
    }

    fun stop(): Future<TunnelStatus> {
        stopRequests.incrementAndGet()
        return worker.submit<TunnelStatus> { stopBlocking() }
    }

    fun clearSaved(): Future<TunnelStatus> {
        stopRequests.incrementAndGet()
        return worker.submit<TunnelStatus> {
            val result = stopBlocking()
            internalStore.remove(SAVED_TUNNEL_KEY)
            result
        }
    }

    fun onAlwaysOnTriggered() {
        startSaved("always-on")
    }

    fun alwaysOnState(): Pair<Boolean, Boolean>? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || status.state != TunnelStatus.STATE_UP) return null
        return try {
            Pair(backend.isAlwaysOn, backend.isLockdownEnabled)
        } catch (e: Exception) {
            null
        }
    }

    private fun startBlocking(saved: SavedTunnel, persist: Boolean, stops: Int): TunnelStatus {
        val config = try {
            buildConfig(saved.config, saved.excludedApps)
        } catch (e: TunnelException) {
            publish(status.copy(error = e.message))
            throw e
        }
        val save = { if (persist) internalStore.set(SAVED_TUNNEL_KEY, saved.toJson()) }

        if (VpnService.prepare(appContext) != null) {
            val e = TunnelException("vpn_permission", text(R.string.error_vpn_permission))
            save()
            publish(downStatus(error = e.message))
            throw e
        }

        val network = BypassHttp.underlyingNetwork(appContext)?.networkHandle
        val mode = Obfuscation.mode(appContext)
        val plan = Obfuscation.plan(mode, saved.obfuscation, Build.VERSION.SDK_INT, obfsNetworks.contains(network))
        if (plan is Obfuscation.Plan.Unavailable) failClosed(obfsError(plan.code), save)

        val endpoint = config.peers.firstOrNull()?.endpoint?.orElse(null)?.toString()
        val previous = status
        val wasUp = previous.state == TunnelStatus.STATE_UP
        val direct = plan as? Obfuscation.Plan.Direct
        publish(
            TunnelStatus(
                state = TunnelStatus.STATE_CONNECTING,
                nodeId = saved.nodeId,
                label = saved.label,
                endpoint = direct?.endpoint?.display ?: endpoint,
                quantum = if (saved.postQuantum) TunnelStatus.QUANTUM_NEGOTIATING else TunnelStatus.QUANTUM_OFF,
                obfuscated = direct != null,
            ),
        )
        var newRelay: ObfsRelay? = null
        var tunnelConfig = config
        var alreadyUp = false
        if (direct != null) {
            newRelay = try {
                openRelay(direct.endpoint)
            } catch (e: TunnelException) {
                if (mode == Obfuscation.ON) failClosed(e, save)
                publish(status.copy(endpoint = endpoint, obfuscated = false))
                null
            }
            if (newRelay != null) tunnelConfig = Obfuscation.throughRelay(config, newRelay.port)
        } else if (plan is Obfuscation.Plan.Probe) {
            applyClassic(if (saved.postQuantum) PqConfigs.phase1(config) else config, previous, wasUp, save, null)
            if (!awaitHandshake(Obfuscation.PROBE_MS, stops)) {
                Log.i(TAG, "no UDP handshake within ${Obfuscation.PROBE_MS} ms, switching to TLS")
                newRelay = try {
                    openRelay(plan.endpoint)
                } catch (e: TunnelException) {
                    Log.w(TAG, "TLS not reachable either, staying on UDP: ${e.code}")
                    null
                }
                if (newRelay != null) {
                    obfsNetworks.remember(network)
                    tunnelConfig = Obfuscation.throughRelay(config, newRelay.port)
                    publish(status.copy(endpoint = plan.endpoint.display, obfuscated = true))
                }
            }
            alreadyUp = newRelay == null && !saved.postQuantum
        }
        if (saved.postQuantum) return startPostQuantum(tunnelConfig, save, stops, newRelay)
        val rollback = if (plan is Obfuscation.Plan.Probe) status.copy(endpoint = endpoint, obfuscated = false) else previous
        if (!alreadyUp) applyClassic(tunnelConfig, rollback, wasUp, save, newRelay)
        adoptRelay(newRelay)
        save()
        publish(
            status.copy(
                state = TunnelStatus.STATE_UP,
                startedAt = System.currentTimeMillis(),
                error = null,
                obfuscated = newRelay != null,
            ),
        )
        refreshStats()
        startPolling()
        return status
    }

    private fun applyClassic(config: Config, previous: TunnelStatus, wasUp: Boolean, save: () -> Unit, newRelay: ObfsRelay?) {
        try {
            stopping = wasUp || previous.state != TunnelStatus.STATE_DOWN
            backend.setState(tunnel, Tunnel.State.UP, config)
        } catch (e: Exception) {
            val te = mapBackendException(e)
            Log.w(TAG, "start failed", e)
            newRelay?.close()
            val stillUp = runCatching { backend.getState(tunnel) == Tunnel.State.UP }.getOrDefault(false)
            if (!stillUp) {
                adoptRelay(null)
                save()
                stopPolling()
                publish(downStatus(error = te.message))
            } else {
                publish(previous.copy(state = TunnelStatus.STATE_UP, error = te.message))
                startPolling()
            }
            throw te
        } finally {
            stopping = false
        }
    }

    private fun failClosed(e: TunnelException, save: () -> Unit): Nothing {
        try {
            stopping = true
            runCatching { backend.setState(tunnel, Tunnel.State.DOWN, null) }
        } finally {
            stopping = false
        }
        adoptRelay(null)
        save()
        stopPolling()
        publish(downStatus(error = e.message, errorCode = e.code))
        throw e
    }

    private fun latestHandshake(): Long = runCatching {
        val stats = backend.getStatistics(tunnel)
        stats.peers().maxOfOrNull { stats.peer(it)?.latestHandshakeEpochMillis ?: 0L } ?: 0L
    }.getOrDefault(0L)

    private fun awaitHandshake(timeoutMs: Long, stops: Int): Boolean {
        val since = System.currentTimeMillis() - 1_000
        val deadline = since + 1_000 + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (stopRequests.get() != stops) return true
            if (latestHandshake() >= since) return true
            Thread.sleep(250)
        }
        return false
    }

    private fun openRelay(endpoint: ObfsEndpoint): ObfsRelay {
        val relay = ObfsRelay(endpoint, ::connectOutside)
        try {
            return relay.start()
        } catch (e: Exception) {
            Log.w(TAG, "TLS relay failed: ${e.javaClass.simpleName}")
            throw TunnelException(
                Obfuscation.ERROR_FAILED,
                text(if (ObfsClient.isPinMismatch(e)) R.string.error_obfs_pin else R.string.error_obfs_failed),
                e,
            )
        }
    }

    private fun connectOutside(socket: Socket, host: String, port: Int, timeoutMs: Int) {
        val network = BypassHttp.underlyingNetwork(appContext) ?: throw IOException("no network outside the tunnel")
        network.bindSocket(socket)
        socket.connect(InetSocketAddress(network.getByName(host), port), timeoutMs)
    }

    private fun adoptRelay(next: ObfsRelay?) {
        val old = relay
        relay = next
        if (old != null && old !== next) old.close()
    }

    private fun obfsError(code: String) = TunnelException(
        code,
        text(if (code == Obfuscation.ERROR_OLD_ANDROID) R.string.error_obfs_old_android else R.string.error_obfs_unavailable),
    )

    private fun startPostQuantum(config: Config, save: () -> Unit, stops: Int, newRelay: ObfsRelay?): TunnelStatus {
        try {
            stopping = true
            PqTunnelFlow(PqOps(stops), messages = ::pqMessage).run(config)
        } catch (e: Exception) {
            val te = when (e) {
                is PqFailure -> TunnelException(e.code, e.message ?: pqMessage(e.code), e)
                is PqCancelled -> null
                else -> mapBackendException(e)
            }
            if (te != null) Log.w(TAG, "post-quantum start failed: ${te.code}", e.takeIf { it !is PqFailure })
            runCatching { backend.setState(tunnel, Tunnel.State.DOWN, null) }
                .onFailure { Log.w(TAG, "tearing down after the failed PQ start failed", it) }
            newRelay?.close()
            adoptRelay(null)
            save()
            stopPolling()
            publish(downStatus(error = te?.message, errorCode = te?.code))
            throw te ?: TunnelException("cancelled", text(R.string.error_pq_cancelled))
        } finally {
            stopping = false
        }
        adoptRelay(newRelay)
        save()
        publish(
            status.copy(
                state = TunnelStatus.STATE_UP,
                startedAt = System.currentTimeMillis(),
                error = null,
                errorCode = null,
                quantum = TunnelStatus.QUANTUM_ACTIVE,
                obfuscated = newRelay != null,
            ),
        )
        refreshStats()
        startPolling()
        return status
    }

    private fun pqMessage(code: String): String = text(
        when (code) {
            PqErrors.UNSUPPORTED -> R.string.error_pq_unsupported
            PqErrors.MISMATCH -> R.string.error_pq_mismatch
            PqErrors.NOT_ACTIVE -> R.string.error_pq_not_active
            else -> R.string.error_pq_failed
        },
    )

    private inner class PqOps(private val stops: Int) : PqTunnelOps {
        override fun apply(config: Config) {
            backend.setState(tunnel, Tunnel.State.UP, config)
        }

        override fun latestHandshakeMillis(peer: Key): Long =
            runCatching { backend.getStatistics(tunnel).peer(peer)?.latestHandshakeEpochMillis() ?: 0L }.getOrDefault(0L)

        override fun transport(identity: PqConfigs.Identity): PqTransport =
            VpnSocketTransport(appContext, identity.tunnelIpv4) { checkCancelled() }

        override fun sleep(ms: Long) {
            val until = System.currentTimeMillis() + ms
            while (true) {
                checkCancelled()
                val left = until - System.currentTimeMillis()
                if (left <= 0) return
                Thread.sleep(minOf(left, 100L))
            }
        }

        override fun checkCancelled() {
            if (stopRequests.get() != stops) throw PqCancelled()
        }
    }

    private fun stopBlocking(): TunnelStatus {
        stopPolling()
        try {
            stopping = true
            backend.setState(tunnel, Tunnel.State.DOWN, null)
        } catch (e: Exception) {
            Log.w(TAG, "stop failed", e)
            val te = mapBackendException(e)
            publish(downStatus(error = te.message))
            throw te
        } finally {
            stopping = false
        }
        adoptRelay(null)
        publish(downStatus(error = null))
        return status
    }

    private fun reconcileUnexpectedDown() {
        if (status.state == TunnelStatus.STATE_DOWN) return
        if (backend.getState(tunnel) == Tunnel.State.UP) return
        adoptRelay(null)
        stopPolling()
        publish(downStatus(error = text(R.string.error_vpn_revoked)))
    }

    private fun downStatus(error: String?, errorCode: String? = null) =
        TunnelStatus(state = TunnelStatus.STATE_DOWN, error = error, errorCode = errorCode)

    private fun startPolling() {
        if (pollTask != null) return
        val ms = if (power?.isInteractive == false) POLL_SCREEN_OFF_MS else POLL_MS
        pollTask = worker.scheduleWithFixedDelay({ refreshStats() }, ms, ms, TimeUnit.MILLISECONDS)
    }

    private fun stopPolling() {
        pollTask?.cancel(false)
        pollTask = null
    }

    private fun refreshStats() {
        if (status.state != TunnelStatus.STATE_UP) return
        try {
            val stats = backend.getStatistics(tunnel)
            var handshake = 0L
            for (key in stats.peers()) {
                val peer = stats.peer(key) ?: continue
                if (peer.latestHandshakeEpochMillis > handshake) handshake = peer.latestHandshakeEpochMillis
            }
            publish(
                status.copy(
                    rxBytes = stats.totalRx(),
                    txBytes = stats.totalTx(),
                    lastHandshakeAt = handshake.takeIf { it > 0 },
                ),
            )
        } catch (e: Exception) {
            Log.w(TAG, "statistics failed", e)
        }
        checkNodeKey()
    }

    private fun checkNodeKey() {
        val now = System.currentTimeMillis()
        if (!status.isStale(now) || now - lastKeyCheck < NodeKeyRefresh.STALE_CHECK_MS) return
        lastKeyCheck = now
        try {
            val saved = savedTunnel()?.takeIf { it.nodeId == status.nodeId } ?: return
            val fresh = NodeKeyRefresh.refresh(appContext, saved)
            if (fresh === saved) return
            Log.i(TAG, "node ${saved.nodeId} has a new key, reconnecting")
            startBlocking(fresh, persist = true, stops = stopRequests.get())
        } catch (e: Exception) {
            Log.w(TAG, "reconnect with the new node key failed: ${e.javaClass.simpleName}")
        }
    }

    private fun buildConfig(text: String, excludedApps: List<String>): Config {
        val parsed = try {
            Config.parse(BufferedReader(StringReader(text)))
        } catch (e: BadConfigException) {
            val where = listOf(e.section.getName(), e.location.getName()).filter { it.isNotEmpty() }.joinToString(" › ")
            throw TunnelException("invalid_config", text(R.string.error_config_invalid_at, where, badConfigReason(e.reason)), e)
        } catch (e: Exception) {
            throw TunnelException("invalid_config", text(R.string.error_config_invalid), e)
        }
        if (parsed.peers.isEmpty()) {
            throw TunnelException("invalid_config", text(R.string.error_config_no_peer))
        }
        val pm = appContext.packageManager
        val own = appContext.packageName
        val apps = excludedApps.asSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() && it != own }
            .filter { isInstalled(pm, it) }
            .toCollection(LinkedHashSet())
        if (apps.isEmpty()) return parsed
        val src = parsed.`interface`
        return try {
            val iface = Interface.Builder()
                .addAddresses(src.addresses)
                .addDnsServers(src.dnsServers)
                .addDnsSearchDomains(src.dnsSearchDomains)
                .excludeApplications(src.excludedApplications.filter { it != own } + apps)
                .includeApplications(src.includedApplications)
                .setKeyPair(src.keyPair)
                .apply {
                    src.listenPort.ifPresent { setListenPort(it) }
                    src.mtu.ifPresent { setMtu(it) }
                }
                .build()
            Config.Builder().setInterface(iface).addPeers(parsed.peers).build()
        } catch (e: BadConfigException) {
            throw TunnelException("invalid_config", text(R.string.error_config_excluded_apps), e)
        }
    }

    private fun isInstalled(pm: PackageManager, pkg: String): Boolean = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.getApplicationInfo(pkg, PackageManager.ApplicationInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            pm.getApplicationInfo(pkg, 0)
        }
        true
    } catch (_: PackageManager.NameNotFoundException) {
        Log.i(TAG, "excluded app not installed (ignored): $pkg")
        false
    }

    private fun badConfigReason(reason: BadConfigException.Reason): String = text(
        when (reason) {
            BadConfigException.Reason.INVALID_KEY -> R.string.config_reason_invalid_key
            BadConfigException.Reason.INVALID_NUMBER -> R.string.config_reason_invalid_number
            BadConfigException.Reason.INVALID_VALUE -> R.string.config_reason_invalid_value
            BadConfigException.Reason.MISSING_ATTRIBUTE -> R.string.config_reason_missing_attribute
            BadConfigException.Reason.MISSING_SECTION -> R.string.config_reason_missing_section
            BadConfigException.Reason.SYNTAX_ERROR -> R.string.config_reason_syntax_error
            BadConfigException.Reason.UNKNOWN_ATTRIBUTE -> R.string.config_reason_unknown_attribute
            BadConfigException.Reason.UNKNOWN_SECTION -> R.string.config_reason_unknown_section
        },
    )

    private fun mapBackendException(e: Exception): TunnelException {
        if (e is TunnelException) return e
        if (e !is BackendException) {
            val reason = e.message?.takeIf { it.isNotBlank() }?.take(160) ?: e.javaClass.simpleName
            return TunnelException("backend", text(R.string.error_start_failed_reason, reason), e)
        }
        val arg = e.format.firstOrNull()
        val message = when (e.reason) {
            BackendException.Reason.VPN_NOT_AUTHORIZED ->
                return TunnelException("vpn_permission", text(R.string.error_vpn_permission), e)
            BackendException.Reason.UNABLE_TO_START_VPN -> text(R.string.error_vpn_service_start)
            BackendException.Reason.TUN_CREATION_ERROR -> text(R.string.error_tun_creation)
            BackendException.Reason.DNS_RESOLUTION_FAILURE -> text(R.string.error_dns_resolution, arg.toString())
            BackendException.Reason.GO_ACTIVATION_ERROR_CODE -> text(R.string.error_go_activation, arg.toString())
            BackendException.Reason.TUNNEL_MISSING_CONFIG -> text(R.string.error_missing_config)
            else -> text(R.string.error_wireguard, e.reason.toString())
        }
        return TunnelException("backend", message, e)
    }
}
