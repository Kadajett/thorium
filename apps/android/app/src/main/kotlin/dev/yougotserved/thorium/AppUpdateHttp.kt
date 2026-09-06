package dev.yougotserved.thorium

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.InterruptedIOException
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.Locale

internal typealias AppUpdateConnectionFactory = (URI) -> HttpURLConnection
private const val UPDATE_CONNECT_TIMEOUT_MS = 10000
private const val UPDATE_READ_TIMEOUT_MS = 15000
private const val UPDATE_REDIRECTS = 5
private const val UPDATE_TEMPORARY_REDIRECT = 307
private const val UPDATE_PERMANENT_REDIRECT = 308

internal fun createAppUpdateHttp(
    connect: AppUpdateConnectionFactory = { it.toURL().openConnection() as HttpURLConnection },
): AppUpdateHttpPort = AppUpdateHttpPort(
    read = { url, limit -> readAppUpdate(url, limit, connect) },
    download = { url, path, apk -> downloadAppUpdate(url, path, apk, connect) },
)

private fun configureUpdateConnection(connection: HttpURLConnection) {
    connection.connectTimeout = UPDATE_CONNECT_TIMEOUT_MS
    connection.readTimeout = UPDATE_READ_TIMEOUT_MS
    connection.instanceFollowRedirects = false
    connection.useCaches = false
    connection.setRequestProperty("User-Agent", "Thorium-Android-Updater")
    connection.setRequestProperty("Accept", "application/vnd.github+json, application/octet-stream")
    connection.setRequestProperty("Accept-Encoding", "identity")
    connection.setRequestProperty("Cache-Control", "no-cache")
    connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
}

private fun updateConnection(uri: URI, connect: AppUpdateConnectionFactory, redirects: Int = 0): HttpURLConnection {
    checkUpdateInterruption()
    requireAppUpdateHttps(uri)
    requireAppUpdate(redirects <= UPDATE_REDIRECTS, "Too many update redirects.")
    val connection = connect(uri)
    var connected = false
    try {
        configureUpdateConnection(connection)
        if (isAppUpdateRedirect(connection.responseCode)) {
            val location = connection.getHeaderField("Location") ?: throw AppUpdateException("Missing update redirect.")
            connection.disconnect()
            return updateConnection(appUpdateRedirect(uri, location), connect, redirects + 1)
        }
        requireAppUpdate(connection.responseCode == HttpURLConnection.HTTP_OK, "GitHub update check is unavailable.")
        connected = true
        return connection
    } finally {
        if (!connected) connection.disconnect()
    }
}

private fun updateRequestUri(url: String): URI {
    val uri = URI(url)
    requireAppUpdateHttps(uri)
    val api = uri.host == "api.github.com" && (1..AppUpdateLimits.RELEASE_PAGES).any { url == appUpdateListUrl(it) }
    val asset = uri.host == "github.com" && uri.path.startsWith("/Kadajett/thorium/releases/download/")
    requireAppUpdate(api || asset, "Update URL is outside the Thorium GitHub repository.")
    return uri
}

private fun readAppUpdate(url: String, limit: Int, connect: AppUpdateConnectionFactory): ByteArray {
    requireAppUpdate(limit in 1..AppUpdateLimits.RELEASE_LIST_BYTES, "Invalid update response budget.")
    val connection = updateConnection(updateRequestUri(url), connect)
    return try {
        requireAppUpdate(connection.contentLengthLong <= limit, "Update response is too large.")
        connection.inputStream.use { readUpdateBytes(it, limit) }
    } finally { connection.disconnect() }
}

private fun readUpdateBytes(input: InputStream, limit: Int): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var count = input.read(buffer)
    while (count >= 0) {
        checkUpdateInterruption()
        requireAppUpdate(output.size().toLong() + count <= limit, "Update response is too large.")
        output.write(buffer, 0, count)
        count = input.read(buffer)
    }
    return output.toByteArray()
}

private fun downloadAppUpdate(url: String, path: Path, apk: AppUpdateApk, connect: AppUpdateConnectionFactory) {
    val connection = updateConnection(updateRequestUri(url), connect)
    try {
        val length = connection.contentLengthLong
        requireAppUpdate(length < 0 || length == apk.sizeBytes, "APK response size does not match.")
        connection.inputStream.use { input ->
            Files.newOutputStream(path).use { output -> copyAppUpdate(input, output, apk) }
        }
    } finally { connection.disconnect() }
}

internal fun copyAppUpdate(input: InputStream, output: OutputStream, apk: AppUpdateApk) {
    requireAppUpdate(apk.sizeBytes in 1..AppUpdateLimits.APK_BYTES, "Invalid APK download budget.")
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var size = 0L
    var count = input.read(buffer)
    while (count >= 0) {
        checkUpdateInterruption()
        size += count
        requireAppUpdate(size <= apk.sizeBytes, "The APK exceeds its declared size.")
        digest.update(buffer, 0, count)
        output.write(buffer, 0, count)
        count = input.read(buffer)
    }
    requireAppUpdate(size == apk.sizeBytes, "The APK download was incomplete.")
    requireAppUpdate(appUpdateHex(digest.digest()) == apk.sha256, "The APK checksum does not match.")
}

internal fun appUpdateHex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(Locale.ROOT, it) }

private fun isAppUpdateRedirect(status: Int): Boolean = status in setOf(
    HttpURLConnection.HTTP_MOVED_PERM, HttpURLConnection.HTTP_MOVED_TEMP, HttpURLConnection.HTTP_SEE_OTHER,
    UPDATE_TEMPORARY_REDIRECT, UPDATE_PERMANENT_REDIRECT,
)

private fun checkUpdateInterruption() {
    if (Thread.currentThread().isInterrupted) throw InterruptedIOException("Update download cancelled.")
}
