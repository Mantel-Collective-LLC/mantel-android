package net.mantel.app.vpn

import android.app.Activity
import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.webkit.WebView
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import net.mantel.app.R

object AppTheme {
    const val SYSTEM = "system"
    const val LIGHT = "light"
    const val DARK = "dark"
    val PREFERENCES = listOf(SYSTEM, LIGHT, DARK)

    private const val PREFS = "mantel_theme"
    private const val KEY = "theme"

    fun store(context: Context, preference: String) {
        require(preference in PREFERENCES) { "unknown theme $preference" }
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, preference).apply()
        syncSplash(context, preference)
    }

    fun syncSplash(context: Context, preference: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        val mode = when (preference) {
            DARK -> UiModeManager.MODE_NIGHT_YES
            LIGHT -> UiModeManager.MODE_NIGHT_NO
            else -> UiModeManager.MODE_NIGHT_AUTO
        }
        context.getSystemService(UiModeManager::class.java)?.setApplicationNightMode(mode)
    }

    fun stored(context: Context): String =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY, null)
            ?.takeIf { it in PREFERENCES } ?: SYSTEM

    fun systemDark(context: Context, configuration: Configuration = context.resources.configuration): Boolean =
        (configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    fun isDark(context: Context, preference: String, configuration: Configuration = context.resources.configuration): Boolean =
        when (preference) {
            DARK -> true
            LIGHT -> false
            else -> systemDark(context, configuration)
        }

    fun apply(activity: Activity, webView: WebView?, preference: String): Boolean {
        val dark = isDark(activity, preference)
        val canvas = ContextCompat.getColor(activity, if (dark) R.color.mantel_canvas_dark else R.color.mantel_canvas_light)
        val window = activity.window
        window.decorView.setBackgroundColor(canvas)
        webView?.setBackgroundColor(canvas)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            val navigationBar =
                if (!dark && Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) ContextCompat.getColor(activity, R.color.mantel_navbar) else canvas
            @Suppress("DEPRECATION")
            window.statusBarColor = canvas
            @Suppress("DEPRECATION")
            window.navigationBarColor = navigationBar
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
            window.isStatusBarContrastEnforced = false
        }
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
        return dark
    }
}
