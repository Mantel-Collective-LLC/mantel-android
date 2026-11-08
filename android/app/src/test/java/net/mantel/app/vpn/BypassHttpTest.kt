package net.mantel.app.vpn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.IOException

class BypassHttpTest {

    @Test
    fun acceptsOnlyPlainHttpAndHttpsUrls() {
        assertNotNull(BypassHttp.parseUrl("https://api.example.net/api/v1/account"))
        assertNotNull(BypassHttp.parseUrl("http://10.0.2.2:3000/api/v1/account"))
        assertNull(BypassHttp.parseUrl(null))
        assertNull(BypassHttp.parseUrl(""))
        assertNull(BypassHttp.parseUrl("file:///data/data/net.mantel.app/shared_prefs/x.xml"))
        assertNull(BypassHttp.parseUrl("ftp://api.example.net/x"))
        assertNull(BypassHttp.parseUrl("https://user:pw@api.example.net/x"))
        assertNull(BypassHttp.parseUrl("https://api.example.net/x#frag"))
        assertNull(BypassHttp.parseUrl("not a url"))
        assertNull(BypassHttp.parseUrl("https://api.example.net/" + "a".repeat(3000)))
    }

    @Test
    fun keepsOnlyTheHeadersAnApiGetNeeds() {
        val headers = BypassHttp.sanitizeHeaders(
            mapOf(
                "Authorization" to "Bearer tok",
                "Accept" to "application/json",
                "accept-language" to "de",
                "User-Agent" to "MantelAndroid/1.2.3 (Android)",
                "Cookie" to "a=b",
                "Host" to "evil.example",
                "X-Inject" to "x",
                "authorization " to 42,
            ),
        )
        assertEquals(
            mapOf(
                "authorization" to "Bearer tok",
                "accept" to "application/json",
                "accept-language" to "de",
                "user-agent" to "MantelAndroid/1.2.3 (Android)",
            ),
            headers,
        )
        assertEquals(emptyMap<String, String>(), BypassHttp.sanitizeHeaders(mapOf("Accept" to "a\r\nX-Evil: 1")))
    }

    @Test
    fun clampsTheTimeout() {
        assertEquals(10_000, BypassHttp.clampTimeout(null))
        assertEquals(BypassHttp.MIN_TIMEOUT_MS, BypassHttp.clampTimeout(5))
        assertEquals(BypassHttp.MAX_TIMEOUT_MS, BypassHttp.clampTimeout(600_000))
        assertEquals(8_000, BypassHttp.clampTimeout(8_000))
    }

    @Test
    fun capsTheBody() {
        assertEquals("", BypassHttp.readCapped(null))
        assertEquals("{\"ok\":true}", BypassHttp.readCapped(ByteArrayInputStream("{\"ok\":true}".toByteArray())))
        assertEquals("äö", BypassHttp.readCapped(ByteArrayInputStream("äö".toByteArray(Charsets.UTF_8))))
        assertThrows(IOException::class.java) { BypassHttp.readCapped(ByteArrayInputStream(ByteArray(20)), max = 10) }
    }
}
