package dev.yougotserved.thorium

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI

private const val CATALOG_CONNECT_TIMEOUT_MS = 10_000
private const val CATALOG_READ_TIMEOUT_MS = 15_000
private const val FIRST_SERVER_ERROR = 500
private const val LAST_SERVER_ERROR = 599

internal fun readCatalogResponse(url: String, limit: Int): String =
    readCatalogConnection(URI(url).toURL().openConnection() as HttpURLConnection, limit)

internal fun readCatalogConnection(connection: HttpURLConnection, limit: Int): String {
    require(limit in 1..CatalogJsonParser.MAX_CATALOG_BYTES) { "Invalid catalog response budget" }
    connection.connectTimeout = CATALOG_CONNECT_TIMEOUT_MS
    connection.readTimeout = CATALOG_READ_TIMEOUT_MS
    connection.instanceFollowRedirects = false
    connection.useCaches = false
    connection.setRequestProperty("Accept", "application/json")
    connection.setRequestProperty("Cache-Control", "no-cache")
    return try {
        validateCatalogResponse(connection.responseCode, connection.contentLengthLong, limit)
        connection.inputStream.use { readBoundedCatalogBody(it, limit) }
    } finally {
        connection.disconnect()
    }
}

private fun validateCatalogResponse(status: Int, length: Long, limit: Int) {
    if (status in FIRST_SERVER_ERROR..LAST_SERVER_ERROR) {
        throw IOException("Catalog server unavailable ($status)")
    }
    check(status == HttpURLConnection.HTTP_OK) { "Catalog request failed ($status)" }
    check(length <= limit) { "Catalog response is too large" }
}

private fun readBoundedCatalogBody(input: InputStream, limit: Int): String {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var count = input.read(buffer)
    while (count >= 0) {
        check(output.size() + count <= limit) { "Catalog response is too large" }
        output.write(buffer, 0, count)
        count = input.read(buffer)
    }
    return output.toString(Charsets.UTF_8.name())
}
