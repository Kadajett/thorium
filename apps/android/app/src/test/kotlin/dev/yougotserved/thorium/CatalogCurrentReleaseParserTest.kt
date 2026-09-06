package dev.yougotserved.thorium

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class CatalogCurrentReleaseParserTest {
    @Test
    fun currentDetailUsesTheSameVerifiedContractAsCatalogPages() {
        val game = releaseJson()
        val raw = JSONObject().put("game", game).toString()
        assertEquals(CatalogJsonParser.parseRelease(game), CatalogJsonParser.parseCurrentRelease(raw))
    }

    @Test
    fun currentDetailRejectsUnverifiedReleaseAndMalformedEnvelope() {
        val game = releaseJson().put("contentDigest", "0".repeat(64))
        assertThrows(CatalogParseException::class.java) {
            CatalogJsonParser.parseCurrentRelease(JSONObject().put("game", game).toString())
        }
        assertThrows(CatalogParseException::class.java) { CatalogJsonParser.parseCurrentRelease("{\"game\":[]}") }
        assertThrows(CatalogParseException::class.java) { CatalogJsonParser.parseCurrentRelease("{}") }
    }

    @Test
    fun currentDetailRetainsTheResponseSizeBudget() {
        assertThrows(CatalogParseException::class.java) {
            CatalogJsonParser.parseCurrentRelease(" ".repeat(CatalogJsonParser.MAX_CATALOG_BYTES + 1))
        }
    }

    private fun releaseJson(): JSONObject =
        JSONObject(requireNotNull(javaClass.getResource("/tap-race-release.json")).readText())
}
