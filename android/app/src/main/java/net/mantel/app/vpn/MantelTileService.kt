package net.mantel.app.vpn

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log
import net.mantel.app.R

class MantelTileService : TileService() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val listener: (TunnelStatus) -> Unit = { _ -> mainHandler.post { render() } }

    override fun onStartListening() {
        super.onStartListening()
        TunnelManager.get(this).addListener(listener)
        render()
    }

    override fun onStopListening() {
        TunnelManager.get(this).removeListener(listener)
        super.onStopListening()
    }

    override fun onClick() {
        super.onClick()
        val manager = TunnelManager.get(this)
        if (manager.status.isActive) {
            manager.stop()
            return
        }
        if (VpnService.prepare(this) != null || !manager.hasSavedTunnel()) {
            if (isLocked) unlockAndRun { openApp() } else openApp()
            return
        }
        qsTile?.apply {
            state = Tile.STATE_ACTIVE
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                subtitle = AppLanguage.localized(this@MantelTileService).getString(R.string.tile_connecting)
            }
            updateTile()
        }
        manager.startSaved("tile")
    }

    private fun render() {
        val tile = qsTile ?: return
        val status = TunnelManager.get(this).status
        val res = AppLanguage.localized(this)
        tile.label = res.getString(R.string.app_name)
        tile.state = if (status.isActive) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = when (status.state) {
                TunnelStatus.STATE_UP -> status.label?.takeIf { it.isNotBlank() } ?: res.getString(R.string.tile_connected)
                TunnelStatus.STATE_CONNECTING -> res.getString(R.string.tile_connecting)
                else -> res.getString(R.string.tile_disconnected)
            }
        }
        tile.updateTile()
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    private fun openApp() {
        val intent = AppIcon.launchIntent(this).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE))
            } else {
                @Suppress("DEPRECATION")
                startActivityAndCollapse(intent)
            }
        } catch (e: Exception) {
            Log.w("MantelTile", "could not open app", e)
        }
    }
}
