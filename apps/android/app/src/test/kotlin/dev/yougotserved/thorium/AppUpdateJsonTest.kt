package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AppUpdateJsonTest {
    @Test fun agreedManifestRoundTripsWithStrictNumericTypes() {
        assertEquals(updateCandidate().manifest, parseAppUpdateManifest(updateMetadata().toString()))
        rejects(updateMetadata().put("versionCode", "10").toString())
        rejects(updateMetadata().put("versionCode", 10.5).toString())
        rejects(updateMetadata().put("versionCode", 0).toString())
        rejects(updateMetadata().put("minSdk", -1).toString())
    }

    @Test fun rejectsUnknownFieldsAndUnsupportedSchema() {
        rejects(updateMetadata().put("downloadUrl", "https://evil.test/a.apk").toString())
        rejects(updateMetadata().put("schema", 2).toString())
        rejects(updateMetadata().toString() + "{}")
        rejects(" ".repeat(AppUpdateLimits.METADATA_BYTES + 1))
    }

    @Test fun rejectsWrongAssetAndInvalidHashOrSize() {
        val value = updateMetadata()
        value.getJSONObject("apk").put("sha256", "A".repeat(64))
        rejects(value.toString())
        value.getJSONObject("apk").put("sha256", updateApk.sha256).put("sizeBytes", AppUpdateLimits.APK_BYTES + 1)
        rejects(value.toString())
        value.getJSONObject("apk").put("sizeBytes", updateApk.sizeBytes).put("assetName", "other.apk")
        rejects(value.toString())
    }

    private fun rejects(text: String) {
        assertThrows(AppUpdateException::class.java) { parseAppUpdateManifest(text) }
    }
}
