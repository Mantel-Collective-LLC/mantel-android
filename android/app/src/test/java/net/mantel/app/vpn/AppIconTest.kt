package net.mantel.app.vpn

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class AppIconTest {
    private fun source(path: String): String = File("src/main/java/net/mantel/app/$path").readText()

    private val switches = Regex("""(?m)^[^/*]*AppIcon\.(set|refreshForLanguage)\(""")

    @Test
    fun updateWithAutomaticAndActiveDisguiseKeepsTheAlias() {
        for (path in listOf("MantelApplication.kt", "vpn/AppLanguage.kt", "vpn/TunnelUi.kt")) {
            assertFalse("$path must not switch the launcher alias", switches.containsMatchIn(source(path)))
        }
        val plugin = source("vpn/MantelVpnPlugin.kt")
        val refresh = plugin.indexOf("AppIcon.refreshForLanguage")
        assert(refresh > plugin.indexOf("fun setAppLanguage")) { "refreshForLanguage only from setAppLanguage" }
        assertEquals(1, Regex("AppIcon\\.refreshForLanguage").findAll(plugin).count())
    }

    @Test
    fun aUserLanguageChoiceMovesOnlyADisguisedEntry() {
        val legacy = listOf(".LauncherCalculator")
        assertEquals(".LauncherCalculatorEn", AppIcon.languageSwitchTarget(legacy, "en"))
        assertEquals(".LauncherCalculatorDe", AppIcon.languageSwitchTarget(legacy, "de"))
        assertNull("already right", AppIcon.languageSwitchTarget(listOf(".LauncherCalculatorDe"), "de"))
        assertNull("not disguised", AppIcon.languageSwitchTarget(listOf(".LauncherDefault"), "en"))
        assertNull("not disguised (manifest default)", AppIcon.languageSwitchTarget(emptyList(), "de"))
        assertEquals(".LauncherCalculator", AppIcon.calculatorAlias(null))
    }
}
