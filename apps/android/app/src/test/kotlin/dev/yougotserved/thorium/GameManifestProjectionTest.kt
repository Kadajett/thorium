package dev.yougotserved.thorium

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class GameManifestProjectionTest {
    @Test
    fun supportsCurrentAndLegacySdkRequirementsButRejectsFutureContracts() {
        val manifest = fixtureManifest()
        val runtime = manifest.getJSONObject("runtime")
        val supportedRequirements = listOf(
            "0.1.0", "^0.1.0", "0.1.1", "^0.1.1", "0.1.2", "^0.1.2", "0.1.3", "^0.1.3",
        )
        supportedRequirements.forEach { supported ->
            runtime.put("sdkCompatibility", supported)
            assertEquals(supported, GameManifestProjectionParser.parseManifest(manifest).runtime.sdkCompatibility)
        }
        listOf("0.1.4", "^0.1.4", "^0.2.0", "^1.0.0", "0.1.1-beta.1", "*").forEach { future ->
            runtime.put("sdkCompatibility", future)
            assertThrows(future, CatalogParseException::class.java) {
                GameManifestProjectionParser.parseManifest(manifest)
            }
        }
    }

    @Test
    fun rejectsMalformedOrAmbiguousControllerProfiles() {
        val controls = listOf(ReleaseControl("fire", "Fire", "button"), ReleaseControl("aim", "Aim", "axis"))
        val invalid = listOf(
            """{"schema":2,"bindings":[{"kind":"button","input":"south","control":"fire"}]}""",
            """{"schema":1,"bindings":[]}""",
            """{"schema":1,"extra":1,"bindings":[{"kind":"button","input":"south","control":"fire"}]}""",
            """{"schema":1,"bindings":[{"kind":"button","input":"invented","control":"fire"}]}""",
            """{"schema":1,"bindings":[{"kind":"button","input":"south","control":"unknown"}]}""",
            """{"schema":1,"bindings":[{"kind":"button","input":"south","control":"aim"}]}""",
            """{"schema":1,"bindings":[{"kind":"axis","input":"left-x","control":"fire"}]}""",
            """{"schema":1,"bindings":[{"kind":"axis-button","input":"left-x","control":"fire","direction":0}]}""",
            """{"schema":1,"bindings":[{"kind":"button","input":"south","control":"fire","direction":1}]}""",
            """{"schema":1,"bindings":[{"kind":"button","input":"south","control":"fire"},{"kind":"button","input":"south","control":"fire"}]}""",
            """{"schema":1,"bindings":[{"kind":"axis","input":"left-x","control":"aim"},{"kind":"axis-button","input":"left-x","control":"fire","direction":1}]}""",
        )
        invalid.forEach { raw ->
            assertThrows(raw, CatalogParseException::class.java) { ControllerBindings.parse(JSONObject(raw), controls) }
        }
        assertThrows(CatalogParseException::class.java) { ControllerBindings.parse(JSONObject.NULL, controls) }
    }

    @Test
    fun acceptsReleaseAuthoredControllerBindings() {
        val manifest = fixtureManifest()
        val control = manifest.getJSONArray("controls").getJSONObject(0).getString("id")
        manifest.put("controllerBindings", JSONObject("""{"schema":1,"bindings":[{"kind":"button","input":"east","control":"$control"}]}"""))
        GameManifestProjectionParser.parseManifest(manifest)
    }

    @Test
    fun preservesAuthoredBindingsThroughInstallation() {
        val fixture = TestPackages.valid()
        val manifest = fixtureManifest()
        val control = manifest.getJSONArray("controls").getJSONObject(0).getString("id")
        manifest.put("controllerBindings", JSONObject("""{"schema":1,"bindings":[{"kind":"button","input":"east","control":"$control"}]}"""))
        val release = fixture.release.copy(manifest = GameManifestProjectionParser.parseManifest(manifest))
        val encoded = InstalledReleaseRecordCodec.encode(InstalledReleaseRecordCodec.fromRelease(release))
        assertTrue(JSONObject(encoded).has("controllerBindings"))
    }

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
