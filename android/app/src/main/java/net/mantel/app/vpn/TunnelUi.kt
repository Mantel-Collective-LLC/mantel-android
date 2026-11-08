package net.mantel.app.vpn

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.service.quicksettings.TileService
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import net.mantel.app.R
import java.util.Locale

object TunnelUi {
    private const val TAG = "MantelTunnelUi"
    private const val CHANNEL_ID = "vpn_status"
    private const val NOTIFICATION_ID = 1
    const val ACTION_DISCONNECT = "net.mantel.app.action.DISCONNECT"

    private var lastStatsText: String? = null

    fun onStateChanged(context: Context, status: TunnelStatus) {
        requestTileUpdate(context)
        if (status.state == TunnelStatus.STATE_UP) {
            lastStatsText = null
            post(context, status)
        } else if (status.state == TunnelStatus.STATE_DOWN) {
            lastStatsText = null
            NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
        }
    }

    fun onStatsChanged(context: Context, status: TunnelStatus) {
        if (statsText(AppLanguage.localized(context), status) != lastStatsText) post(context, status)
    }

    fun onLanguageChanged(context: Context, status: TunnelStatus) {
        lastStatsText = null
        updateChannel(context)
        onStateChanged(context, status)
    }

    fun requestTileUpdate(context: Context) {
        try {
            TileService.requestListeningState(context, ComponentName(context, MantelTileService::class.java))
        } catch (e: Exception) {
            Log.d(TAG, "requestListeningState: ${e.javaClass.simpleName}")
        }
    }

    private fun updateChannel(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        val res = AppLanguage.localized(context)
        val channel = NotificationChannel(
            CHANNEL_ID,
            res.getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = res.getString(R.string.notification_channel_description)
            setShowBadge(false)
            setSound(null, null)
            enableVibration(false)
        }
        nm.createNotificationChannel(channel)
    }

    private fun post(context: Context, status: TunnelStatus) {
        val nm = NotificationManagerCompat.from(context)
        if (!nm.areNotificationsEnabled()) return
        updateChannel(context)
        val res = AppLanguage.localized(context)

        val openApp = AppIcon.launchIntent(context).let {
            it.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
            PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        val disconnect = PendingIntent.getBroadcast(
            context,
            1,
            Intent(context, TunnelActionReceiver::class.java).setAction(ACTION_DISCONNECT),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val label = status.label?.takeIf { it.isNotBlank() }
        val text = statsText(res, status)
        lastStatsText = text
        val title = when {
            status.isStale(System.currentTimeMillis()) -> res.getString(R.string.notification_title_interrupted)
            label != null -> res.getString(R.string.notification_title_connected_to, label)
            else -> res.getString(R.string.notification_title_connected)
        }
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_mantel)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(openApp)
            .addAction(0, res.getString(R.string.notification_action_disconnect), disconnect)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(true)
            .setUsesChronometer(status.startedAt != null)
            .setWhen(status.startedAt ?: System.currentTimeMillis())
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        try {
            nm.notify(NOTIFICATION_ID, notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "notification not allowed", e)
        }
    }

    private fun statsText(res: Context, status: TunnelStatus): String =
        if (status.isStale(System.currentTimeMillis())) {
            res.getString(R.string.notification_interrupted)
        } else if (status.lastHandshakeAt == null) {
            res.getString(R.string.notification_waiting)
        } else {
            val locale = res.resources.configuration.locales[0] ?: Locale.getDefault()
            "↓ ${formatBytes(status.rxBytes, locale)} · ↑ ${formatBytes(status.txBytes, locale)}"
        }

    private fun formatBytes(bytes: Long, locale: Locale): String {
        if (bytes < 1024) return "$bytes B"
        val units = arrayOf("KB", "MB", "GB", "TB")
        var value = bytes / 1024.0
        var unit = 0
        while (value >= 1024 && unit < units.size - 1) {
            value /= 1024
            unit++
        }
        return String.format(locale, if (value < 10) "%.1f %s" else "%.0f %s", value, units[unit])
    }
}

class TunnelActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TunnelUi.ACTION_DISCONNECT) return
        val pending = goAsync()
        val manager = TunnelManager.get(context)
        Thread {
            try {
                manager.stop().get()
            } catch (e: Exception) {
                Log.w("MantelTunnelUi", "disconnect from notification failed", e)
            } finally {
                pending.finish()
            }
        }.start()
    }
}
