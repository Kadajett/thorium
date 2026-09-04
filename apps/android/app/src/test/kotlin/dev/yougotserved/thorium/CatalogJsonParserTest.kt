package dev.yougotserved.thorium

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogJsonParserTest {
    @Test
    fun parsesThePlatformGameReleaseAndDescriptorFields() {
        val page = CatalogJsonParser.parsePage(
            JSONObject().put("items", JSONArray().put(releaseJson())).toString(),
        )

        val release = page.items.single()
        assertEquals("dev.yougotserved.tap-race", release.packageId)
        assertEquals("main/index.html", release.mainEntrypoint)
        assertEquals(7_872L, release.bundle.sizeBytes)
        assertEquals(3, release.bundle.files.size)
        assertEquals(2.0, release.mainScreen.maximumDevicePixelRatio, 0.0)
        assertEquals(2.0, release.companionScreen.maximumDevicePixelRatio, 0.0)
        assertEquals("1b1e9e2016b10b5759ba38febfa745a0f3f5bdaef21109d762674179773514d6", release.contentDigest)
    }

    @Test
    fun rejectsAnIncompatibleSdkBeforeInstall() {
        val release = releaseJson()
        release.getJSONObject("runtime").put("sdkCompatibility", "^0.2.0")

        assertThrows(CatalogParseException::class.java) { CatalogJsonParser.parseRelease(release) }
    }

    @Test
    fun rejectsUnsafePathsAndDescriptorDigestDrift() {
        val unsafe = releaseJson()
        unsafe.getJSONObject("runtime").getJSONArray("files").put(0, "../main.html")
        assertThrows(CatalogParseException::class.java) { CatalogJsonParser.parseRelease(unsafe) }

        val drifted = releaseJson().put("contentDigest", "0".repeat(64))
        assertThrows(CatalogParseException::class.java) { CatalogJsonParser.parseRelease(drifted) }
    }

    @Test
    fun countsReservedManifestAgainstFileBudget() {
        val release = releaseJson()
        release.getJSONObject("budgets").put("maxFileCount", 3)

        assertThrows(CatalogParseException::class.java) { CatalogJsonParser.parseRelease(release) }
    }

    @Test
    fun rejectsUnknownBundleFields() {
        val release = releaseJson()
        release.getJSONObject("bundle").put("downloadToken", "must-not-be-accepted")

        val error = assertThrows(CatalogParseException::class.java) {
            CatalogJsonParser.parseRelease(release)
        }

        assertTrue(error.message.orEmpty().contains("bundle contains unsupported fields: downloadToken"))
    }

    @Test
    fun rejectsUnknownBundleFileFields() {
        val release = releaseJson()
        release.getJSONObject("bundle")
            .getJSONArray("files")
            .getJSONObject(0)
            .put("executable", true)

        val error = assertThrows(CatalogParseException::class.java) {
            CatalogJsonParser.parseRelease(release)
        }

        assertTrue(error.message.orEmpty().contains("bundle.files[0] contains unsupported fields: executable"))
    }

    private fun releaseJson(): JSONObject {
        val resource = requireNotNull(javaClass.getResource("/tap-race-release.json"))
        return JSONObject(resource.readText())
    }
}
