package dev.yougotserved.thorium

import android.content.Context
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.time.Instant
import java.util.UUID
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** The one-call native seam between a catalog selection and a runnable GameSession. */
class GameSessionLauncher internal constructor(
    private val authority: GameSessionAuthorityPort,
    private val accountAuthorization: AccountAuthorizationPort,
    private val releaseIntegrity: GameReleaseIntegrityPort,
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    @Synchronized
    fun start(game: CatalogGame): GameSessionStartResult {
        val seatPlan = defaultSeatPlan(game)
            ?: return GameSessionStartResult.Failed(GameSessionStartFailure.LOCAL_PLAYER_POLICY)
        val digest = game.contentDigest
        if (
            !GameLaunchPolicy.isValidDigest(digest) ||
                !runCatching { releaseIntegrity.verify(game) }.getOrDefault(false)
        ) {
            return GameSessionStartResult.Failed(GameSessionStartFailure.RELEASE_INTEGRITY)
        }
        if (
            !game.multiplayerOnline ||
            COLYSEUS_SESSION !in game.capabilities
        ) {
            return GameSessionStartResult.Ready(localLaunch(game, seatPlan))
        }

        val authorization = runCatching { accountAuthorization.current() }.getOrNull()
            ?: return if (game.multiplayerRequiresOnline) {
                GameSessionStartResult.Failed(GameSessionStartFailure.ACCOUNT_AUTHORIZATION_UNAVAILABLE)
            } else {
                GameSessionStartResult.Ready(localLaunch(game, seatPlan))
            }
        val request = GameSessionStartRequest(
            requestId = newId(),
            release = ExactGameRelease(game.packageId, game.version, digest),
            surfaces = seatPlan.map { (role, slots) ->
                RequestedSurface(
                    surfaceId = "${role.wireValue}-${newId()}",
                    role = role,
                    playerSlots = slots,
                )
            },
        )
        val session = try {
            authority.start(request, authorization)
        } catch (_: GameSessionAuthorityUnavailableException) {
            return if (game.multiplayerRequiresOnline) {
                GameSessionStartResult.Failed(GameSessionStartFailure.AUTHORITY_UNAVAILABLE)
            } else {
                GameSessionStartResult.Ready(localLaunch(game, seatPlan))
            }
        } catch (_: GameSessionAuthorityRejectedException) {
            return GameSessionStartResult.Failed(GameSessionStartFailure.AUTHORITY_REJECTED)
        } catch (_: GameSessionAuthorityContractException) {
            return GameSessionStartResult.Failed(GameSessionStartFailure.AUTHORITY_RESPONSE_MISMATCH)
        }

        return runCatching { onlineLaunch(game, request, session) }
            .fold(
                onSuccess = { GameSessionStartResult.Ready(it) },
                onFailure = {
                    GameSessionStartResult.Failed(GameSessionStartFailure.AUTHORITY_RESPONSE_MISMATCH)
                },
            )
    }

    private fun onlineLaunch(
        game: CatalogGame,
        request: GameSessionStartRequest,
        session: AuthorityGameSession,
    ): GameLaunch {
        require(session.gameSessionId == session.joinOptions.gameSessionId)
        require(session.joinOptions.packageId == request.release.packageId)
        require(session.joinOptions.packageVersion == request.release.version)
        require(session.joinOptions.packageDigest == request.release.contentDigest)
        require(session.expiresAtEpochMs > nowEpochMs() + MINIMUM_CAPABILITY_LIFETIME_MS)
        require(session.roomName == ROOM_NAME)
        require(session.surfaces.size == request.surfaces.size)

        val requestedById = request.surfaces.associateBy(RequestedSurface::surfaceId)
        require(requestedById.size == request.surfaces.size)
        val capabilities = buildMap {
            for (surface in session.surfaces) {
                val requested = requestedById[surface.surfaceId] ?: error("Unknown surface")
                require(surface.role == requested.role)
                require(surface.playerSlots == requested.playerSlots)
                require(surface.ticket.isNotBlank() && surface.ticket.length <= MAX_TICKET_LENGTH)
                require(put(surface.role, session.capability(surface.ticket)) == null)
            }
        }
        require(capabilities.keys == request.surfaces.mapTo(mutableSetOf()) { it.role })

        return GameLaunch.from(
            game = game,
            sessionId = session.gameSessionId,
            localPlayerSlots = request.surfaces.flatMapTo(mutableSetOf()) { it.playerSlots },
            controlledPlayerSlots = request.surfaces.associate { it.role to it.playerSlots },
            surfaceCapabilities = capabilities,
            grantedCapabilities = game.capabilities,
        )
    }

    private fun localLaunch(
        game: CatalogGame,
        seatPlan: Map<SurfaceRole, Set<Int>>,
    ): GameLaunch = GameLaunch.from(
        game = game,
        sessionId = newId(),
        localPlayerSlots = seatPlan.values.flatten().toSet(),
        controlledPlayerSlots = seatPlan,
        surfaceCapabilities = emptyMap(),
        grantedCapabilities = game.capabilities - COLYSEUS_SESSION,
    )

    private fun defaultSeatPlan(game: CatalogGame): Map<SurfaceRole, Set<Int>>? {
        game.defaultLocalSeatPlan?.let { configured ->
            val plan = SurfaceRole.entries.associateWith { role -> configured[role].orEmpty() }
            val slots = plan.values.flatten()
            if (
                slots.isNotEmpty() && slots.toSet().size == slots.size &&
                slots.toSet() == (0 until slots.size).toSet() &&
                slots.size in game.minPlayers..game.maxLocalSlots &&
                slots.size <= game.maxPlayers &&
                (slots.size == 1 || game.sameAccountMultipleSlots)
            ) return plan
            return null
        }
        if (
            game.minPlayers !in 1..16 || game.maxPlayers !in game.minPlayers..16 ||
            game.maxLocalSlots !in 1..game.maxPlayers
        ) return null
        val preferredCount = if (game.sameAccountMultipleSlots && game.maxLocalSlots >= 2) 2 else 1
        val playerCount = maxOf(game.minPlayers, preferredCount)
        if (
            playerCount > game.maxLocalSlots || playerCount > game.maxPlayers ||
            (!game.sameAccountMultipleSlots && playerCount > 1)
        ) return null
        return linkedMapOf(
            SurfaceRole.MAIN to setOf(0),
            SurfaceRole.COMPANION to (1 until playerCount).toSet(),
        )
    }

    private fun AuthorityGameSession.capability(ticket: String): ColyseusSessionCapability =
        ColyseusSessionCapability(
            endpoint = endpoint,
            roomName = roomName,
            ticket = ticket,
            expiresAtEpochMs = expiresAtEpochMs,
            joinOptions = joinOptions.asMap(),
        )

    companion object {
        private const val COLYSEUS_SESSION = "colyseus-session"
        private const val ROOM_NAME = "game_session"
        private const val MINIMUM_CAPABILITY_LIFETIME_MS = 1_000L
        private const val MAX_TICKET_LENGTH = 4_096

        fun create(
            platformBaseUrl: String,
            packageStore: GamePackageStore,
            context: Context,
        ): GameSessionLauncher = GameSessionLauncher(
            authority = HttpGameSessionAuthorityAdapter(platformBaseUrl),
            accountAuthorization = HttpDeviceAccountAuthorizationAdapter(
                platformBaseUrl,
                context.applicationContext,
            ),
            releaseIntegrity = GameReleaseIntegrityPort(packageStore::verifyForLaunch),
        )
    }
}

sealed interface GameSessionStartResult {
    data class Ready(val launch: GameLaunch) : GameSessionStartResult
    data class Failed(val reason: GameSessionStartFailure) : GameSessionStartResult
}

enum class GameSessionStartFailure {
    RELEASE_INTEGRITY,
    LOCAL_PLAYER_POLICY,
    AUTHORITY_REJECTED,
    AUTHORITY_RESPONSE_MISMATCH,
    ACCOUNT_AUTHORIZATION_UNAVAILABLE,
    AUTHORITY_UNAVAILABLE,
}

internal data class AccountAuthorization(val bearerToken: String) {
    init {
        require(
            bearerToken.isNotBlank() && bearerToken.length <= 8_192 &&
                bearerToken.none(Char::isWhitespace),
        ) { "Invalid account authorization" }
    }
}

internal fun interface AccountAuthorizationPort {
    fun current(): AccountAuthorization?
}

internal fun interface GameReleaseIntegrityPort {
    fun verify(game: CatalogGame): Boolean
}

internal object AbsentAccountAuthorizationPort : AccountAuthorizationPort {
    override fun current(): AccountAuthorization? = null
}

internal data class ExactGameRelease(
    val packageId: String,
    val version: String,
    val contentDigest: String,
)

internal data class RequestedSurface(
    val surfaceId: String,
    val role: SurfaceRole,
    val playerSlots: Set<Int>,
)

internal data class GameSessionStartRequest(
    val requestId: String,
    val release: ExactGameRelease,
    val surfaces: List<RequestedSurface>,
)

internal data class AuthorityJoinOptions(
    val gameSessionId: String,
    val packageId: String,
    val packageVersion: String,
    val packageDigest: String,
) {
    fun asMap(): Map<String, String> = linkedMapOf(
        "gameSessionId" to gameSessionId,
        "packageId" to packageId,
        "packageVersion" to packageVersion,
        "packageDigest" to packageDigest,
    )
}

internal data class AuthoritySurfaceTicket(
    val surfaceId: String,
    val role: SurfaceRole,
    val playerSlots: Set<Int>,
    val ticket: String,
)

internal data class AuthorityGameSession(
    val endpoint: String,
    val gameSessionId: String,
    val roomName: String,
    val expiresAtEpochMs: Long,
    val joinOptions: AuthorityJoinOptions,
    val surfaces: List<AuthoritySurfaceTicket>,
)

internal fun interface GameSessionAuthorityPort {
    fun start(
        request: GameSessionStartRequest,
        authorization: AccountAuthorization,
    ): AuthorityGameSession
}

internal class GameSessionAuthorityUnavailableException : IOException()
internal class GameSessionAuthorityRejectedException : IOException()
internal class GameSessionAuthorityContractException : IOException()

internal class HttpGameSessionAuthorityAdapter private constructor(
    private val baseUrl: String,
    private val connectionFactory: AuthorityConnectionFactory,
    private val nowEpochMs: () -> Long,
) : GameSessionAuthorityPort {
    constructor(baseUrl: String) : this(
        baseUrl = baseUrl,
        connectionFactory = AuthorityConnectionFactory {
            uri -> uri.toURL().openConnection() as HttpURLConnection
        },
        nowEpochMs = System::currentTimeMillis,
    )

    internal constructor(
        baseUrl: String,
        openConnection: (URI) -> HttpURLConnection,
        nowEpochMs: () -> Long = System::currentTimeMillis,
    ) : this(
        baseUrl,
        connectionFactory = AuthorityConnectionFactory(openConnection),
        nowEpochMs = nowEpochMs,
    )

    private val base = baseUrl.trimEnd('/').also(::requirePlatformOrigin)

    override fun start(
        request: GameSessionStartRequest,
        authorization: AccountAuthorization,
    ): AuthorityGameSession {
        val connection = try {
            connectionFactory.open(URI("$base/v1/game-sessions"))
        } catch (_: Exception) {
            throw GameSessionAuthorityUnavailableException()
        }
        connection.connectTimeout = 10_000
        connection.readTimeout = 15_000
        connection.instanceFollowRedirects = false
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        connection.setRequestProperty("Authorization", "Bearer ${authorization.bearerToken}")
        return try {
            val body = request.toJson().toString().toByteArray(Charsets.UTF_8)
            connection.setFixedLengthStreamingMode(body.size)
            connection.outputStream.use { it.write(body) }
            when (val status = connection.responseCode) {
                HttpURLConnection.HTTP_OK, HttpURLConnection.HTTP_CREATED -> {
                    val response = readBounded(connection, MAX_RESPONSE_BYTES)
                    parseResponse(response, request, nowEpochMs())
                }
                in 500..599 -> throw GameSessionAuthorityUnavailableException()
                else -> {
                    if (status < 0) throw GameSessionAuthorityUnavailableException()
                    throw GameSessionAuthorityRejectedException()
                }
            }
        } catch (error: GameSessionAuthorityUnavailableException) {
            throw error
        } catch (error: GameSessionAuthorityRejectedException) {
            throw error
        } catch (error: GameSessionAuthorityContractException) {
            throw error
        } catch (_: IOException) {
            throw GameSessionAuthorityUnavailableException()
        } finally {
            connection.disconnect()
        }
    }

    private fun GameSessionStartRequest.toJson(): JSONObject {
        val releaseJson = JSONObject()
            .put("packageId", release.packageId)
            .put("version", release.version)
            .put("contentDigest", release.contentDigest)
        val surfacesJson = JSONArray()
        surfaces.forEach { surface ->
            surfacesJson.put(
                JSONObject()
                    .put("surfaceId", surface.surfaceId)
                    .put("role", surface.role.wireValue)
                    .put("playerSlots", JSONArray(surface.playerSlots.sorted())),
            )
        }
        return JSONObject()
            .put("requestId", requestId)
            .put("release", releaseJson)
            .put("surfaces", surfacesJson)
    }

    companion object {
        private const val MAX_RESPONSE_BYTES = 64 * 1024
        private val RESPONSE_KEYS = setOf(
            "endpoint",
            "gameSessionId",
            "roomName",
            "expiresAt",
            "joinOptions",
            "surfaces",
        )
        private val JOIN_KEYS = setOf(
            "gameSessionId",
            "packageId",
            "packageVersion",
            "packageDigest",
        )
        private val SURFACE_KEYS = setOf("surfaceId", "role", "playerSlots", "ticket")

        private fun requirePlatformOrigin(raw: String) {
            val uri = runCatching { URI(raw) }.getOrNull()
            require(
                uri?.scheme == "https" && !uri.host.isNullOrEmpty() && uri.userInfo == null &&
                    uri.rawQuery == null && uri.rawFragment == null &&
                    (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/"),
            ) { "Platform endpoint must be an absolute HTTPS origin" }
        }

        private fun readBounded(connection: HttpURLConnection, limit: Int): String {
            if (connection.contentLengthLong > limit) throw GameSessionAuthorityContractException()
            val output = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > limit) {
                        throw GameSessionAuthorityContractException()
                    }
                    output.write(buffer, 0, count)
                }
            }
            return output.toString(Charsets.UTF_8.name())
        }

        private fun parseResponse(
            raw: String,
            request: GameSessionStartRequest,
            nowEpochMs: Long,
        ): AuthorityGameSession = try {
            val root = JSONObject(raw).also { it.requireExactKeys(RESPONSE_KEYS) }
            val endpoint = root.requiredString("endpoint", 2_048).also(::requireCapabilityEndpoint)
            val gameSessionId = root.requiredUuid("gameSessionId")
            val roomName = root.requiredString("roomName", 32)
            if (roomName != "game_session") throw GameSessionAuthorityContractException()
            val expiresAt = Instant.parse(root.requiredString("expiresAt", 64)).toEpochMilli()
            if (expiresAt <= nowEpochMs) throw GameSessionAuthorityContractException()

            val join = root.requiredObject("joinOptions").also { it.requireExactKeys(JOIN_KEYS) }
            val joinOptions = AuthorityJoinOptions(
                gameSessionId = join.requiredUuid("gameSessionId"),
                packageId = join.requiredString("packageId", 128),
                packageVersion = join.requiredString("packageVersion", 64),
                packageDigest = join.requiredDigest("packageDigest"),
            )
            if (
                joinOptions.gameSessionId != gameSessionId ||
                joinOptions.packageId != request.release.packageId ||
                joinOptions.packageVersion != request.release.version ||
                joinOptions.packageDigest != request.release.contentDigest
            ) throw GameSessionAuthorityContractException()

            val surfacesJson = root.requiredArray("surfaces")
            if (surfacesJson.length() != request.surfaces.size) {
                throw GameSessionAuthorityContractException()
            }
            val surfaces = (0 until surfacesJson.length()).map { index ->
                val value = surfacesJson.requiredObject(index).also {
                    it.requireExactKeys(SURFACE_KEYS)
                }
                AuthoritySurfaceTicket(
                    surfaceId = value.requiredString("surfaceId", 64),
                    role = SurfaceRole.entries.firstOrNull {
                        it.wireValue == value.requiredString("role", 16)
                    } ?: throw GameSessionAuthorityContractException(),
                    playerSlots = value.requiredPlayerSlots("playerSlots"),
                    ticket = value.requiredString("ticket", 4_096),
                )
            }
            AuthorityGameSession(
                endpoint = endpoint,
                gameSessionId = gameSessionId,
                roomName = roomName,
                expiresAtEpochMs = expiresAt,
                joinOptions = joinOptions,
                surfaces = surfaces,
            )
        } catch (error: GameSessionAuthorityContractException) {
            throw error
        } catch (_: JSONException) {
            throw GameSessionAuthorityContractException()
        } catch (_: IllegalArgumentException) {
            throw GameSessionAuthorityContractException()
        } catch (_: RuntimeException) {
            throw GameSessionAuthorityContractException()
        }

        private fun requireCapabilityEndpoint(raw: String) {
            val uri = runCatching { URI(raw) }.getOrNull()
            val scheme = uri?.scheme?.lowercase()
            if (
                uri == null || scheme !in setOf("https", "wss") || uri.host.isNullOrEmpty() ||
                uri.userInfo != null || uri.rawFragment != null
            ) throw GameSessionAuthorityContractException()
        }

        private fun JSONObject.requireExactKeys(expected: Set<String>) {
            val actual = buildSet {
                val keys = keys()
                while (keys.hasNext()) add(keys.next())
            }
            if (actual != expected) throw GameSessionAuthorityContractException()
        }

        private fun JSONObject.requiredString(name: String, max: Int): String =
            (opt(name) as? String)?.takeIf { it.isNotEmpty() && it.length <= max }
                ?: throw GameSessionAuthorityContractException()

        private fun JSONObject.requiredUuid(name: String): String {
            val value = requiredString(name, 64)
            val parsed = runCatching { UUID.fromString(value) }.getOrElse {
                throw GameSessionAuthorityContractException()
            }
            if (parsed.toString() != value) throw GameSessionAuthorityContractException()
            return value
        }

        private fun JSONObject.requiredDigest(name: String): String =
            requiredString(name, 64).takeIf(GameLaunchPolicy::isValidDigest)
                ?: throw GameSessionAuthorityContractException()

        private fun JSONObject.requiredObject(name: String): JSONObject =
            opt(name) as? JSONObject ?: throw GameSessionAuthorityContractException()

        private fun JSONArray.requiredObject(index: Int): JSONObject =
            opt(index) as? JSONObject ?: throw GameSessionAuthorityContractException()

        private fun JSONObject.requiredArray(name: String): JSONArray =
            opt(name) as? JSONArray ?: throw GameSessionAuthorityContractException()

        private fun JSONObject.requiredPlayerSlots(name: String): Set<Int> {
            val array = requiredArray(name)
            if (array.length() > 16) throw GameSessionAuthorityContractException()
            val slots = (0 until array.length()).map { index ->
                val slot = array.opt(index)
                if (slot !is Int || slot !in 0..15) {
                    throw GameSessionAuthorityContractException()
                }
                slot
            }.toSet()
            if (slots.size != array.length()) throw GameSessionAuthorityContractException()
            return slots
        }
    }
}

private fun interface AuthorityConnectionFactory {
    fun open(uri: URI): HttpURLConnection
}
