package net.mantel.app

import android.app.Application
import android.content.res.Configuration
import android.os.LocaleList
import com.wireguard.android.backend.GoBackend
import net.mantel.app.vpn.AppLanguage
import net.mantel.app.vpn.OpenWifiWatcher
import net.mantel.app.vpn.TunnelManager
import net.mantel.app.vpn.TunnelUi

class MantelApplication : Application() {
    private var lastLocales: LocaleList? = null

    override fun onCreate() {
        super.onCreate()
        runCatching { AppLanguage.ensureDefault(this) }
        lastLocales = resources.configuration.locales
        GoBackend.setAlwaysOnCallback { TunnelManager.get(this).onAlwaysOnTriggered() }
        OpenWifiWatcher.register(this)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (newConfig.locales == lastLocales) return
        lastLocales = newConfig.locales
        TunnelUi.onLanguageChanged(this, TunnelManager.get(this).status)
    }
}
