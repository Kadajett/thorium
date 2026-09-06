package dev.yougotserved.thorium

import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URI

internal class CatalogHttpFixture(
    private val status: Int = HTTP_OK,
    private val body: String = "{}",
    private val declaredLength: Long = -1,
) : HttpURLConnection(URI("https://catalog.example/v1/catalog/games").toURL()) {
    var disconnected = false
        private set
    var bodyRead = false
        private set

    override fun connect() = Unit
    override fun usingProxy(): Boolean = false
    override fun disconnect() { disconnected = true }
    override fun getResponseCode(): Int = status
    override fun getContentLengthLong(): Long = declaredLength
    override fun getInputStream(): ByteArrayInputStream {
        bodyRead = true
        return ByteArrayInputStream(body.toByteArray(Charsets.UTF_8))
    }
}
