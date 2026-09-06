package dev.yougotserved.thorium

import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.security.MessageDigest

class RemoteCatalogClient(
    baseUrl: String,
    private val read: (String, Int) -> String = ::readCatalogResponse,
) {
    private val base = baseUrl.trimEnd('/').also { configured ->
        val uri = runCatching { URI(configured) }.getOrNull()
        require(
                uri?.scheme == "https" && !uri.host.isNullOrEmpty() && uri.userInfo == null &&
                uri.rawQuery == null && uri.rawFragment == null &&
                (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/"),
        ) {
            "Catalog endpoint must be an absolute HTTPS origin"
        }
    }

    fun search(query: String?): CatalogPage {
        val normalized = query?.trim()?.takeIf(String::isNotEmpty)
        require(normalized == null || normalized.length <= MAX_SEARCH_LENGTH) { "Search query is too long" }
        val path = if (normalized == null) {
            "/v1/catalog/games?limit=20"
        } else {
            "/v1/catalog/games/search?limit=20&q=" +
                URLEncoder.encode(normalized, Charsets.UTF_8.name())
        }
        return CatalogJsonParser.parsePage(read("$base$path", CatalogJsonParser.MAX_CATALOG_BYTES))
    }

    fun currentRelease(packageId: String): GameRelease {
        require(GameLaunchPolicy.isValidPackageId(packageId)) { "Invalid game ID" }
        val raw = read("$base/v1/catalog/games/$packageId", CatalogJsonParser.MAX_CATALOG_BYTES)
        return CatalogJsonParser.parseCurrentRelease(raw).also {
            require(it.packageId == packageId) { "Catalog returned a different game" }
        }
    }

    private companion object {
        const val MAX_SEARCH_LENGTH = 100
    }
}

class PackageDownloader private constructor(
    private val downloadDirectory: Path,
    private val connectionFactory: PackageConnectionFactory,
) {
    constructor(downloadDirectory: Path) : this(
        downloadDirectory,
        PackageConnectionFactory { uri -> uri.toURL().openConnection() as HttpURLConnection },
    )

    internal constructor(
        downloadDirectory: Path,
        openConnection: (URI) -> HttpURLConnection,
    ) : this(downloadDirectory, PackageConnectionFactory(openConnection))

    fun download(release: GameRelease): Path {
        Files.createDirectories(downloadDirectory)
        val destination = Files.createTempFile(downloadDirectory, "package-", ".part")
        var connection: HttpURLConnection? = null
        return try {
            connection = connectionFactory.open(URI(release.bundle.url))
            connection.connectTimeout = 10_000
            connection.readTimeout = 30_000
            connection.instanceFollowRedirects = false
            if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                throw PackageInstallException("Package download failed (${connection.responseCode})")
            }
            val declared = connection.contentLengthLong
            if (declared >= 0 && declared != release.bundle.sizeBytes) {
                throw PackageInstallException("Downloaded Content-Length does not match the catalog")
            }
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            connection.inputStream.use { input ->
                Files.newOutputStream(destination, StandardOpenOption.TRUNCATE_EXISTING).use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        if (
                            total > release.bundle.sizeBytes ||
                            total > CatalogJsonParser.MAX_ARCHIVE_BYTES
                        ) throw PackageInstallException("Package download exceeds its byte limit")
                        output.write(buffer, 0, count)
                        digest.update(buffer, 0, count)
                    }
                }
            }
            val actualDigest = digest.digest().joinToString("") { byte -> "%02x".format(byte) }
            if (total != release.bundle.sizeBytes || actualDigest != release.bundle.sha256) {
                throw PackageInstallException("Downloaded package does not match the catalog")
            }
            destination
        } catch (error: Exception) {
            Files.deleteIfExists(destination)
            throw error
        } finally {
            connection?.disconnect()
        }
    }
}

private fun interface PackageConnectionFactory {
    fun open(uri: URI): HttpURLConnection
}
