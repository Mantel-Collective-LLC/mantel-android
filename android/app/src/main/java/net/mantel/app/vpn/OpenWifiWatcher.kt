package net.mantel.app.vpn

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.VpnService
import android.net.wifi.WifiInfo
import android.os.Build
import android.util.Log

object OpenWifiWatcher {
    const val OPEN = "open"
    const val SECURED = "secured"
    const val NONE = "none"
    const val UNKNOWN = "unknown"

    private const val TAG = "MantelOpenWifi"
    private const val PREFS = "mantel_open_wifi"
    private const val KEY_AUTO_CONNECT = "auto_connect"
    private const val SECURITY_TYPE_UNKNOWN = -1
    private const val SECURITY_TYPE_OPEN = 0

    @Volatile
    var current: String = NONE
        private set

    @Volatile
    private var decided: Network? = null
    private var registered = false

    fun classify(securityType: Int?): String = when (securityType) {
        null, SECURITY_TYPE_UNKNOWN -> UNKNOWN
        SECURITY_TYPE_OPEN -> OPEN
        else -> SECURED
    }

    fun shouldAutoConnect(security: String, enabled: Boolean, newNetwork: Boolean, tunnelActive: Boolean, canStart: Boolean): Boolean =
        enabled && security == OPEN && newNetwork && !tunnelActive && canStart

    fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_AUTO_CONNECT, false)

    fun setEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_AUTO_CONNECT, enabled).apply()
    }

    @Synchronized
    fun register(context: Context) {
        if (registered) return
        val app = context.applicationContext
        val connectivity = app.getSystemService(ConnectivityManager::class.java) ?: return
        val request = NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build()
        try {
            connectivity.registerNetworkCallback(
                request,
                object : ConnectivityManager.NetworkCallback() {
                    override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) =
                        onWifi(app, network, capabilities)

                    override fun onLost(network: Network) {
                        if (decided == network) decided = null
                        current = NONE
                    }
                },
            )
            registered = true
        } catch (e: RuntimeException) {
            Log.w(TAG, "Wi-Fi callback not registered: ${e.javaClass.simpleName}")
        }
    }

    private fun onWifi(context: Context, network: Network, capabilities: NetworkCapabilities) {
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) capabilities.transportInfo as? WifiInfo else null
        val security = classify(if (info != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) info.currentSecurityType else null)
        current = security
        val newNetwork = decided != network
        if (security != UNKNOWN) decided = network
        if (!isEnabled(context) || security != OPEN || !newNetwork) return
        val manager = TunnelManager.get(context)
        val canStart = VpnService.prepare(context) == null && manager.hasSavedTunnel()
        if (shouldAutoConnect(security, true, newNetwork, manager.status.isActive, canStart)) {
            Log.i(TAG, "open Wi-Fi: starting the saved tunnel")
            manager.startSaved("open-wifi")
        }
    }
}
