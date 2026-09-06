package dev.yougotserved.thorium

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.InterruptedIOException

class AppUpdateDiscoveryTest {
    @Test fun prereleasesAreIncludedAndHighestVersionWins() {
        val candidates = listOf(updateCandidate(10), updateCandidate(12))
        val requests = mutableListOf<String>()
        val http = discoveryHttp(candidates, requests)
        assertEquals(candidates.last(), discoverAppUpdate(updateInstalled(), http))
        assertEquals(AppUpdateLimits.RELEASE_PAGES + candidates.size, requests.size)
    }

    @Test fun privateApplicationDoesNotEvenContactGithub() {
        val requests = mutableListOf<String>()
        val original = updateInstalled()
        val installed = original.copy(version = original.version.copy(packageId = "dev.yougotserved.thorium.rewrite"))
        assertNull(discoverAppUpdate(installed, discoveryHttp(listOf(updateCandidate()), requests)))
        assertEquals(emptyList<String>(), requests)
    }

    @Test fun foreignAssetAndMismatchedSizeCannotBind() {
        val json = updateReleaseJson()
        json.getJSONArray("assets").getJSONObject(1).put("browser_download_url", "https://evil.test/update.apk")
        assertThrows(AppUpdateException::class.java) { parseAppUpdateReleases(JSONArray().put(json).toString()) }
        val release = parseAppUpdateReleases(JSONArray().put(updateReleaseJson()).toString()).single()
        val candidate = updateCandidate()
        val manifest = candidate.manifest.copy(apk = candidate.manifest.apk.copy(sizeBytes = 1))
        assertThrows(AppUpdateException::class.java) { bindAppUpdate(release, manifest) }
    }

    @Test fun interruptionStopsMetadataRequestsAndDraftsAreIgnored() {
        val json = JSONArray().put(updateReleaseJson()).toString().toByteArray()
        var metadataReads = 0
        val http = AppUpdateHttpPort(read = { url, _ ->
            if (url.startsWith("https://api.github.com")) json else {
                metadataReads += 1
                throw InterruptedIOException("cancelled")
            }
        }, download = { _, _, _ -> error("Not used") })
        assertThrows(InterruptedIOException::class.java) { discoverAppUpdate(updateInstalled(), http) }
        assertEquals(1, metadataReads)
        val draft = JSONArray().put(updateReleaseJson().put("draft", true)).toString()
        assertEquals(emptyList<AppUpdateRelease>(), parseAppUpdateReleases(draft))
    }
}

private fun discoveryHttp(candidates: List<AppUpdateCandidate>, requests: MutableList<String>): AppUpdateHttpPort =
    AppUpdateHttpPort(read = { url, _ ->
        requests.add(url)
        when {
            url == appUpdateListUrl(1) -> JSONArray(candidates.map(::updateReleaseJson)).toString().toByteArray()
            url.startsWith("https://api.github.com") -> "[]".toByteArray()
            else -> metadataForUrl(candidates, url)
        }
    }, download = { _, _, _ -> error("Not used") })

private fun metadataForUrl(candidates: List<AppUpdateCandidate>, url: String): ByteArray {
    val candidate = candidates.single { url == appUpdateAssetUrl(it.tag, AppUpdateLimits.METADATA_NAME) }
    return updateMetadata(candidate).toString().toByteArray()
}
