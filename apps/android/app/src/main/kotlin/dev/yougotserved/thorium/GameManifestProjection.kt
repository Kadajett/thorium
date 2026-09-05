package dev.yougotserved.thorium

import org.json.JSONArray
import org.json.JSONObject

data class ManifestEntrypoint(
    val path: String,
    val purpose: String,
)

data class ManifestRuntime(
    val kind: String,
    val sdkCompatibility: String,
    val main: ManifestEntrypoint,
    val companion: ManifestEntrypoint,
    val files: List<String>,
)

data class ManifestDisplays(
    val requiredSurfaces: List<SurfaceRole>,
    val supportsSingleSurfaceFallback: Boolean,
    val main: ReleaseScreen,
    val companion: ReleaseScreen,
)

data class ManifestPlayers(
    val minSlots: Int,
    val maxSlots: Int,
    val maxLocalSlots: Int,
    val sameAccountMultipleSlots: Boolean,
    val defaultLocalSeatPlan: Map<SurfaceRole, Set<Int>>?,
)

data class ManifestMultiplayer(
    val online: Boolean,
    val roomName: String,
    val protocol: String,
    val requiresOnline: Boolean,
)

data class ManifestBudgets(
    val maxPackageBytes: Long,
    val maxFileCount: Int,
    val maxLocalPeerMessageBytes: Int,
)

/** Every manifest-owned value projected by a catalog Game Release. */
data class GameManifestProjection(
    val schema: Int,
    val packageId: String,
    val version: String,
    val displayName: String,
    val summary: String,
    val description: String,
    val runtime: ManifestRuntime,
    val displays: ManifestDisplays,
    val players: ManifestPlayers,
    val multiplayer: ManifestMultiplayer,
    val controls: List<ReleaseControl>,
    val capabilities: List<String>,
    val budgets: ManifestBudgets,
    val controllerBindings: ControllerBindings? = null,
)

/** One strict schema path for both remote catalog projections and archived manifests. */
object GameManifestProjectionParser {
    fun parseManifest(value: JSONObject): GameManifestProjection = parse(value, emptySet())

    fun parseCatalogProjection(value: JSONObject): GameManifestProjection = parse(
        value,
        setOf("tags", "publishedAt", "contentDigest", "bundle"),
    )

    fun safePackagePath(value: String, label: String = "path"): String {
        val segments = value.split('/')
        if (
            value.isEmpty() || value.startsWith('/') || value.contains('\\') || value.contains('%') ||
            value.any { it.code < 0x20 } ||
            segments.any { segment ->
                segment.isEmpty() || segment == "." || segment == ".." ||
                    !segment.matches(Regex("^[A-Za-z0-9][A-Za-z0-9._-]*$"))
            }
        ) invalid("$label is unsafe")
        return value
    }

    private fun parse(value: JSONObject, allowedRootExtras: Set<String>): GameManifestProjection {
        requireKeys(value, MANIFEST_KEYS + allowedRootExtras, "manifest")
        value.validateOptionalString("\$schema")
        val schema = value.requiredInt("schema", 1, 1)
        val packageId = value.requiredString("packageId", 128)
        val version = value.requiredString("version", 64)
        if (!GameLaunchPolicy.isValidPackageId(packageId)) invalid("packageId is invalid")
        if (!GameLaunchPolicy.isValidVersion(version)) invalid("version is invalid")

        val runtimeJson = value.requiredObject("runtime")
        requireKeys(runtimeJson, RUNTIME_KEYS, "runtime")
        val kind = runtimeJson.requiredString("kind", 32)
        if (kind != "web-v1") invalid("runtime.kind is unsupported")
        val sdkCompatibility = runtimeJson.requiredString("sdkCompatibility", 64)
        if (sdkCompatibility !in SUPPORTED_SDK_REQUIREMENTS) {
            invalid("runtime SDK is incompatible")
        }
        val entrypoints = runtimeJson.requiredObject("entrypoints")
        requireKeys(entrypoints, ENTRYPOINTS_KEYS, "runtime.entrypoints")
        val main = entrypoint(entrypoints, "main", "primary-gameplay")
        val companion = entrypoint(entrypoints, "companion", "companion-controls")
        val files = safePaths(runtimeJson.requiredArray("files"), "runtime.files")
        if (files.isEmpty() || files.toSet().size != files.size) {
            invalid("runtime.files is empty or duplicated")
        }
        if ("thorium.json" in files) invalid("runtime.files contains reserved thorium.json")
        if (main.path !in files || companion.path !in files) {
            invalid("entrypoints must be declared files")
        }

        val displaysJson = value.requiredObject("displays")
        requireKeys(displaysJson, DISPLAYS_KEYS, "displays")
        val requiredSurfaces = stringList(displaysJson.requiredArray("requiredSurfaces"), 2)
            .map { role ->
                SurfaceRole.entries.firstOrNull { it.wireValue == role }
                    ?: invalid("required surface is invalid")
            }
        if (requiredSurfaces.toSet() != SurfaceRole.entries.toSet() || requiredSurfaces.size != 2) {
            invalid("both surfaces are required exactly once")
        }
        val fallback = displaysJson.requiredBoolean("supportsSingleSurfaceFallback")
        if (fallback) invalid("single-surface fallback is not supported by this client")
        val displays = ManifestDisplays(
            requiredSurfaces = requiredSurfaces,
            supportsSingleSurfaceFallback = fallback,
            main = screen(displaysJson, "main"),
            companion = screen(displaysJson, "companion"),
        )

        val playersJson = value.requiredObject("players")
        requireKeys(playersJson, PLAYERS_KEYS, "players")
        val minSlots = playersJson.requiredInt("minSlots", 1, 16)
        val maxSlots = playersJson.requiredInt("maxSlots", minSlots, 16)
        val maxLocalSlots = playersJson.requiredInt("maxLocalSlots", 1, maxSlots)
        val sameAccount = playersJson.requiredBoolean("sameAccountMultipleSlots")
        if (maxLocalSlots > 1 && !sameAccount) {
            invalid("multiple local slots require sameAccountMultipleSlots")
        }
        val defaultLocalSeatPlan = if (playersJson.has("defaultLocalSeatPlan")) {
            val plan = playersJson.requiredObject("defaultLocalSeatPlan")
            requireKeys(plan, SEAT_PLAN_KEYS, "players.defaultLocalSeatPlan")
            val parsed = linkedMapOf(
                SurfaceRole.MAIN to playerSlots(plan.requiredArray("main"), "main"),
                SurfaceRole.COMPANION to playerSlots(plan.requiredArray("companion"), "companion"),
            )
            val flattened = parsed.values.flatten()
            if (
                flattened.toSet().size != flattened.size ||
                flattened.toSet() != (0 until flattened.size).toSet() ||
                flattened.size !in minSlots..maxLocalSlots ||
                flattened.size > maxSlots ||
                (flattened.size > 1 && !sameAccount)
            ) invalid("default local seat plan is incompatible with player policy")
            parsed
        } else {
            null
        }
        val players = ManifestPlayers(
            minSlots,
            maxSlots,
            maxLocalSlots,
            sameAccount,
            defaultLocalSeatPlan,
        )

        val controlsJson = value.requiredArray("controls")
        if (controlsJson.length() !in 1..32) invalid("controls count is invalid")
        val controls = (0 until controlsJson.length()).map { index ->
            val control = controlsJson.requiredObject(index)
            requireKeys(control, CONTROL_KEYS, "controls[$index]")
            val id = control.requiredString("id", 32)
            if (!GameLaunchPolicy.isValidControlId(id)) invalid("control id is invalid")
            val kindValue = control.requiredString("kind", 16)
            if (kindValue != "button" && kindValue != "axis") invalid("control kind is invalid")
            ReleaseControl(id, control.requiredString("label", 80), kindValue)
        }
        if (controls.map { it.id }.toSet().size != controls.size) invalid("control ids are duplicated")

        val capabilities = stringList(value.requiredArray("capabilities"), 2)
        if (
            capabilities.toSet().size != capabilities.size ||
            capabilities.any { it != "same-device-peer" && it != "colyseus-session" }
        ) invalid("capabilities are invalid")

        val multiplayerJson = value.requiredObject("multiplayer")
        requireKeys(multiplayerJson, MULTIPLAYER_KEYS, "multiplayer")
        val online = multiplayerJson.requiredBoolean("online")
        val requiresOnline = multiplayerJson.optionalBoolean("requiresOnline") ?: false
        val roomName = multiplayerJson.requiredString("roomName", 32)
        val protocol = multiplayerJson.requiredString("protocol", 64)
        if (
            roomName != "game_session" || protocol != "thorium-game-channel-v1" ||
            (online && "colyseus-session" !in capabilities)
        ) invalid("multiplayer contract is invalid")
        if (requiresOnline && !online) invalid("requiresOnline needs online multiplayer")

        val budgetsJson = value.requiredObject("budgets")
        requireKeys(budgetsJson, BUDGET_KEYS, "budgets")
        val budgets = ManifestBudgets(
            maxPackageBytes = budgetsJson.requiredLong(
                "maxPackageBytes",
                1,
                CatalogJsonParser.MAX_PACKAGE_BYTES,
            ),
            maxFileCount = budgetsJson.requiredInt(
                "maxFileCount",
                1,
                CatalogJsonParser.MAX_FILE_COUNT,
            ),
            maxLocalPeerMessageBytes = budgetsJson.requiredInt(
                "maxLocalPeerMessageBytes",
                1,
                64 * 1024,
            ),
        )
        if (files.size + 1 > budgets.maxFileCount) invalid("runtime file count exceeds its budget")

        return GameManifestProjection(
            schema = schema,
            controllerBindings = if (value.has("controllerBindings")) {
                ControllerBindings.parse(value.opt("controllerBindings"), controls)
            } else null,
            packageId = packageId,
            version = version,
            displayName = value.requiredString("displayName", 80),
            summary = value.requiredString("summary", 140),
            description = value.requiredString("description", 1000),
            runtime = ManifestRuntime(kind, sdkCompatibility, main, companion, files),
            displays = displays,
            players = players,
            multiplayer = ManifestMultiplayer(online, roomName, protocol, requiresOnline),
            controls = controls,
            capabilities = capabilities,
            budgets = budgets,
        )
    }

    private fun entrypoint(parent: JSONObject, role: String, purpose: String): ManifestEntrypoint {
        val value = parent.requiredObject(role)
        requireKeys(value, ENTRYPOINT_KEYS, "runtime.entrypoints.$role")
        val actualPurpose = value.requiredString("purpose", 64)
        if (actualPurpose != purpose) invalid("$role purpose is invalid")
        return ManifestEntrypoint(
            path = safePackagePath(value.requiredString("path", 256), "$role entrypoint"),
            purpose = actualPurpose,
        )
    }

    private fun screen(parent: JSONObject, name: String): ReleaseScreen {
        val value = parent.requiredObject(name)
        requireKeys(value, SCREEN_KEYS, "displays.$name")
        return ReleaseScreen(
            logicalWidth = value.requiredInt("logicalWidth", 160, 4096),
            logicalHeight = value.requiredInt("logicalHeight", 160, 4096),
            maximumDevicePixelRatio = value.requiredFiniteDouble(
                "maximumDevicePixelRatio",
                1.0,
                3.0,
            ),
        )
    }

    private fun safePaths(array: JSONArray, label: String): List<String> =
        (0 until array.length()).map { index ->
            safePackagePath(array.requiredString(index, 256), label)
        }

    private fun stringList(array: JSONArray, maxCount: Int): List<String> {
        if (array.length() > maxCount) invalid("array is too large")
        return (0 until array.length()).map { array.requiredString(it, 100) }
    }

    private fun playerSlots(array: JSONArray, label: String): Set<Int> {
        if (array.length() > 16) invalid("$label seat plan is too large")
        val values = (0 until array.length()).map { index ->
            val value = array.opt(index)
            if (value !is Int || value !in 0..15) invalid("$label seat plan contains an invalid slot")
            value
        }
        if (values.toSet().size != values.size) invalid("$label seat plan contains duplicate slots")
        return values.toSet()
    }

    private fun requireKeys(value: JSONObject, allowed: Set<String>, label: String) {
        val actual = buildSet {
            val keys = value.keys()
            while (keys.hasNext()) add(keys.next())
        }
        val unknown = actual - allowed
        if (unknown.isNotEmpty()) invalid("$label contains unsupported fields: ${unknown.sorted().joinToString()}")
        val missing = allowed.intersect(MANIFEST_REQUIRED_NESTED_KEYS).filterNot(value::has)
        if (missing.isNotEmpty()) invalid("$label is missing fields: ${missing.sorted().joinToString()}")
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

    private fun JSONObject.validateOptionalString(name: String) {
        if (has(name) && opt(name) !is String) invalid("$name must be a string")
    }

    private fun JSONObject.requiredBoolean(name: String): Boolean =
        opt(name) as? Boolean ?: invalid("$name must be boolean")

    private fun JSONObject.optionalBoolean(name: String): Boolean? = when (val value = opt(name)) {
        null -> null
        is Boolean -> value
        else -> invalid("$name must be boolean")
    }

    private fun JSONObject.requiredInt(name: String, min: Int, max: Int): Int {
        val result = opt(name)
        if (result !is Int || result !in min..max) invalid("$name is outside its limit")
        return result
    }

    private fun JSONObject.requiredLong(name: String, min: Long, max: Long): Long {
        val value = opt(name)
        if (value !is Int && value !is Long) invalid("$name must be an integer")
        val result = (value as Number).toLong()
        if (result !in min..max) invalid("$name is outside its limit")
        return result
    }

    private fun JSONObject.requiredFiniteDouble(name: String, min: Double, max: Double): Double {
        val result = (opt(name) as? Number)?.toDouble()
        if (result == null || !result.isFinite() || result !in min..max) {
            invalid("$name is outside its limit")
        }
        return result
    }

    private fun invalid(message: String): Nothing = throw CatalogParseException(message)

    // The host bridge implements SDK 0.1.1 while retaining the 0.1.0 contract.
    // Do not admit future patch requirements merely because their major/minor match.
    private val SUPPORTED_SDK_REQUIREMENTS = setOf("0.1.0", "^0.1.0", "0.1.1", "^0.1.1")

    private val MANIFEST_KEYS = setOf(
        "\$schema",
        "schema",
        "packageId",
        "version",
        "displayName",
        "summary",
        "description",
        "runtime",
        "displays",
        "players",
        "multiplayer",
        "controls",
        "controllerBindings",
        "capabilities",
        "budgets",
    )
    private val RUNTIME_KEYS = setOf("kind", "sdkCompatibility", "entrypoints", "files")
    private val ENTRYPOINTS_KEYS = setOf("main", "companion")
    private val ENTRYPOINT_KEYS = setOf("path", "purpose")
    private val DISPLAYS_KEYS = setOf(
        "requiredSurfaces",
        "supportsSingleSurfaceFallback",
        "main",
        "companion",
    )
    private val SCREEN_KEYS = setOf("logicalWidth", "logicalHeight", "maximumDevicePixelRatio")
    private val PLAYERS_KEYS = setOf(
        "minSlots",
        "maxSlots",
        "maxLocalSlots",
        "sameAccountMultipleSlots",
        "defaultLocalSeatPlan",
    )
    private val SEAT_PLAN_KEYS = setOf("main", "companion")
    private val MULTIPLAYER_KEYS = setOf("online", "roomName", "protocol", "requiresOnline")
    private val CONTROL_KEYS = setOf("id", "label", "kind")
    private val BUDGET_KEYS = setOf(
        "maxPackageBytes",
        "maxFileCount",
        "maxLocalPeerMessageBytes",
    )
    private val MANIFEST_REQUIRED_NESTED_KEYS = RUNTIME_KEYS + ENTRYPOINTS_KEYS + ENTRYPOINT_KEYS +
        DISPLAYS_KEYS + SCREEN_KEYS + PLAYERS_KEYS + MULTIPLAYER_KEYS + CONTROL_KEYS + BUDGET_KEYS +
        (MANIFEST_KEYS - "\$schema") - setOf("defaultLocalSeatPlan", "requiresOnline", "controllerBindings")
}
