package dev.yougotserved.thorium

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.json.JSONArray
import org.json.JSONObject

class GamePackageInstallerTest {
    @get:Rule
    val temporary = TemporaryFolder()

    @Test
    fun verifiesThenAtomicallyPromotesAndEnumeratesTheInstalledRelease() {
        val fixture = TestPackages.valid()
        val root = temporary.newFolder("store").toPath()
        val archive = root.resolve("package.zip")
        Files.write(archive, fixture.archive)
        val installer = VerifiedGamePackageInstaller(root)

        val installed = installer.install(archive, fixture.release)

        assertTrue(installer.isInstalled(fixture.release))
        assertEquals("<html>Main</html>", Files.readString(installed.directory.resolve("main/index.html")))
        val installedRecord = installer.installedRecords().single()
        assertEquals(fixture.release.contentDigest, installedRecord.contentDigest)
        assertEquals(fixture.release.capabilities.toSet(), installedRecord.capabilities)
        assertEquals(fixture.release.bundle.manifestSha256, installedRecord.integrity?.manifestSha256)
        assertEquals(
            fixture.release.bundle.files.sortedBy { it.path },
            installedRecord.integrity?.files?.sortedBy { it.path },
        )
        assertEquals(
            fixture.release.sameAccountMultipleSlots,
            installedRecord.sameAccountMultipleSlots,
        )
        assertEquals(fixture.release.multiplayerOnline, installedRecord.multiplayerOnline)
        assertEquals(fixture.release.maxLocalSlots, installedRecord.maxLocalSlots)
        assertEquals(
            fixture.release.maxLocalPeerMessageBytes,
            installedRecord.maxLocalPeerMessageBytes,
        )
        val launch = GameLaunch.from(installedRecord.toCatalogGame(), "installed-session")
        assertEquals(fixture.release.maxLocalSlots, launch.maxLocalSlots)
        assertEquals(setOf(0, 1), launch.localPlayerSlots)
        assertEquals(fixture.release.maxLocalPeerMessageBytes, launch.maxLocalPeerMessageBytes)
        assertEquals(
            fixture.release.mainScreen.maximumDevicePixelRatio,
            installedRecord.mainScreen.maximumDevicePixelRatio,
            0.0,
        )
        assertEquals(
            fixture.release.companionScreen.maximumDevicePixelRatio,
            launch.companionMaximumDevicePixelRatio,
            0.0,
        )
        assertTrue(Files.list(root.resolve(".staging")).use { it.findAny().isEmpty })
    }

    @Test
    fun launchVerificationRehashesRuntimeFilesAndRejectsLegacyOrLinkedBytes() {
        val fixture = TestPackages.valid()
        val root = temporary.newFolder("launch-integrity").toPath()
        val archive = root.resolve("package.zip")
        Files.write(archive, fixture.archive)
        val installer = VerifiedGamePackageInstaller(root)
        val installed = installer.install(archive, fixture.release)
        val game = requireNotNull(installer.installedRecords().single().toCatalogGame())
        val gameScript = installed.directory.resolve("dist/game.js")
        val originalScript = Files.readAllBytes(gameScript)

        assertTrue(installer.verifyForLaunch(game))

        Files.write(gameScript, originalScript.copyOf().also { bytes ->
            bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
        })
        assertFalse(installer.verifyForLaunch(game))
        installer.install(archive, fixture.release)
        assertTrue(installer.verifyForLaunch(game))

        Files.delete(gameScript)
        assertFalse(installer.verifyForLaunch(game))
        installer.install(archive, fixture.release)
        assertTrue(installer.verifyForLaunch(game))

        val linkedBytes = root.resolve("linked-game.js")
        Files.write(linkedBytes, originalScript)
        Files.delete(gameScript)
        Files.createSymbolicLink(gameScript, linkedBytes)
        assertFalse(installer.verifyForLaunch(game))
        installer.install(archive, fixture.release)
        assertTrue(installer.verifyForLaunch(game))

        val recordPath = installed.directory.resolve(".thorium-release.json")
        val legacy = JSONObject(Files.readString(recordPath))
            .put("schema", 1)
            .apply { remove("integrity") }
        Files.writeString(recordPath, legacy.toString())
        assertFalse(installer.verifyForLaunch(game))
        installer.install(archive, fixture.release)
        assertTrue(installer.verifyForLaunch(game))
    }

    @Test
    fun installedRecordPersistsPlayerPolicyAndReadsLegacyRecordsConservatively() {
        val release = TestPackages.valid().release
        val encoded = InstalledReleaseRecordCodec.encode(
            InstalledReleaseRecordCodec.fromRelease(release),
        )
        val current = InstalledReleaseRecordCodec.decode(encoded)
        val legacy = InstalledReleaseRecordCodec.decode(
            JSONObject(encoded).apply {
                put("schema", 1)
                remove("integrity")
                remove("sameAccountMultipleSlots")
                remove("multiplayerOnline")
            }.toString(),
        )

        assertEquals(release.minPlayers, current.minPlayers)
        assertEquals(release.maxPlayers, current.maxPlayers)
        assertEquals(release.sameAccountMultipleSlots, current.sameAccountMultipleSlots)
        assertEquals(release.multiplayerOnline, current.multiplayerOnline)
        assertEquals(current.maxLocalSlots > 1, legacy.sameAccountMultipleSlots)
        assertEquals("colyseus-session" in current.capabilities, legacy.multiplayerOnline)
        assertEquals(current.sameAccountMultipleSlots, current.toCatalogGame().sameAccountMultipleSlots)
        assertNull(legacy.integrity)
    }

    @Test
    fun schemaTwoCannotUseLegacyDefaultsOrDowngradeItsIntegrityEnvelope() {
        val encoded = InstalledReleaseRecordCodec.encode(
            InstalledReleaseRecordCodec.fromRelease(TestPackages.valid().release),
        )

        assertThrows(CatalogParseException::class.java) {
            InstalledReleaseRecordCodec.decode(
                JSONObject(encoded).put("schema", 1).toString(),
            )
        }
        listOf(
            "maxLocalSlots",
            "sameAccountMultipleSlots",
            "multiplayerOnline",
            "maxLocalPeerMessageBytes",
            "capabilities",
        ).forEach { field ->
            assertThrows("missing schema-2 field: $field", CatalogParseException::class.java) {
                InstalledReleaseRecordCodec.decode(
                    JSONObject(encoded).apply { remove(field) }.toString(),
                )
            }
        }
    }

    @Test
    fun resolvesStoredPolicyInsteadOfSameDigestCatalogDrift() {
        val fixture = TestPackages.valid()
        val root = temporary.newFolder("stored-policy").toPath()
        val archive = root.resolve("package.zip")
        Files.write(archive, fixture.archive)
        val installer = VerifiedGamePackageInstaller(root)
        installer.install(archive, fixture.release)
        val driftedRelease = fixture.release.copy(
            manifest = fixture.release.manifest.copy(
                budgets = fixture.release.manifest.budgets.copy(
                    maxLocalPeerMessageBytes = 8_192,
                ),
            ),
        )

        val stored = installer.installedRecord(driftedRelease)

        assertEquals(fixture.release.maxLocalPeerMessageBytes, stored?.maxLocalPeerMessageBytes)
        assertEquals(
            fixture.release.maxLocalPeerMessageBytes,
            stored?.toCatalogGame()?.maxLocalPeerMessageBytes,
        )
        assertNull(
            installer.installedRecord(
                fixture.release.copy(contentDigest = "f".repeat(64)),
            ),
        )
    }

    @Test
    fun installsWhenOnlyTheArchivedManifestCarriesTheSchemaAnnotation() {
        val fixture = TestPackages.withManifest(TestPackages.valid()) { manifest ->
            manifest.put("\$schema", "https://yougotserved.dev/schemas/thorium-web-v1.json")
        }
        val root = temporary.newFolder("schema-annotation").toPath()
        val archive = root.resolve("package.zip")
        Files.write(archive, fixture.archive)

        val installed = VerifiedGamePackageInstaller(root).install(archive, fixture.release)

        assertTrue(Files.isDirectory(installed.directory))
    }

    @Test
    fun installedRecordRejectsInvalidDevicePixelRatios() {
        val encoded = InstalledReleaseRecordCodec.encode(
            InstalledReleaseRecordCodec.fromRelease(TestPackages.valid().release),
        )

        listOf<Any>("dense", 0.99, 3.01).forEach { invalid ->
            val record = JSONObject(encoded)
            record.getJSONObject("mainScreen").put("maximumDevicePixelRatio", invalid)

            assertThrows(CatalogParseException::class.java) {
                InstalledReleaseRecordCodec.decode(record.toString())
            }
        }
    }

    @Test
    fun rejectsArchiveHashTamperingWithoutPromotingAnything() {
        val fixture = TestPackages.valid()
        val root = temporary.newFolder("tampered").toPath()
        val archive = root.resolve("package.zip")
        val tampered = fixture.archive.copyOf().also { bytes -> bytes[bytes.lastIndex / 2] = (bytes[bytes.lastIndex / 2].toInt() xor 1).toByte() }
        Files.write(archive, tampered)
        val installer = VerifiedGamePackageInstaller(root)

        assertThrows(PackageInstallException::class.java) { installer.install(archive, fixture.release) }
        assertFalse(Files.exists(GamePackagePaths.releaseDirectory(root, fixture.release)))
    }

    @Test
    fun rejectsTraversalUnexpectedAndDuplicateZipEntries() {
        val fixture = TestPackages.valid()
        val attacks = listOf(
            TestPackages.zip(fixture.entries + ("../escape" to "bad".toByteArray())),
            TestPackages.zip(fixture.entries + ("/absolute" to "bad".toByteArray())),
            TestPackages.zip(fixture.entries + ("bad\\name" to "bad".toByteArray())),
            TestPackages.zip(fixture.entries + ("bad%2fname" to "bad".toByteArray())),
            TestPackages.zip(fixture.entries + ("unexpected.txt" to "bad".toByteArray())),
            TestPackages.replaceAscii(
                TestPackages.zip(fixture.entries + ("evil/index.html" to "duplicate".toByteArray())),
                "evil/index.html",
                "main/index.html",
            ),
        )

        attacks.forEachIndexed { index, bytes ->
            val root = temporary.newFolder("attack-$index").toPath()
            val archive = root.resolve("package.zip")
            Files.write(archive, bytes)
            val release = TestPackages.withArchive(fixture.release, bytes)
            assertThrows(PackageInstallException::class.java) {
                VerifiedGamePackageInstaller(root).install(archive, release)
            }
            assertFalse(Files.exists(root.parent.resolve("escape")))
            assertFalse(Files.exists(GamePackagePaths.releaseDirectory(root, release)))
        }
    }

    @Test
    fun rejectsPerFileTamperingEvenWhenArchiveEnvelopeMatches() {
        val fixture = TestPackages.valid()
        val changedEntries = fixture.entries.map { (name, bytes) ->
            if (name == "dist/game.js") name to "tampered".toByteArray() else name to bytes
        }
        val bytes = TestPackages.zip(changedEntries)
        val release = TestPackages.withArchive(fixture.release, bytes)
        val root = temporary.newFolder("file-tampering").toPath()
        val archive = root.resolve("package.zip")
        Files.write(archive, bytes)

        assertThrows(PackageInstallException::class.java) {
            VerifiedGamePackageInstaller(root).install(archive, release)
        }
        assertFalse(Files.exists(GamePackagePaths.releaseDirectory(root, release)))
    }

    @Test
    fun rejectsNonCanonicalManifestBytesEvenWhenTheJsonStructureIsEquivalent() {
        val fixture = TestPackages.valid()
        val changedEntries = fixture.entries.map { (name, bytes) ->
            if (name == "thorium.json") name to (byteArrayOf(' '.code.toByte()) + bytes) else name to bytes
        }
        val bytes = TestPackages.zip(changedEntries)
        val release = TestPackages.withArchive(fixture.release, bytes)
        val root = temporary.newFolder("manifest-canonical").toPath()
        val archive = root.resolve("package.zip")
        Files.write(archive, bytes)

        assertThrows(PackageInstallException::class.java) {
            VerifiedGamePackageInstaller(root).install(archive, release)
        }
        assertFalse(Files.exists(GamePackagePaths.releaseDirectory(root, release)))
    }

    @Test
    fun incompleteExistingTargetIsRepairedByAValidArchive() {
        val fixture = TestPackages.valid()
        val root = temporary.newFolder("partial").toPath()
        val target = GamePackagePaths.releaseDirectory(root, fixture.release)
        Files.createDirectories(target)
        Files.writeString(target.resolve("main.html"), "partial")
        val archive = root.resolve("package.zip")
        Files.write(archive, fixture.archive)
        val installer = VerifiedGamePackageInstaller(root)

        assertFalse(installer.isInstalled(fixture.release))
        installer.install(archive, fixture.release)
        assertTrue(installer.verifyForLaunch(installer.installedRecords().single().toCatalogGame()))
    }

    @Test
    fun oversizedInstalledSidecarsFailClosedAndCanBeRepaired() {
        val fixture = TestPackages.valid()
        val root = temporary.newFolder("oversized-sidecars").toPath()
        val archive = root.resolve("package.zip")
        Files.write(archive, fixture.archive)
        val installer = VerifiedGamePackageInstaller(root)
        val installed = installer.install(archive, fixture.release)
        val game = installer.installedRecords().single().toCatalogGame()

        Files.write(
            installed.directory.resolve(".thorium-release.json"),
            ByteArray(InstalledReleaseRecordCodec.MAX_ENCODED_BYTES + 1),
        )
        assertFalse(installer.verifyForLaunch(game))
        installer.install(archive, fixture.release)
        assertTrue(installer.verifyForLaunch(game))

        Files.write(installed.directory.resolve(".thorium-verified"), ByteArray(513))
        assertFalse(installer.verifyForLaunch(game))
        installer.install(archive, fixture.release)
        assertTrue(installer.verifyForLaunch(game))
    }

    @Test
    fun rejectsEveryManifestPolicyGroupThatDriftsFromTheCatalogProjection() {
        val mutations = listOf<Pair<String, (JSONObject) -> Unit>>(
            "identity" to { manifest -> manifest.put("version", "0.1.1") },
            "display-name" to { manifest -> manifest.put("displayName", "Changed Game") },
            "summary" to { manifest -> manifest.put("summary", "Changed summary") },
            "description" to { manifest -> manifest.put("description", "Changed description") },
            "runtime-sdk" to { manifest ->
                manifest.getJSONObject("runtime").put("sdkCompatibility", "0.1.0")
            },
            "runtime-entrypoint" to { manifest ->
                manifest.getJSONObject("runtime").getJSONObject("entrypoints")
                    .getJSONObject("main").put("path", "companion/index.html")
            },
            "runtime-files" to { manifest ->
                manifest.getJSONObject("runtime").put(
                    "files",
                    JSONArray()
                        .put("dist/game.js")
                        .put("companion/index.html")
                        .put("main/index.html"),
                )
            },
            "display-surfaces" to { manifest ->
                manifest.getJSONObject("displays").put(
                    "requiredSurfaces",
                    JSONArray().put("companion").put("main"),
                )
            },
            "display-screen" to { manifest ->
                manifest.getJSONObject("displays").getJSONObject("main")
                    .put("logicalWidth", 961)
            },
            "players" to { manifest ->
                manifest.getJSONObject("players").put("minSlots", 1)
            },
            "multiplayer" to { manifest ->
                manifest.getJSONObject("multiplayer").put("online", true)
            },
            "controls" to { manifest ->
                manifest.getJSONArray("controls").getJSONObject(0).put("label", "Changed Tap")
            },
            "capabilities" to { manifest ->
                manifest.put("capabilities", JSONArray().put("colyseus-session"))
            },
            "budgets" to { manifest ->
                manifest.getJSONObject("budgets").put("maxLocalPeerMessageBytes", 4097)
            },
            "unknown-field" to { manifest -> manifest.put("unreviewedPolicy", true) },
        )

        mutations.forEach { (name, mutate) ->
            val fixture = TestPackages.withManifest(TestPackages.valid(), mutate)
            val root = temporary.newFolder("policy-$name").toPath()
            val archive = root.resolve("package.zip")
            Files.write(archive, fixture.archive)

            assertThrows("manifest drift: $name", PackageInstallException::class.java) {
                VerifiedGamePackageInstaller(root).install(archive, fixture.release)
            }
            assertFalse(
                "manifest drift was promoted: $name",
                Files.exists(GamePackagePaths.releaseDirectory(root, fixture.release)),
            )
        }
    }
}
