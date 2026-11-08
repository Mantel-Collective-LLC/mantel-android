package net.mantel.app.vpn

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.os.Build
import android.util.Base64
import android.util.Log
import java.io.ByteArrayOutputStream
import java.text.Collator
import java.util.Locale
import java.util.concurrent.Callable
import java.util.concurrent.Executors

object InstalledApps {
    private const val ICON_PX = 48

    data class App(val packageName: String, val label: String, val system: Boolean, val icon: String?)

    fun list(context: Context): List<App> {
        val pm = context.packageManager
        val own = context.packageName
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val resolved: List<ResolveInfo> =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.queryIntentActivities(launcher, PackageManager.ResolveInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.queryIntentActivities(launcher, 0)
            }
        val packages = LinkedHashMap<String, ApplicationInfo>()
        for (ri in resolved) {
            val ai = ri.activityInfo?.applicationInfo ?: continue
            if (ai.packageName != own) packages.putIfAbsent(ai.packageName, ai)
        }

        val threads = Runtime.getRuntime().availableProcessors().coerceIn(2, 4)
        val pool = Executors.newFixedThreadPool(threads)
        try {
            val futures = packages.values.map { ai ->
                pool.submit(
                    Callable {
                        val system = (ai.flags and ApplicationInfo.FLAG_SYSTEM) != 0 &&
                            (ai.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) == 0
                        App(
                            packageName = ai.packageName,
                            label = ai.loadLabel(pm).toString().trim().ifEmpty { ai.packageName },
                            system = system,
                            icon = iconDataUrl(pm, ai),
                        )
                    },
                )
            }
            val apps = futures.map { it.get() }
            val collator = Collator.getInstance(Locale.GERMAN).apply { strength = Collator.SECONDARY }
            return apps.sortedWith { a, b ->
                collator.compare(a.label, b.label).takeIf { it != 0 } ?: a.packageName.compareTo(b.packageName)
            }
        } finally {
            pool.shutdown()
        }
    }

    private fun iconDataUrl(pm: PackageManager, ai: ApplicationInfo): String? = try {
        val drawable: Drawable = ai.loadIcon(pm)
        val bitmap = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        drawable.setBounds(0, 0, ICON_PX, ICON_PX)
        drawable.draw(canvas)
        val out = ByteArrayOutputStream(4096)
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        bitmap.recycle()
        "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    } catch (e: Exception) {
        Log.w("MantelApps", "icon for ${ai.packageName} failed: ${e.javaClass.simpleName}")
        null
    }
}
