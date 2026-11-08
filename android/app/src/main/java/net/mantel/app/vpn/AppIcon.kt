package net.mantel.app.vpn

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import net.mantel.app.MainActivity

object AppIcon {
    const val DEFAULT = "default"
    const val CALCULATOR = "calculator"
    val ALL = listOf(DEFAULT, CALCULATOR)

    private const val DEFAULT_ALIAS = ".LauncherDefault"
    private val CALCULATOR_ALIASES = mapOf<String?, String>(
        null to ".LauncherCalculator",
        "de" to ".LauncherCalculatorDe",
        "en" to ".LauncherCalculatorEn",
    )
    private val ALL_ALIASES = listOf(DEFAULT_ALIAS) + CALCULATOR_ALIASES.values

    internal fun calculatorAlias(language: String?): String = CALCULATOR_ALIASES[language] ?: CALCULATOR_ALIASES.getValue(null)

    private fun alias(context: Context, icon: String): String = when (icon) {
        CALCULATOR -> calculatorAlias(AppLanguage.explicit(context))
        else -> DEFAULT_ALIAS
    }

    internal fun languageSwitchTarget(enabled: List<String>, language: String?): String? {
        if (enabled.none { it in CALCULATOR_ALIASES.values }) return null
        val target = calculatorAlias(language)
        return if (enabled == listOf(target)) null else target
    }

    private val NAMESPACE: String = MainActivity::class.java.name.substringBeforeLast('.')

    private fun component(context: Context, alias: String) = ComponentName(context.packageName, NAMESPACE + alias)

    private fun enabledAliases(context: Context): List<String> {
        val pm = context.packageManager
        return ALL_ALIASES.filter { isEnabled(pm, component(context, it), default = it == DEFAULT_ALIAS) }
    }

    fun current(context: Context): String {
        val enabled = enabledAliases(context)
        return if (enabled.any { it in CALCULATOR_ALIASES.values }) CALCULATOR else DEFAULT
    }

    fun refreshForLanguage(context: Context) {
        if (languageSwitchTarget(enabledAliases(context), AppLanguage.explicit(context)) == null) return
        set(context, CALCULATOR)
    }

    fun set(context: Context, icon: String) {
        require(icon in ALL) { "unknown icon $icon" }
        val pm = context.packageManager
        val target = alias(context, icon)
        pm.setComponentEnabledSetting(
            component(context, target),
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
            PackageManager.DONT_KILL_APP,
        )
        for (other in ALL_ALIASES) {
            if (other == target) continue
            pm.setComponentEnabledSetting(
                component(context, other),
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP,
            )
        }
    }

    fun launchIntent(context: Context): Intent =
        Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)

    private fun isEnabled(pm: PackageManager, component: ComponentName, default: Boolean): Boolean =
        when (pm.getComponentEnabledSetting(component)) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
            PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> default
            else -> false
        }
}
