package dev.yougotserved.thorium

import android.content.Context
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.security.SecureRandom
import java.time.Instant
import java.util.Base64
import org.json.JSONException
import org.json.JSONObject

/** A random, install-local credential gives an unsigned-in user a stable anonymous account. */
internal class AndroidDeviceCredentialStore(context: Context) : DeviceCredentialPort {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    @Synchronized
    override fun current(): String {
        preferences.getString(CREDENTIAL_KEY, null)?.let { existing ->
            if (DEVICE_CREDENTIAL.matches(existing)) return existing
        }
        val bytes = ByteArray(32).also(SecureRandom()::nextBytes)
        val credential = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        check(preferences.edit().putString(CREDENTIAL_KEY, credential).commit()) {
            "Could not persist the device account credential"
        }
        return credential
    }

    private companion object {
        const val PREFERENCES_NAME = "thorium_device_account"
        const val CREDENTIAL_KEY = "credential_v1"
    }
}

internal fun interface DeviceCredentialPort {
    fun current(): String
}

internal class HttpDeviceAccountAuthorizationAdapter private constructor(
    private val baseUrl: String,
    private val credential: DeviceCredentialPort,
    private val connectionFactory: DeviceAccountConnectionFactory,
    private val nowEpochMs: () -> Long,
) : AccountAuthorizationPort {
    constructor(baseUrl: String, context: Context) : this(
        baseUrl = baseUrl,
        credential = AndroidDeviceCredentialStore(context),
        connectionFactory = DeviceAccountConnectionFactory { uri ->
            uri.toURL().openConnection() as HttpURLConnection
        },
        nowEpochMs = System::currentTimeMillis,
    )

    internal constructor(
        baseUrl: String,
        credential: DeviceCredentialPort,
        openConnection: (URI) -> HttpURLConnection,
        nowEpochMs: () -> Long = System::currentTimeMillis,
    ) : this(
        baseUrl = baseUrl,
        credential = credential,
        connectionFactory = DeviceAccountConnectionFactory(openConnection),
        nowEpochMs = nowEpochMs,
    )

    private val base = baseUrl.trimEnd('/').also(::requirePlatformOrigin)
    private var cached: CachedAuthorization? = null

    @Synchronized
    override fun current(): AccountAuthorization {
        val now = nowEpochMs()
        cached?.takeIf { it.expiresAtEpochMs - now >= MINIMUM_REMAINING_MS }?.let {
            return it.authorization
        }

        val deviceCredential = credential.current()
        require(DEVICE_CREDENTIAL.matches(deviceCredential)) { "Invalid device credential" }
        val connection = connectionFactory.open(URI("$base/v1/device-sessions"))
        connection.connectTimeout = 10_000
        connection.readTimeout = 15_000
        connection.instanceFollowRedirects = false
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        return try {
            val request = JSONObject().put("credential", deviceCredential)
                .toString().toByteArray(Charsets.UTF_8)
            connection.setFixedLengthStreamingMode(request.size)
            connection.outputStream.use { it.write(request) }
            if (connection.responseCode !in setOf(HttpURLConnection.HTTP_OK, HttpURLConnection.HTTP_CREATED)) {
                throw IOException("Device account session was rejected")
            }
            val issued = parseResponse(readBounded(connection, MAX_RESPONSE_BYTES), now)
            cached = issued
            issued.authorization
        } finally {
            connection.disconnect()
        }
    }

    private data class CachedAuthorization(
        val authorization: AccountAuthorization,
        val expiresAtEpochMs: Long,
    )

    private companion object {
        const val MAX_RESPONSE_BYTES = 16 * 1024
        const val MINIMUM_REMAINING_MS = 30_000L
        val RESPONSE_KEYS = setOf("token", "expiresAt")

        fun requirePlatformOrigin(raw: String) {
            val uri = runCatching { URI(raw) }.getOrNull()
            require(
                uri?.scheme == "https" && !uri.host.isNullOrEmpty() && uri.userInfo == null &&
                    uri.rawQuery == null && uri.rawFragment == null &&
                    (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/"),
            ) { "Platform endpoint must be an absolute HTTPS origin" }
        }

        fun readBounded(connection: HttpURLConnection, limit: Int): String {
            if (connection.contentLengthLong > limit) throw IOException("Device session response is too large")
            val output = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > limit) {
                        throw IOException("Device session response is too large")
                    }
                    output.write(buffer, 0, count)
                }
            }
            return output.toString(Charsets.UTF_8.name())
        }

        fun parseResponse(raw: String, nowEpochMs: Long): CachedAuthorization = try {
            val root = JSONObject(raw)
            val actualKeys = buildSet {
                val keys = root.keys()
                while (keys.hasNext()) add(keys.next())
            }
            if (actualKeys != RESPONSE_KEYS) throw IOException("Invalid device session response")
            val token = (root.opt("token") as? String)
                ?.takeIf { it.isNotBlank() && it.length <= 8_192 && it.none(Char::isWhitespace) }
                ?: throw IOException("Invalid device session response")
            val expiresAt = (root.opt("expiresAt") as? String)
                ?.let { Instant.parse(it).toEpochMilli() }
                ?: throw IOException("Invalid device session response")
            if (expiresAt - nowEpochMs < MINIMUM_REMAINING_MS) {
                throw IOException("Device account session expires too soon")
            }
            CachedAuthorization(AccountAuthorization(token), expiresAt)
        } catch (error: IOException) {
            throw error
        } catch (_: JSONException) {
            throw IOException("Invalid device session response")
        } catch (_: RuntimeException) {
            throw IOException("Invalid device session response")
        }
    }
}

private fun interface DeviceAccountConnectionFactory {
    fun open(uri: URI): HttpURLConnection
}

private val DEVICE_CREDENTIAL = Regex("^[A-Za-z0-9_-]{43}$")
