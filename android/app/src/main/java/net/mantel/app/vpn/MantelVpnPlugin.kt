package net.mantel.app.vpn

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.net.VpnService
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.core.content.pm.PackageInfoCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.wireguard.crypto.Key
import com.wireguard.crypto.KeyFormatException
import com.wireguard.crypto.KeyPair
import net.mantel.app.R
import net.mantel.app.vpn.obfs.ObfsEndpoint
import net.mantel.app.vpn.obfs.Obfuscation
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors

@CapacitorPlugin(
    name = "MantelVpn",
    permissions = [Permission(alias = MantelVpnPlugin.NOTIFICATIONS, strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class MantelVpnPlugin : Plugin() {

    companion object {
        const val EVENT_STATUS = "status"
        const val EVENT_SYSTEM_THEME = "systemTheme"
        const val NOTIFICATIONS = "notifications"
        private const val TAG = "MantelVpnPlugin"
    }

    private val io = Executors.newCachedThreadPool { r -> Thread(r, "mantel-plugin-io") }
    private lateinit var manager: TunnelManager
    private lateinit var userStore: SecureStore

    private val statusListener: (TunnelStatus) -> Unit = { status ->
        if (hasListeners(EVENT_STATUS)) notifyListeners(EVENT_STATUS, status.toJs())
    }

    override fun load() {
        manager = TunnelManager.get(context)
        userStore = SecureStore(context, SecureStore.PREFS_USER)
        manager.addListener(statusListener)
    }

    private var lastSystemDark: Boolean? = null

    override fun handleOnConfigurationChanged(newConfig: Configuration) {
        super.handleOnConfigurationChanged(newConfig)
        val current = activity ?: return
        current.window.decorView.post {
            runCatching { AppTheme.apply(current, bridge?.webView, AppTheme.stored(context)) }
                .onFailure { Log.w(TAG, "theme re-apply failed", it) }
        }
        val dark = AppTheme.systemDark(context, newConfig)
        if (lastSystemDark != dark) {
            lastSystemDark = dark
            notifyListeners(EVENT_SYSTEM_THEME, JSObject().apply { put("theme", if (dark) AppTheme.DARK else AppTheme.LIGHT) })
        }
    }

    override fun handleOnDestroy() {
        manager.removeListener(statusListener)
        io.shutdown()
        super.handleOnDestroy()
    }

    private fun background(call: PluginCall, block: () -> Unit) {
        io.execute {
            try {
                block()
            } catch (e: Throwable) {
                val cause = if (e is ExecutionException && e.cause != null) e.cause!! else e
                if (cause is TunnelException) {
                    call.reject(cause.message, cause.code)
                } else {
                    Log.w(TAG, "${call.methodName} failed", cause)
                    call.reject(cause.message ?: cause.javaClass.simpleName, "internal", cause as? Exception)
                }
            }
        }
    }

    @PluginMethod
    fun prepare(call: PluginCall) {
        val intent = try {
            VpnService.prepare(activity ?: context)
        } catch (e: Exception) {
            call.reject(AppLanguage.localized(context).getString(R.string.error_vpn_permission_request), "internal", e)
            return
        }
        if (intent == null) {
            call.resolve(granted(true))
            return
        }
        startActivityForResult(call, intent, "vpnConsentResult")
    }

    @ActivityCallback
    private fun vpnConsentResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val granted = result.resultCode == Activity.RESULT_OK || VpnService.prepare(context) == null
        call.resolve(granted(granted))
    }

    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED) {
            call.resolve(granted(true))
            return
        }
        requestPermissionForAlias(NOTIFICATIONS, call, "notificationPermissionResult")
    }

    @PermissionCallback
    private fun notificationPermissionResult(call: PluginCall) {
        val granted = getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED
        call.resolve(granted(granted))
        if (granted) TunnelUi.onStateChanged(context, manager.status)
    }

    @PluginMethod
    fun start(call: PluginCall) {
        val config = call.getString("config")
        val nodeId = call.getString("nodeId")
        if (config.isNullOrBlank() || nodeId.isNullOrBlank()) {
            call.reject("config und nodeId sind erforderlich.", "invalid_argument")
            return
        }
        val label = call.getString("label") ?: ""
        val excluded = try {
            call.getArray("excludedApps", JSArray())!!.toList<Any?>().mapNotNull { (it as? String)?.takeIf(String::isNotBlank) }
        } catch (e: Exception) {
            call.reject("excludedApps muss eine Liste von Paketnamen sein.", "invalid_argument")
            return
        }
        val postQuantum = call.data.opt("postQuantum")
        if (postQuantum != null && postQuantum != JSObject.NULL && postQuantum !is Boolean) {
            call.reject("postQuantum muss true oder false sein.", "invalid_argument")
            return
        }
        val obfsRaw = call.getObject("obfuscation")
        val obfuscation = obfsRaw?.let {
            ObfsEndpoint.of(it.getString("host"), it.getInteger("port"), it.getString("pin"), it.getString("token"))
                ?: return call.reject("obfuscation ist ungültig.", "invalid_argument")
        }
        val api = call.getObject("api")?.let { NodeApi.of(it.getString("baseUrl"), it.getString("token")) }
        background(call) {
            val status = manager.start(SavedTunnel(config, nodeId, label, excluded, postQuantum == true, obfuscation, api)).get()
            call.resolve(status.toJs())
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) = background(call) { call.resolve(manager.stop().get().toJs()) }

    @PluginMethod
    fun status(call: PluginCall) = call.resolve(manager.status.toJs())

    @PluginMethod
    fun clearSavedTunnel(call: PluginCall) = background(call) {
        manager.clearSaved().get()
        call.resolve()
    }

    @PluginMethod
    fun generateKeyPair(call: PluginCall) {
        val pair = KeyPair()
        call.resolve(
            JSObject().apply {
                put("privateKey", pair.privateKey.toBase64())
                put("publicKey", pair.publicKey.toBase64())
            },
        )
    }

    @PluginMethod
    fun publicKeyFromPrivate(call: PluginCall) {
        val raw = call.getString("privateKey")?.trim()
        if (raw.isNullOrEmpty()) {
            call.reject("privateKey fehlt.", "invalid_argument")
            return
        }
        val key = try {
            Key.fromBase64(raw)
        } catch (e: KeyFormatException) {
            call.reject("Ungültiger privater Schlüssel (erwartet: 32 Byte, Base64, 44 Zeichen).", "invalid_argument")
            return
        }
        call.resolve(JSObject().apply { put("publicKey", KeyPair(key).publicKey.toBase64()) })
    }

    @PluginMethod
    fun secureGet(call: PluginCall) {
        val key = requireKey(call) ?: return
        background(call) {
            val value = userStore.get(key)
            call.resolve(JSObject().apply { put("value", value ?: JSObject.NULL) })
        }
    }

    @PluginMethod
    fun secureSet(call: PluginCall) {
        val key = requireKey(call) ?: return
        val value = call.getString("value")
        if (value == null) {
            call.reject("value muss ein String sein.", "invalid_argument")
            return
        }
        background(call) {
            userStore.set(key, value)
            call.resolve()
        }
    }

    @PluginMethod
    fun secureRemove(call: PluginCall) {
        val key = requireKey(call) ?: return
        background(call) {
            userStore.remove(key)
            call.resolve()
        }
    }

    private fun requireKey(call: PluginCall): String? {
        val key = call.getString("key")
        if (key.isNullOrEmpty()) {
            call.reject("key fehlt.", "invalid_argument")
            return null
        }
        return key
    }

    @PluginMethod
    fun wifiState(call: PluginCall) {
        OpenWifiWatcher.register(context)
        call.resolve(
            JSObject().apply {
                put("security", OpenWifiWatcher.current)
                put("autoConnect", OpenWifiWatcher.isEnabled(context))
            },
        )
    }

    @PluginMethod
    fun obfuscation(call: PluginCall) = call.resolve(JSObject().apply { put("mode", Obfuscation.mode(context)) })

    @PluginMethod
    fun setObfuscation(call: PluginCall) {
        val mode = call.getString("mode")?.takeIf { it in Obfuscation.MODES } ?: return call.reject("mode invalid", "invalid_argument")
        Obfuscation.setMode(context, mode)
        call.resolve(JSObject().apply { put("mode", mode) })
    }

    @PluginMethod
    fun setAutoConnectOpenWifi(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: return call.reject("enabled missing")
        OpenWifiWatcher.setEnabled(context, enabled)
        call.resolve(JSObject().apply { put("enabled", enabled) })
    }

    @PluginMethod
    fun systemVpnState(call: PluginCall) {
        val state = manager.alwaysOnState() ?: alwaysOnFromSettings()
        call.resolve(
            JSObject().apply {
                put("supported", state != null)
                put("alwaysOn", state?.first ?: false)
                put("lockdown", state?.second ?: false)
            },
        )
    }

    private fun alwaysOnFromSettings(): Pair<Boolean, Boolean>? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
        return try {
            val resolver = context.contentResolver
            val mine = Settings.Secure.getString(resolver, "always_on_vpn_app") == context.packageName
            val lockdown = Settings.Secure.getInt(resolver, "always_on_vpn_lockdown", 0) == 1
            Pair(mine, mine && lockdown)
        } catch (e: Exception) {
            Log.d(TAG, "always-on settings not readable: ${e.javaClass.simpleName}")
            null
        }
    }

    @PluginMethod
    fun appIcon(call: PluginCall) = background(call) {
        call.resolve(JSObject().apply { put("icon", AppIcon.current(context)) })
    }

    @PluginMethod
    fun setAppIcon(call: PluginCall) {
        val icon = call.getString("icon")
        if (icon == null || icon !in AppIcon.ALL) {
            call.reject("Unbekanntes App-Symbol.", "invalid_argument")
            return
        }
        background(call) {
            AppIcon.set(context, icon)
            call.resolve(JSObject().apply { put("icon", AppIcon.current(context)) })
        }
    }

    @PluginMethod
    fun locales(call: PluginCall) {
        val system = JSArray()
        AppLanguage.systemLocales(context).forEach { system.put(it) }
        call.resolve(
            JSObject().apply {
                put("system", system)
                put("app", AppLanguage.current(context) ?: JSObject.NULL)
            },
        )
    }

    @PluginMethod
    fun setAppLanguage(call: PluginCall) {
        val language = call.getString("language")
        if (language == null || (language != AppLanguage.SYSTEM && language !in AppLanguage.SUPPORTED)) {
            call.reject("Unknown language.", "invalid_argument")
            return
        }
        bridge.executeOnMainThread {
            try {
                AppLanguage.apply(context, language)
                TunnelUi.onLanguageChanged(context, manager.status)
                io.execute { runCatching { AppIcon.refreshForLanguage(context) } }
                call.resolve(JSObject().apply { put("app", AppLanguage.current(context) ?: JSObject.NULL) })
            } catch (e: Exception) {
                Log.w(TAG, "setAppLanguage failed", e)
                call.reject(e.message ?: e.javaClass.simpleName, "internal", e)
            }
        }
    }

    @PluginMethod
    fun setAppTheme(call: PluginCall) {
        val theme = call.getString("theme")
        if (theme == null || theme !in AppTheme.PREFERENCES) {
            call.reject("Unknown theme.", "invalid_argument")
            return
        }
        bridge.executeOnMainThread {
            try {
                AppTheme.store(context, theme)
                val dark = AppTheme.apply(activity, bridge.webView, theme)
                call.resolve(JSObject().apply { put("theme", if (dark) AppTheme.DARK else AppTheme.LIGHT) })
            } catch (e: Exception) {
                Log.w(TAG, "setAppTheme failed", e)
                call.reject(e.message ?: e.javaClass.simpleName, "internal", e)
            }
        }
    }

    @PluginMethod
    fun openVpnSettings(call: PluginCall) {
        try {
            val intent = Intent(Settings.ACTION_VPN_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            (activity ?: context).startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject(AppLanguage.localized(context).getString(R.string.error_open_vpn_settings), "internal", e)
        }
    }

    @PluginMethod
    fun bypassFetch(call: PluginCall) {
        val url = BypassHttp.parseUrl(call.getString("url"))
        if (url == null) {
            call.reject("Invalid URL", "invalid")
            return
        }
        val headers = BypassHttp.sanitizeHeaders(
            call.getObject("headers", JSObject())!!.let { json -> json.keys().asSequence().associateWith { json.opt(it) } },
        )
        val timeoutMs = BypassHttp.clampTimeout(call.getInt("timeoutMs"))
        io.execute {
            try {
                val response = BypassHttp.get(context, url, headers, timeoutMs)
                call.resolve(
                    JSObject().apply {
                        put("status", response.status)
                        put("body", response.body)
                        put("contentType", response.contentType ?: JSObject.NULL)
                    },
                )
            } catch (e: Exception) {
                Log.d(TAG, "bypassFetch failed: ${e.javaClass.simpleName}")
                call.reject("Network error", "network")
            }
        }
    }

    @PluginMethod
    fun measureLatency(call: PluginCall) {
        val raw = call.getArray("targets", JSArray())!!
        val entries = (0 until minOf(raw.length(), LatencyProbe.MAX_TARGETS)).mapNotNull { index ->
            val item = raw.optJSONObject(index) ?: return@mapNotNull null
            mapOf("id" to item.opt("id"), "host" to item.opt("host"), "port" to item.opt("port"))
        }
        val targets = LatencyProbe.sanitize(entries)
        if (targets.isEmpty() || manager.status.isActive) {
            call.resolve(JSObject().apply { put("results", JSArray()) })
            return
        }
        io.execute {
            val results = JSArray()
            try {
                for (measurement in LatencyProbe.measureAll(targets)) {
                    val samples = JSArray()
                    measurement.samples.forEach { samples.put(it ?: JSObject.NULL) }
                    results.put(JSObject().apply {
                        put("id", measurement.id)
                        put("samples", samples)
                    })
                }
            } catch (e: Exception) {
                Log.d(TAG, "measureLatency failed: ${e.javaClass.simpleName}")
            }
            call.resolve(JSObject().apply { put("results", results) })
        }
    }

    @PluginMethod
    fun openUrl(call: PluginCall) {
        val url = call.getString("url")
        val uri = url?.let { Uri.parse(it) }
        if (uri == null || (uri.scheme != "https" && uri.scheme != "http") || uri.host.isNullOrEmpty()) {
            call.reject("Invalid URL", "invalid")
            return
        }
        try {
            val intent = Intent(Intent.ACTION_VIEW, uri)
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            (activity ?: context).startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("No app can open the URL", "internal", e)
        }
    }

    @PluginMethod
    fun installedApps(call: PluginCall) = background(call) {
        val apps = JSArray()
        for (app in InstalledApps.list(context)) {
            apps.put(
                JSObject().apply {
                    put("packageName", app.packageName)
                    put("label", app.label)
                    put("system", app.system)
                    put("icon", app.icon ?: JSObject.NULL)
                },
            )
        }
        call.resolve(JSObject().apply { put("apps", apps) })
    }

    @PluginMethod
    fun appInfo(call: PluginCall) {
        val packageName = context.packageName
        val info: PackageInfo =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(packageName, 0)
            }
        call.resolve(
            JSObject().apply {
                put("versionName", info.versionName ?: "")
                put("versionCode", PackageInfoCompat.getLongVersionCode(info))
                put("packageName", packageName)
                put("sdkInt", Build.VERSION.SDK_INT)
                put("model", deviceModel())
                put("debuggable", (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0)
                put("webViewVersion", runCatching { WebView.getCurrentWebViewPackage()?.versionName }.getOrNull() ?: JSObject.NULL)
            },
        )
    }

    private fun deviceModel(): String {
        val maker = (Build.MANUFACTURER ?: "").trim().replaceFirstChar { it.titlecase(java.util.Locale.ROOT) }
        val model = (Build.MODEL ?: "").trim()
        return when {
            maker.isEmpty() -> model
            model.startsWith(maker, ignoreCase = true) -> model
            else -> "$maker $model".trim()
        }
    }

    private fun granted(value: Boolean) = JSObject().apply { put("granted", value) }

    private fun TunnelStatus.toJs() = JSObject().apply {
        put("state", state)
        put("nodeId", nodeId ?: JSObject.NULL)
        put("startedAt", startedAt ?: JSObject.NULL)
        put("lastHandshakeAt", lastHandshakeAt ?: JSObject.NULL)
        put("rxBytes", rxBytes)
        put("txBytes", txBytes)
        put("endpoint", endpoint ?: JSObject.NULL)
        put("error", error ?: JSObject.NULL)
        put("errorCode", errorCode ?: JSObject.NULL)
        put("quantum", quantum)
        put("obfuscated", obfuscated)
    }
}
