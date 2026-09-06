package dev.yougotserved.thorium

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class RemoteCatalogCurrentTest {
    @Test
    fun currentLookupUsesTheUnversionedDetailAndChecksPackageIdentity() {
        val raw = JSONObject().put("game", releaseJson()).toString()
        val client = RemoteCatalogClient("https://catalog.example") { url, limit ->
            assertEquals("https://catalog.example/v1/catalog/games/dev.yougotserved.tap-race", url)
            assertEquals(CatalogJsonParser.MAX_CATALOG_BYTES, limit)
            raw
        }
        assertEquals("dev.yougotserved.tap-race", client.currentRelease("dev.yougotserved.tap-race").packageId)
        val mismatch = RemoteCatalogClient("https://catalog.example") { _, _ -> raw }
        assertThrows(IllegalArgumentException::class.java) { mismatch.currentRelease("dev.test.other") }
    }

    @Test
    fun invalidPackageIdsCannotTurnIntoArbitraryCatalogUrls() {
        val client = RemoteCatalogClient("https://catalog.example") { _, _ -> error("Must not fetch") }
        assertThrows(IllegalArgumentException::class.java) { client.currentRelease("../other") }
        assertThrows(IllegalArgumentException::class.java) { client.currentRelease("dev.test.game?version=1.0.0") }
    }

    private fun releaseJson(): JSONObject =
        JSONObject(requireNotNull(javaClass.getResource("/tap-race-release.json")).readText())
}
