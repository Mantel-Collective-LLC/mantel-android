package net.mantel.app.vpn

import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.os.Build
import android.os.LocaleList
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat

object AppLanguage {
    const val SYSTEM = "system"
    const val DEFAULT = "en"
    val SUPPORTED = listOf("de", "en")

    private const val PREFS = "mantel_language"
    private const val KEY = "language"

    fun apply(context: Context, language: String) {
        require(language == SYSTEM || language in SUPPORTED) { "unknown language $language" }
        val tag = if (language in SUPPORTED) language else DEFAULT
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, tag).apply()
        AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))
    }

    fun ensureDefault(context: Context) {
        if (explicit(context) == null) apply(context, DEFAULT)
    }

    fun current(context: Context): String? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val locales = context.getSystemService(LocaleManager::class.java)?.applicationLocales
            return locales?.takeIf { !it.isEmpty }?.get(0)?.toLanguageTag()
        }
        return stored(context)
    }

    fun explicit(context: Context): String? =
        current(context)?.lowercase()?.substringBefore('-')?.substringBefore('_')?.takeIf { it in SUPPORTED }

    private fun stored(context: Context): String? =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY, null)
            ?.takeIf { it in SUPPORTED }

    fun systemLocales(context: Context): List<String> {
        val list: LocaleList =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.getSystemService(LocaleManager::class.java)?.systemLocales ?: Resources.getSystem().configuration.locales
            } else {
                Resources.getSystem().configuration.locales
            }
        return List(list.size()) { list[it].toLanguageTag() }
    }

    fun localized(context: Context): Context {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return context
        val tag = stored(context) ?: DEFAULT
        val config = Configuration(context.resources.configuration)
        config.setLocales(LocaleList.forLanguageTags(tag))
        return context.createConfigurationContext(config)
    }
}
