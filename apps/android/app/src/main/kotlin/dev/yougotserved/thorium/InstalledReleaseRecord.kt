package dev.yougotserved.thorium

import org.json.JSONArray
import org.json.JSONObject

data class InstalledReleaseIntegrity(
    val manifestSha256: String,
    val files: List<PackageFileDescriptor>,
) {
    init {
        require(GameLaunchPolicy.isValidDigest(manifestSha256))
        require(files.isNotEmpty() && files.size <= CatalogJsonParser.MAX_FILE_COUNT)
        require(files.map { it.path }.toSet().size == files.size)
        require(
            files.all { file ->
                GameLaunchPolicy.isSafePackagePath(file.path) &&
                    GameLaunchPolicy.isValidDigest(file.sha256) &&
                    file.size in 0..CatalogJsonParser.MAX_PACKAGE_BYTES
            },
        )
        require(files.sumOf { it.size } <= CatalogJsonParser.MAX_PACKAGE_BYTES)
    }
}

data class InstalledReleaseRecord(
    val packageId: String,
    val version: String,
    val contentDigest: String,
    val displayName: String,
    val summary: String,
    val mainEntrypoint: String,
    val companionEntrypoint: String,
    val runtimeFiles: Set<String>,
    val mainScreen: ReleaseScreen,
    val companionScreen: ReleaseScreen,
    val minPlayers: Int,
    val maxPlayers: Int,
    val maxLocalSlots: Int,
    val sameAccountMultipleSlots: Boolean,
    val multiplayerOnline: Boolean,
    val maxLocalPeerMessageBytes: Int,
    val controls: List<ReleaseControl>,
    val southButtonBinding: SouthButtonBinding?,
    val capabilities: Set<String>,
    val integrity: InstalledReleaseIntegrity?,
    val defaultLocalSeatPlan: Map<SurfaceRole, Set<Int>>? = null,
    val multiplayerRequiresOnline: Boolean = false,
) {
    init {
        require(mainEntrypoint in runtimeFiles && companionEntrypoint in runtimeFiles)
        require(runtimeFiles.isNotEmpty() && runtimeFiles.all(GameLaunchPolicy::isSafePackagePath))
        require(minPlayers in 1..maxPlayers && maxPlayers <= 16)
        require(maxLocalSlots in 1..maxPlayers)
        require(maxLocalSlots == 1 || sameAccountMultipleSlots)
        require(!multiplayerOnline || "colyseus-session" in capabilities)
        require(!multiplayerRequiresOnline || multiplayerOnline)
        defaultLocalSeatPlan?.let { plan ->
            val slots = SurfaceRole.entries.flatMap { role -> plan[role].orEmpty() }
            require(plan.keys.all { it in SurfaceRole.entries })
            require(slots.isNotEmpty() && slots.toSet().size == slots.size)
            require(slots.toSet() == (0 until slots.size).toSet())
            require(slots.size in minPlayers..maxLocalSlots && slots.size <= maxPlayers)
            require(slots.size == 1 || sameAccountMultipleSlots)
        }
        require(maxLocalPeerMessageBytes in 1..64 * 1024)
        require(southButtonBinding == null || southButtonBinding.playerSlot in 0 until maxLocalSlots)
        require(integrity == null || integrity.files.map { it.path }.toSet() == runtimeFiles)
    }

    fun toCatalogGame(): CatalogGame = CatalogGame(
        packageId = packageId,
        version = version,
        title = displayName,
        tagline = summary,
        playerLabel = "$minPlayers–$maxPlayers players · $maxLocalSlots local",
        accent = 0xFF8B5CF6,
        mainEntrypoint = mainEntrypoint,
        companionEntrypoint = companionEntrypoint,
        runtimeFiles = runtimeFiles,
        logicalWidth = mainScreen.logicalWidth,
        logicalHeight = mainScreen.logicalHeight,
        maximumDevicePixelRatio = mainScreen.maximumDevicePixelRatio,
        companionLogicalWidth = companionScreen.logicalWidth,
        companionLogicalHeight = companionScreen.logicalHeight,
        companionMaximumDevicePixelRatio = companionScreen.maximumDevicePixelRatio,
        controls = controls,
        southButtonBinding = southButtonBinding,
        minPlayers = minPlayers,
        maxPlayers = maxPlayers,
        maxLocalSlots = maxLocalSlots,
        sameAccountMultipleSlots = sameAccountMultipleSlots,
        multiplayerOnline = multiplayerOnline,
        maxLocalPeerMessageBytes = maxLocalPeerMessageBytes,
        contentDigest = contentDigest,
        release = null,
        capabilities = capabilities,
        defaultLocalSeatPlan = defaultLocalSeatPlan,
        multiplayerRequiresOnline = multiplayerRequiresOnline,
    )
}

object InstalledReleaseRecordCodec {
    fun fromRelease(release: GameRelease): InstalledReleaseRecord = InstalledReleaseRecord(
        packageId = release.packageId,
        version = release.version,
        contentDigest = release.contentDigest,
        displayName = release.displayName,
        summary = release.summary,
        mainEntrypoint = release.mainEntrypoint,
        companionEntrypoint = release.companionEntrypoint,
        runtimeFiles = release.runtimeFiles.toSet(),
        mainScreen = release.mainScreen,
        companionScreen = release.companionScreen,
        minPlayers = release.minPlayers,
        maxPlayers = release.maxPlayers,
        maxLocalSlots = release.maxLocalSlots,
        sameAccountMultipleSlots = release.sameAccountMultipleSlots,
        multiplayerOnline = release.multiplayerOnline,
        maxLocalPeerMessageBytes = release.maxLocalPeerMessageBytes,
        controls = release.controls,
        southButtonBinding = CatalogBindings.southButton(release),
        capabilities = release.capabilities.toSet(),
        integrity = InstalledReleaseIntegrity(
            manifestSha256 = release.bundle.manifestSha256,
            files = release.bundle.files,
        ),
        defaultLocalSeatPlan = release.defaultLocalSeatPlan,
        multiplayerRequiresOnline = release.multiplayerRequiresOnline,
    )

    fun encode(record: InstalledReleaseRecord): String {
        val controls = JSONArray()
        record.controls.forEach { control ->
            controls.put(
                JSONObject()
                    .put("id", control.id)
                    .put("label", control.label)
                    .put("kind", control.kind),
            )
        }
        val runtimeFiles = JSONArray()
        record.runtimeFiles.sorted().forEach(runtimeFiles::put)
        val root = JSONObject()
            .put("schema", if (record.integrity == null) 1 else 3)
            .put("packageId", record.packageId)
            .put("version", record.version)
            .put("contentDigest", record.contentDigest)
            .put("displayName", record.displayName)
            .put("summary", record.summary)
            .put("mainEntrypoint", record.mainEntrypoint)
            .put("companionEntrypoint", record.companionEntrypoint)
            .put("runtimeFiles", runtimeFiles)
            .put("mainScreen", screen(record.mainScreen))
            .put("companionScreen", screen(record.companionScreen))
            .put("minPlayers", record.minPlayers)
            .put("maxPlayers", record.maxPlayers)
            .put("maxLocalSlots", record.maxLocalSlots)
            .put("sameAccountMultipleSlots", record.sameAccountMultipleSlots)
            .put("multiplayerOnline", record.multiplayerOnline)
            .put("multiplayerRequiresOnline", record.multiplayerRequiresOnline)
            .put("maxLocalPeerMessageBytes", record.maxLocalPeerMessageBytes)
            .put("controls", controls)
            .put("capabilities", JSONArray(record.capabilities.sorted()))
        record.defaultLocalSeatPlan?.let { plan ->
            root.put(
                "defaultLocalSeatPlan",
                JSONObject()
                    .put("main", JSONArray(plan[SurfaceRole.MAIN].orEmpty().sorted()))
                    .put("companion", JSONArray(plan[SurfaceRole.COMPANION].orEmpty().sorted())),
            )
        }
        record.integrity?.let { integrity ->
            val files = JSONArray()
            integrity.files.sortedBy { it.path }.forEach { file ->
                files.put(
                    JSONObject()
                        .put("path", file.path)
                        .put("sha256", file.sha256)
                        .put("size", file.size),
                )
            }
            root.put(
                "integrity",
                JSONObject()
                    .put("manifestSha256", integrity.manifestSha256)
                    .put("files", files),
            )
        }
        record.southButtonBinding?.let { binding ->
            root.put(
                "southButton",
                JSONObject()
                    .put("playerSlot", binding.playerSlot)
                    .put("controlId", binding.controlId)
                    .put("surfaceRole", binding.surfaceRole.wireValue),
            )
        }
        return root.toString()
    }

    fun decode(raw: String): InstalledReleaseRecord {
        if (raw.toByteArray(Charsets.UTF_8).size > MAX_ENCODED_BYTES) {
            throw CatalogParseException("record too large")
        }
        val root = JSONObject(raw)
        val schema = root.opt("schema") as? Int
        if (schema == null || schema !in 1..3) {
            throw CatalogParseException("record schema is invalid")
        }
        val packageId = string(root, "packageId", 128)
        val version = string(root, "version", 64)
        val digest = string(root, "contentDigest", 64)
        if (!GameLaunchPolicy.isValidPackageId(packageId) || !GameLaunchPolicy.isValidVersion(version)) {
            throw CatalogParseException("record identity is invalid")
        }
        if (!GameLaunchPolicy.isValidDigest(digest)) throw CatalogParseException("record digest is invalid")
        val controlsJson = root.optJSONArray("controls") ?: throw CatalogParseException("controls missing")
        val controls = (0 until controlsJson.length()).map { index ->
            val control = controlsJson.optJSONObject(index) ?: throw CatalogParseException("control is invalid")
            ReleaseControl(
                id = string(control, "id", 32),
                label = string(control, "label", 80),
                kind = string(control, "kind", 16),
            )
        }
        if (
            controls.isEmpty() || controls.map { it.id }.toSet().size != controls.size ||
            controls.any {
                !GameLaunchPolicy.isValidControlId(it.id) || it.kind !in setOf("button", "axis")
            }
        ) {
            throw CatalogParseException("controls are invalid")
        }
        val runtimeJson = root.optJSONArray("runtimeFiles")
            ?: throw CatalogParseException("runtime files missing")
        val runtimeFiles = (0 until runtimeJson.length()).map { index ->
            CatalogJsonParser.safePath(
                runtimeJson.opt(index) as? String
                    ?: throw CatalogParseException("runtime file is invalid"),
            )
        }.toSet()
        val integrity = when (schema) {
            1 -> {
                if (root.has("integrity")) {
                    throw CatalogParseException("legacy record cannot contain integrity metadata")
                }
                null
            }
            2, 3 -> root.optJSONObject("integrity")?.let(::parseIntegrity)
                ?: throw CatalogParseException("record integrity is missing")
            else -> error("schema was already validated")
        }
        val binding = root.optJSONObject("southButton")?.let { value ->
            SouthButtonBinding(
                playerSlot = integer(value, "playerSlot", 0, 15),
                controlId = string(value, "controlId", 32),
                surfaceRole = optionalString(value, "surfaceRole", 16)?.let { role ->
                    SurfaceRole.entries.firstOrNull { it.wireValue == role }
                        ?: throw CatalogParseException("binding surface role is invalid")
                } ?: SurfaceRole.MAIN,
            ).also { binding ->
                if (controls.none { it.id == binding.controlId }) {
                    throw CatalogParseException("binding is invalid")
                }
            }
        }
        val capabilitiesJson = root.optJSONArray("capabilities")
        val capabilities = capabilitiesJson?.let { values ->
            (0 until values.length()).map { index ->
                values.opt(index) as? String
                    ?: throw CatalogParseException("capability is invalid")
            }.toSet()
        } ?: if (schema == 1) {
            emptySet()
        } else {
            throw CatalogParseException("capabilities missing")
        }
        if (capabilities.any { it != "same-device-peer" && it != "colyseus-session" }) {
            throw CatalogParseException("capabilities are invalid")
        }
        val maxLocalSlots = if (schema == 1) {
            optionalInteger(root, "maxLocalSlots", 1, 16)
                ?: integer(root, "maxLocalPlayers", 1, 16)
        } else {
            integer(root, "maxLocalSlots", 1, 16)
        }
        // Legacy schema-1 records omitted this field. The manifest parser only admitted more than
        // one local slot when same-account leasing was enabled; one-slot records default closed.
        val sameAccountMultipleSlots = if (schema == 1) {
            optionalBoolean(root, "sameAccountMultipleSlots") ?: (maxLocalSlots > 1)
        } else {
            boolean(root, "sameAccountMultipleSlots")
        }
        // Legacy schema-1 records did not retain multiplayer.online. Preserve the launcher behavior
        // they were installed under: the Colyseus capability selected online authority.
        val multiplayerOnline = if (schema == 1) {
            optionalBoolean(root, "multiplayerOnline") ?: ("colyseus-session" in capabilities)
        } else {
            boolean(root, "multiplayerOnline")
        }
        val multiplayerRequiresOnline = if (schema == 3) {
            boolean(root, "multiplayerRequiresOnline")
        } else {
            optionalBoolean(root, "multiplayerRequiresOnline") ?: false
        }
        val defaultLocalSeatPlan = root.optJSONObject("defaultLocalSeatPlan")?.let { plan ->
            mapOf(
                SurfaceRole.MAIN to playerSlots(plan, "main"),
                SurfaceRole.COMPANION to playerSlots(plan, "companion"),
            )
        }.also {
            if (root.has("defaultLocalSeatPlan") && it == null) {
                throw CatalogParseException("default local seat plan is invalid")
            }
        }
        return InstalledReleaseRecord(
            packageId = packageId,
            version = version,
            contentDigest = digest,
            displayName = string(root, "displayName", 80),
            summary = string(root, "summary", 140),
            mainEntrypoint = CatalogJsonParser.safePath(string(root, "mainEntrypoint", 256)),
            companionEntrypoint = CatalogJsonParser.safePath(string(root, "companionEntrypoint", 256)),
            runtimeFiles = runtimeFiles,
            mainScreen = parseScreen(root, "mainScreen"),
            companionScreen = parseScreen(root, "companionScreen"),
            minPlayers = integer(root, "minPlayers", 1, 16),
            maxPlayers = integer(root, "maxPlayers", 1, 16),
            maxLocalSlots = maxLocalSlots,
            sameAccountMultipleSlots = sameAccountMultipleSlots,
            multiplayerOnline = multiplayerOnline,
            multiplayerRequiresOnline = multiplayerRequiresOnline,
            maxLocalPeerMessageBytes = if (schema == 1) {
                optionalInteger(root, "maxLocalPeerMessageBytes", 1, 64 * 1024)
                    ?: LEGACY_MAX_LOCAL_PEER_MESSAGE_BYTES
            } else {
                integer(root, "maxLocalPeerMessageBytes", 1, 64 * 1024)
            },
            controls = controls,
            southButtonBinding = binding,
            capabilities = capabilities,
            integrity = integrity,
            defaultLocalSeatPlan = defaultLocalSeatPlan,
        )
    }

    private fun parseIntegrity(value: JSONObject): InstalledReleaseIntegrity {
        val filesJson = value.optJSONArray("files")
            ?: throw CatalogParseException("integrity files missing")
        if (filesJson.length() !in 1..CatalogJsonParser.MAX_FILE_COUNT) {
            throw CatalogParseException("integrity files are invalid")
        }
        val files = (0 until filesJson.length()).map { index ->
            val file = filesJson.optJSONObject(index)
                ?: throw CatalogParseException("integrity file is invalid")
            PackageFileDescriptor(
                path = CatalogJsonParser.safePath(string(file, "path", 256)),
                sha256 = string(file, "sha256", 64).also { digest ->
                    if (!GameLaunchPolicy.isValidDigest(digest)) {
                        throw CatalogParseException("integrity file digest is invalid")
                    }
                },
                size = long(file, "size", 0, CatalogJsonParser.MAX_PACKAGE_BYTES),
            )
        }
        val manifestSha256 = string(value, "manifestSha256", 64)
        if (!GameLaunchPolicy.isValidDigest(manifestSha256)) {
            throw CatalogParseException("manifest digest is invalid")
        }
        return try {
            InstalledReleaseIntegrity(manifestSha256, files)
        } catch (error: IllegalArgumentException) {
            throw CatalogParseException("record integrity is invalid")
        }
    }

    private fun playerSlots(parent: JSONObject, name: String): Set<Int> {
        val array = parent.optJSONArray(name)
            ?: throw CatalogParseException("$name seat plan is missing")
        if (array.length() > 16) throw CatalogParseException("$name seat plan is too large")
        val values = (0 until array.length()).map { index ->
            array.opt(index) as? Int ?: throw CatalogParseException("$name seat plan is invalid")
        }
        if (values.any { it !in 0..15 } || values.toSet().size != values.size) {
            throw CatalogParseException("$name seat plan is invalid")
        }
        return values.toSet()
    }

    private fun screen(value: ReleaseScreen): JSONObject = JSONObject()
        .put("logicalWidth", value.logicalWidth)
        .put("logicalHeight", value.logicalHeight)
        .put("maximumDevicePixelRatio", value.maximumDevicePixelRatio)

    private fun parseScreen(parent: JSONObject, name: String): ReleaseScreen {
        val value = parent.optJSONObject(name) ?: throw CatalogParseException("screen missing")
        return ReleaseScreen(
            integer(value, "logicalWidth", 160, 4096),
            integer(value, "logicalHeight", 160, 4096),
            finiteDouble(value, "maximumDevicePixelRatio", 1.0, 3.0),
        )
    }

    private fun string(parent: JSONObject, name: String, max: Int): String =
        (parent.opt(name) as? String)?.takeIf { it.isNotEmpty() && it.length <= max }
            ?: throw CatalogParseException("$name is invalid")

    private fun integer(parent: JSONObject, name: String, min: Int, max: Int): Int =
        (parent.opt(name) as? Int)?.takeIf { it in min..max }
            ?: throw CatalogParseException("$name is invalid")

    private fun boolean(parent: JSONObject, name: String): Boolean =
        parent.opt(name) as? Boolean ?: throw CatalogParseException("$name is invalid")

    private fun optionalString(parent: JSONObject, name: String, max: Int): String? =
        when (val value = parent.opt(name)) {
            null -> null
            is String -> value.takeIf { it.isNotEmpty() && it.length <= max }
                ?: throw CatalogParseException("$name is invalid")
            else -> throw CatalogParseException("$name is invalid")
        }

    private fun long(parent: JSONObject, name: String, min: Long, max: Long): Long {
        val raw = parent.opt(name)
        val value = if (raw is Int) raw.toLong() else raw as? Long
        return value?.takeIf { it in min..max }
            ?: throw CatalogParseException("$name is invalid")
    }

    private fun optionalInteger(parent: JSONObject, name: String, min: Int, max: Int): Int? =
        if (!parent.has(name)) {
            null
        } else {
            (parent.opt(name) as? Int)?.takeIf { it in min..max }
                ?: throw CatalogParseException("$name is invalid")
        }

    private fun optionalBoolean(parent: JSONObject, name: String): Boolean? = if (!parent.has(name)) {
        null
    } else {
        parent.opt(name) as? Boolean ?: throw CatalogParseException("$name is invalid")
    }

    private fun finiteDouble(parent: JSONObject, name: String, min: Double, max: Double): Double {
        val result = (parent.opt(name) as? Number)?.toDouble()
        return result?.takeIf { it.isFinite() && it in min..max }
            ?: throw CatalogParseException("$name is invalid")
    }

    const val MAX_ENCODED_BYTES = 64 * 1024
    private const val LEGACY_MAX_LOCAL_PEER_MESSAGE_BYTES = 4096
}
