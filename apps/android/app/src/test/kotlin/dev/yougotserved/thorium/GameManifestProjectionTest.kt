package dev.yougotserved.thorium

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class GameManifestProjectionTest {
    @Test
    fun validatesSchemaAnnotationWithoutIncludingItInPolicyIdentity() {
        val manifest = fixtureManifest()
        val expected = GameManifestProjectionParser.parseManifest(manifest)

        listOf("", "https://yougotserved.dev/schemas/thorium-web-v1.json").forEach { annotation ->
            val annotated = JSONObject(manifest.toString()).put("\$schema", annotation)
            assertEquals(expected, GameManifestProjectionParser.parseManifest(annotated))
        }
    }

    @Test
    fun rejectsANonStringSchemaAnnotation() {
        val manifest = fixtureManifest().put("\$schema", 1)

        assertThrows(CatalogParseException::class.java) {
            GameManifestProjectionParser.parseManifest(manifest)
        }
    }

    @Test
    fun acceptsCanonicalIdentityAndPrereleaseForms() {
        val manifest = fixtureManifest()
            .put("packageId", "games-tap")
            .put("version", "01.002.0003-beta.1")

        val projection = GameManifestProjectionParser.parseManifest(manifest)

        assertEquals("games-tap", projection.packageId)
        assertEquals("01.002.0003-beta.1", projection.version)
    }

    @Test
    fun rejectsIdentityFormsOutsideTheCanonicalSchema() {
        val invalidValues = listOf(
            "packageId" to "taprace",
            "version" to "1.2.3+build.1",
        )

        invalidValues.forEach { (field, value) ->
            val error = assertThrows(CatalogParseException::class.java) {
                GameManifestProjectionParser.parseManifest(fixtureManifest().put(field, value))
            }
            assertTrue(error.message.orEmpty().contains("$field is invalid"))
        }
    }

    @Test
    fun acceptsFractionalDevicePixelRatiosAndRejectsInvalidValues() {
        val manifest = fixtureManifest()
        val main = manifest.getJSONObject("displays").getJSONObject("main")
        main.put("maximumDevicePixelRatio", 1.75)

        assertEquals(
            1.75,
            GameManifestProjectionParser.parseManifest(manifest)
                .displays.main.maximumDevicePixelRatio,
            0.0,
        )

        listOf<Any>("dense", 0.99, 3.01).forEach { invalid ->
            main.put("maximumDevicePixelRatio", invalid)
            assertThrows(CatalogParseException::class.java) {
                GameManifestProjectionParser.parseManifest(manifest)
            }
        }
    }

    @Test
    fun releaseScreenRejectsNonFiniteDevicePixelRatios() {
        listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY).forEach { invalid ->
            assertThrows(IllegalArgumentException::class.java) {
                ReleaseScreen(960, 540, invalid)
            }
        }
    }

    private fun fixtureManifest(): JSONObject {
        val fixture = TestPackages.valid()
        val bytes = fixture.entries.single { (name, _) -> name == "thorium.json" }.second
        return JSONObject(String(bytes, Charsets.UTF_8))
    }
}
