package dev.yougotserved.thorium

import java.net.URI
import java.security.MessageDigest
import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject

object CatalogJsonParser {
    const val MAX_CATALOG_BYTES = 1024 * 1024
    const val MAX_ARCHIVE_BYTES = 8L * 1024 * 1024
    const val MAX_PACKAGE_BYTES = 16L * 1024 * 1024
    const val MAX_FILE_COUNT = 128
    private val digest = Regex("^[0-9a-f]{64}$")

    fun parseCurrentRelease(raw: String): GameRelease = protect {
        if (raw.toByteArray(Charsets.UTF_8).size > MAX_CATALOG_BYTES) invalid("catalog is too large")
        parseRelease(JSONObject(raw).requiredObject("game"))
    }

    fun parsePage(raw: String): CatalogPage = protect {
        if (raw.toByteArray(Charsets.UTF_8).size > MAX_CATALOG_BYTES) invalid("catalog is too large")
        val root = JSONObject(raw)
        val itemsJson = root.requiredArray("items")
        if (itemsJson.length() > 50) invalid("catalog page has too many items")
        val items = (0 until itemsJson.length()).map { index ->
            parseRelease(itemsJson.requiredObject(index))
        }
        val cursor = root.optionalString("nextCursor")
        if (cursor != null && cursor.length !in 1..256) invalid("nextCursor is invalid")
        CatalogPage(items, cursor)
    }

    fun parseRelease(value: JSONObject): GameRelease = protect {
        val manifest = GameManifestProjectionParser.parseCatalogProjection(value)

        val bundleJson = value.requiredObject("bundle")
        requireOnlyKeys(bundleJson, BUNDLE_KEYS, "bundle")
        val bundleFilesJson = bundleJson.requiredArray("files")
        if (bundleFilesJson.length() != manifest.runtime.files.size) {
            invalid("bundle file list does not match runtime")
        }
        val bundleFiles = (0 until bundleFilesJson.length()).map { index ->
            val file = bundleFilesJson.requiredObject(index)
            requireOnlyKeys(file, BUNDLE_FILE_KEYS, "bundle.files[$index]")
            PackageFileDescriptor(
                path = safePath(file.requiredString("path", 256), "bundle.files.path"),
                sha256 = file.requiredDigest("sha256"),
                size = file.requiredLong("size", 0, manifest.budgets.maxPackageBytes),
            )
        }
        if (bundleFiles.map { it.path }.toSet().size != bundleFiles.size) {
            invalid("bundle contains duplicate paths")
        }
        if (bundleFiles.map { it.path }.toSet() != manifest.runtime.files.toSet()) {
            invalid("bundle files do not exactly match runtime.files")
        }
        if (bundleFiles.sumOf { it.size } > manifest.budgets.maxPackageBytes) {
            invalid("declared files exceed package byte budget")
        }
        val bundleUrl = bundleJson.requiredString("url", 2048)
        val uri = runCatching { URI(bundleUrl) }.getOrNull()
        if (uri?.scheme != "https" || uri.host.isNullOrEmpty() || uri.userInfo != null || uri.fragment != null) {
            invalid("bundle.url must be an absolute HTTPS URL")
        }
        val fileName = safeFileName(bundleJson.requiredString("fileName", 200))
        if (uri.rawPath?.substringAfterLast('/') != fileName) invalid("bundle URL does not end in fileName")
        val bundle = PackageBundleDescriptor(
            fileName = fileName,
            url = bundleUrl,
            sha256 = bundleJson.requiredDigest("sha256"),
            sizeBytes = bundleJson.requiredLong("sizeBytes", 1, MAX_ARCHIVE_BYTES),
            manifestSha256 = bundleJson.requiredDigest("manifestSha256"),
            files = bundleFiles,
        )

        GameRelease(
            manifest = manifest,
            tags = stringList(value.requiredArray("tags"), 32),
            publishedAt = value.requiredString("publishedAt", 64).also { Instant.parse(it) },
            contentDigest = value.requiredDigest("contentDigest"),
            bundle = bundle,
        ).also { release ->
            val canonicalDescriptor = JsonCanonicalizer.canonicalize(
                GameReleaseIntegrity.canonicalDescriptor(release),
            ).toByteArray(Charsets.UTF_8)
            val actualContentDigest = MessageDigest.getInstance("SHA-256")
                .digest(canonicalDescriptor)
                .joinToString("") { byte -> "%02x".format(byte) }
            if (actualContentDigest != release.contentDigest) {
                invalid("contentDigest does not match the canonical deploy descriptor")
            }
        }
    }

    private fun stringList(array: JSONArray, maxCount: Int): List<String> {
        if (array.length() > maxCount) invalid("array is too large")
        return (0 until array.length()).map { array.requiredString(it, 100) }
    }

    fun safePath(value: String, label: String = "path"): String =
        GameManifestProjectionParser.safePackagePath(value, label)

    private fun safeFileName(value: String): String {
        if (safePath(value, "fileName").contains('/')) invalid("fileName must not contain directories")
        if (!value.endsWith(".zip")) invalid("fileName must be a ZIP")
        return value
    }

    private fun requireOnlyKeys(value: JSONObject, allowed: Set<String>, label: String) {
        val unknown = buildSet {
            val keys = value.keys()
            while (keys.hasNext()) add(keys.next())
        } - allowed
        if (unknown.isNotEmpty()) {
            invalid("$label contains unsupported fields: ${unknown.sorted().joinToString()}")
        }
    }

    private fun JSONObject.requiredObject(name: String): JSONObject =
        opt(name) as? JSONObject ?: invalid("$name must be an object")

    private fun JSONArray.requiredObject(index: Int): JSONObject =
        opt(index) as? JSONObject ?: invalid("item must be an object")

    private fun JSONObject.requiredArray(name: String): JSONArray =
        opt(name) as? JSONArray ?: invalid("$name must be an array")

    private fun JSONObject.requiredString(name: String, max: Int): String =
        (opt(name) as? String)?.takeIf { it.isNotEmpty() && it.length <= max }
            ?: invalid("$name must be a non-empty string")

    private fun JSONArray.requiredString(index: Int, max: Int): String =
        (opt(index) as? String)?.takeIf { it.isNotEmpty() && it.length <= max }
            ?: invalid("array item must be a non-empty string")

    private fun JSONObject.optionalString(name: String): String? = when (val value = opt(name)) {
        null -> null
        is String -> value
        else -> invalid("$name must be a string")
    }

    private fun JSONObject.requiredBoolean(name: String): Boolean =
        opt(name) as? Boolean ?: invalid("$name must be boolean")

    private fun JSONObject.requiredDigest(name: String): String =
        requiredString(name, 64).takeIf(digest::matches) ?: invalid("$name must be SHA-256")

    private fun JSONObject.requiredInt(name: String, min: Int, max: Int): Int {
        val value = opt(name)
        if (value !is Int || value !in min..max) invalid("$name is outside its limit")
        return value
    }

    private fun JSONObject.requiredLong(name: String, min: Long, max: Long): Long {
        val value = opt(name)
        if (value !is Int && value !is Long) invalid("$name must be an integer")
        val result = (value as Number).toLong()
        if (result !in min..max) invalid("$name is outside its limit")
        return result
    }

    private fun invalid(message: String): Nothing = throw CatalogParseException(message)

    private val BUNDLE_KEYS = setOf(
        "fileName",
        "url",
        "sha256",
        "sizeBytes",
        "manifestSha256",
        "files",
    )
    private val BUNDLE_FILE_KEYS = setOf("path", "sha256", "size")

    private inline fun <T> protect(block: () -> T): T = try {
        block()
    } catch (error: CatalogParseException) {
        throw error
    } catch (error: Exception) {
        throw CatalogParseException("Invalid catalog JSON: ${error.message ?: "unknown error"}")
    }
}
