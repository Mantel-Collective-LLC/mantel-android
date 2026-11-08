package net.mantel.app

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import net.mantel.app.vpn.AppTheme
import net.mantel.app.vpn.MantelVpnPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(MantelVpnPlugin::class.java)
        super.onCreate(savedInstanceState)
        window.decorView.post { AppTheme.apply(this, bridge?.webView, AppTheme.stored(this)) }
        runCatching { AppTheme.syncSplash(this, AppTheme.stored(this)) }
    }
}
