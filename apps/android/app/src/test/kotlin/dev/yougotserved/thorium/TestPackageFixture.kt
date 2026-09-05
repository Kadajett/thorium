package dev.yougotserved.thorium

import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.json.JSONArray
import org.json.JSONObject

data class TestPackageFixture(
    val release: GameRelease,
    val archive: ByteArray,
    val entries: List<Pair<String, ByteArray>>,
)

object TestPackages {
    fun installedGame(): CatalogGame = valid().release.toCatalogGame().copy(release = null)

    fun valid(): TestPackageFixture {
        val gameFiles = linkedMapOf(
            "main/index.html" to "<html>Main</html>".toByteArray(),
            "companion/index.html" to "<html>Companion</html>".toByteArray(),
            "dist/game.js" to "globalThis.game=true;".toByteArray(),
        )
        val manifest = manifest(gameFiles.keys.toList())
        val manifestBytes = JsonCanonicalizer.canonicalize(manifest).toByteArray()
        val entries = gameFiles.entries.map { it.key to it.value } + ("thorium.json" to manifestBytes)
        val archive = zip(entries)
        val files = gameFiles.map { (path, bytes) ->
            PackageFileDescriptor(path, sha256(bytes), bytes.size.toLong())
        }
        val preliminary = GameRelease(
            manifest = GameManifestProjectionParser.parseManifest(manifest),
            tags = listOf("test"),
            publishedAt = "2026-09-04T00:00:00.000Z",
            contentDigest = "0".repeat(64),
            bundle = PackageBundleDescriptor(
                fileName = "test-game.zip",
                url = "https://games.yougotserved.dev/test-game.zip",
                sha256 = sha256(archive),
                sizeBytes = archive.size.toLong(),
                manifestSha256 = sha256(manifestBytes),
                files = files,
            ),
        )
        return TestPackageFixture(withContentDigest(preliminary), archive, entries)
    }

    fun withArchive(release: GameRelease, archive: ByteArray): GameRelease {
        val updated = release.copy(
            bundle = release.bundle.copy(sha256 = sha256(archive), sizeBytes = archive.size.toLong()),
            contentDigest = "0".repeat(64),
        )
        return withContentDigest(updated)
    }

    fun withManifest(
        fixture: TestPackageFixture,
        mutate: (JSONObject) -> Unit,
    ): TestPackageFixture {
        val originalBytes = fixture.entries.single { it.first == "thorium.json" }.second
        val manifest = JSONObject(String(originalBytes, Charsets.UTF_8))
        mutate(manifest)
        val manifestBytes = JsonCanonicalizer.canonicalize(manifest).toByteArray()
        val entries = fixture.entries.map { (name, bytes) ->
            if (name == "thorium.json") name to manifestBytes else name to bytes
        }
        val archive = zip(entries)
        val release = withContentDigest(
            fixture.release.copy(
                contentDigest = "0".repeat(64),
                bundle = fixture.release.bundle.copy(
                    sha256 = sha256(archive),
                    sizeBytes = archive.size.toLong(),
                    manifestSha256 = sha256(manifestBytes),
                ),
            ),
        )
        return TestPackageFixture(release, archive, entries)
    }

    fun zip(entries: List<Pair<String, ByteArray>>): ByteArray {
        val output = ByteArrayOutputStream()
        ZipOutputStream(output).use { zip ->
            entries.forEach { (name, bytes) ->
                zip.putNextEntry(ZipEntry(name))
                zip.write(bytes)
                zip.closeEntry()
            }
        }
        return output.toByteArray()
    }

    fun replaceAscii(source: ByteArray, from: String, to: String): ByteArray {
        require(from.length == to.length)
        val result = source.copyOf()
        val needle = from.toByteArray(Charsets.US_ASCII)
        val replacement = to.toByteArray(Charsets.US_ASCII)
        for (index in 0..result.size - needle.size) {
            if (needle.indices.all { offset -> result[index + offset] == needle[offset] }) {
                replacement.copyInto(result, index)
            }
        }
        return result
    }

    fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { byte -> "%02x".format(byte) }

    private fun withContentDigest(release: GameRelease): GameRelease {
        val canonical = JsonCanonicalizer.canonicalize(GameReleaseIntegrity.canonicalDescriptor(release))
        return release.copy(contentDigest = sha256(canonical.toByteArray()))
    }

    private fun manifest(files: List<String>): JSONObject {
        val fileArray = JSONArray()
        files.forEach(fileArray::put)
        return JSONObject()
            .put("schema", 1)
            .put("packageId", "dev.yougotserved.test-game")
            .put("version", "0.1.0")
            .put("displayName", "Test Game")
            .put("summary", "A test package.")
            .put("description", "A package used by Android installer tests.")
            .put(
                "runtime",
                JSONObject()
                    .put("kind", "web-v1")
                    .put("sdkCompatibility", "^0.1.0")
                    .put(
                        "entrypoints",
                        JSONObject()
                            .put("main", JSONObject().put("path", "main/index.html").put("purpose", "primary-gameplay"))
                            .put("companion", JSONObject().put("path", "companion/index.html").put("purpose", "companion-controls")),
                    )
                    .put("files", fileArray),
            )
            .put(
                "displays",
                JSONObject()
                    .put("requiredSurfaces", JSONArray().put("main").put("companion"))
                    .put("supportsSingleSurfaceFallback", false)
                    .put("main", JSONObject().put("logicalWidth", 960).put("logicalHeight", 540).put("maximumDevicePixelRatio", 1.5))
                    .put("companion", JSONObject().put("logicalWidth", 960).put("logicalHeight", 540).put("maximumDevicePixelRatio", 2.25)),
            )
            .put(
                "players",
                JSONObject()
                    .put("minSlots", 2)
                    .put("maxSlots", 2)
                    .put("maxLocalSlots", 2)
                    .put("sameAccountMultipleSlots", true)
                    .put(
                        "defaultLocalSeatPlan",
                        JSONObject()
                            .put("main", JSONArray().put(0))
                            .put("companion", JSONArray().put(1)),
                    ),
            )
            .put(
                "multiplayer",
                JSONObject()
                    .put("online", false)
                    .put("requiresOnline", false)
                    .put("roomName", "game_session")
                    .put("protocol", "thorium-game-channel-v1"),
            )
            .put("controls", JSONArray().put(JSONObject().put("id", "tap").put("label", "Tap").put("kind", "button")))
            .put("capabilities", JSONArray().put("same-device-peer").put("colyseus-session"))
            .put("budgets", JSONObject().put("maxPackageBytes", 1024 * 1024).put("maxFileCount", 8).put("maxLocalPeerMessageBytes", 4096))
    }
}
