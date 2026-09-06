package dev.yougotserved.thorium

import java.io.IOException
import java.net.HttpURLConnection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogHttpResponseTest {
    @Test
    fun releaseChecksBypassCachedResponsesAndDoNotFollowRedirects() {
        val connection = CatalogHttpFixture()
        assertEquals("{}", readCatalogConnection(connection, 2))
        assertEquals("no-cache", connection.getRequestProperty("Cache-Control"))
        assertEquals("application/json", connection.getRequestProperty("Accept"))
        assertFalse(connection.useCaches)
        assertFalse(connection.instanceFollowRedirects)
        assertTrue(connection.disconnected)
    }

    @Test
    fun onlyUnavailableServersAreEligibleForNetworkFallback() {
        val server = CatalogHttpFixture(HttpURLConnection.HTTP_UNAVAILABLE)
        assertThrows(IOException::class.java) { readCatalogConnection(server, 2) }
        assertFalse(server.bodyRead)
        assertTrue(server.disconnected)
        val removed = CatalogHttpFixture(HttpURLConnection.HTTP_NOT_FOUND)
        assertThrows(IllegalStateException::class.java) { readCatalogConnection(removed, 2) }
        assertFalse(removed.bodyRead)
        assertTrue(removed.disconnected)
    }

    @Test
    fun rejectsOversizedBodiesWithAndWithoutAContentLength() {
        val declared = CatalogHttpFixture(declaredLength = 3)
        assertThrows(IllegalStateException::class.java) { readCatalogConnection(declared, 2) }
        assertFalse(declared.bodyRead)
        assertTrue(declared.disconnected)
        val streamed = CatalogHttpFixture(body = "éé")
        assertThrows(IllegalStateException::class.java) { readCatalogConnection(streamed, 3) }
        assertTrue(streamed.bodyRead)
        assertTrue(streamed.disconnected)
    }
}
