package dev.yougotserved.thorium

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.ZipInputStream
import org.json.JSONObject

data class InstalledGamePackage(
    val packageId: String,
    val version: String,
    val contentDigest: String,
    val directory: Path,
)

class PackageInstallException(message: String, cause: Throwable? = null) :
    Exception(message, cause)

object GamePackagePaths {
    fun relativeRelease(packageId: String, version: String, contentDigest: String): String =
        "releases/$packageId/$version/$contentDigest"

    fun relativeRelease(release: GameRelease): String =
        relativeRelease(release.packageId, release.version, release.contentDigest)

    fun releaseDirectory(storageRoot: Path, release: GameRelease): Path =
        storageRoot.resolve(relativeRelease(release)).normalize()

    fun relativeRelease(record: InstalledReleaseRecord): String =
        relativeRelease(record.packageId, record.version, record.contentDigest)

    fun releaseDirectory(
        storageRoot: Path,
        packageId: String,
        version: String,
        contentDigest: String,
    ): Path = storageRoot.resolve(relativeRelease(packageId, version, contentDigest)).normalize()
}

object AtomicDirectoryPromoter {
    fun promote(staged: Path, target: Path): Boolean {
        Files.createDirectories(target.parent)
        return try {
            Files.move(staged, target, StandardCopyOption.ATOMIC_MOVE)
            true
        } catch (_: FileAlreadyExistsException) {
            deleteTree(staged)
            false
        } catch (error: AtomicMoveNotSupportedException) {
            throw PackageInstallException("Internal storage does not support atomic package promotion", error)
        }
    }

    fun deleteTree(root: Path) {
        if (!Files.exists(root)) return
        Files.walk(root).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach(Files::deleteIfExists)
        }
    }
}

class VerifiedGamePackageInstaller(private val storageRoot: Path) {
    fun isInstalled(release: GameRelease): Boolean =
        installedRecord(release) != null

    fun installedRecord(release: GameRelease): InstalledReleaseRecord? = runCatching {
        val target = GamePackagePaths.releaseDirectory(storageRoot, release)
        val record = readInstalledRecord(target) ?: return@runCatching null
        record.takeIf {
            record.packageId == release.packageId &&
                record.version == release.version &&
                record.contentDigest == release.contentDigest &&
                isComplete(target, record)
        }
    }.getOrNull()

    /** Re-hash app-private runtime bytes immediately before creating a launch/session capability. */
    fun verifyForLaunch(game: CatalogGame): Boolean {
        val contentDigest = game.contentDigest
        if (
            !GameLaunchPolicy.isValidPackageId(game.packageId) ||
            !GameLaunchPolicy.isValidVersion(game.version) ||
            !GameLaunchPolicy.isValidDigest(contentDigest)
        ) return false
        val target = GamePackagePaths.releaseDirectory(
            storageRoot,
            game.packageId,
            game.version,
            contentDigest,
        )
        return runCatching {
            val record = readInstalledRecord(target) ?: return@runCatching false
            isComplete(target, record) &&
                record.toCatalogGame() == game.copy(release = null) &&
                verifyInstalledBytes(target, record)
        }.getOrDefault(false)
    }

    fun installedRecords(): List<InstalledReleaseRecord> {
        val releases = storageRoot.resolve("releases")
        if (!Files.isDirectory(releases)) return emptyList()
        val records = mutableListOf<InstalledReleaseRecord>()
        Files.walk(releases).use { paths ->
            paths.filter { path -> path.fileName.toString() == RELEASE_RECORD }
                .forEach { path ->
                    val record = runCatching {
                        val candidate = readInstalledRecord(path.parent) ?: return@runCatching null
                        if (isComplete(path.parent, candidate)) candidate else null
                    }.getOrNull()
                    if (record != null) records += record
                }
        }
        return records
    }

    @Synchronized
    fun install(archive: Path, release: GameRelease): InstalledGamePackage {
        verifyArchiveEnvelope(archive, release.bundle)
        val target = GamePackagePaths.releaseDirectory(storageRoot, release)
        val quarantined = if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            val existing = installedRecord(release)
            if (existing != null && verifyForLaunch(existing.toCatalogGame())) {
                return installed(release, target)
            }
            quarantine(target)
        } else {
            null
        }

        val stagingParent = storageRoot.resolve(".staging")
        Files.createDirectories(stagingParent)
        val staged = stagingParent.resolve(UUID.randomUUID().toString())
        Files.createDirectory(staged)
        try {
            extractAndVerify(archive, staged, release)
            Files.write(
                staged.resolve(RELEASE_RECORD),
                InstalledReleaseRecordCodec.encode(InstalledReleaseRecordCodec.fromRelease(release))
                    .toByteArray(Charsets.UTF_8),
                StandardOpenOption.CREATE_NEW,
            )
            Files.write(
                staged.resolve(COMPLETION_MARKER),
                completionMarker(release).toByteArray(Charsets.UTF_8),
                StandardOpenOption.CREATE_NEW,
            )
            AtomicDirectoryPromoter.promote(staged, target)
            val record = installedRecord(release)
            if (record == null || !verifyForLaunch(record.toCatalogGame())) {
                throw PackageInstallException("Package promotion failed integrity verification")
            }
            quarantined?.let { previous ->
                runCatching { AtomicDirectoryPromoter.deleteTree(previous) }
            }
            return installed(release, target)
        } catch (error: Exception) {
            AtomicDirectoryPromoter.deleteTree(staged)
            if (error is PackageInstallException) throw error
            throw PackageInstallException("Package installation failed", error)
        }
    }

    private fun verifyArchiveEnvelope(archive: Path, bundle: PackageBundleDescriptor) {
        val size = Files.size(archive)
        if (size != bundle.sizeBytes || size > CatalogJsonParser.MAX_ARCHIVE_BYTES) {
            throw PackageInstallException("Archive size does not match the catalog")
        }
        if (sha256(archive) != bundle.sha256) {
            throw PackageInstallException("Archive SHA-256 does not match the catalog")
        }
    }

    private fun extractAndVerify(archive: Path, staged: Path, release: GameRelease) {
        val expected = release.bundle.files.associateBy { it.path }
        val expectedNames = expected.keys + MANIFEST_NAME
        val seen = mutableSetOf<String>()
        var totalBytes = 0L
        var manifestBytes: ByteArray? = null
        ZipInputStream(BufferedInputStream(Files.newInputStream(archive))).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val name = runCatching { CatalogJsonParser.safePath(entry.name, "ZIP entry") }
                    .getOrElse { throw PackageInstallException("ZIP contains an unsafe entry") }
                if (entry.isDirectory || name !in expectedNames) {
                    throw PackageInstallException("ZIP contains an unexpected entry: $name")
                }
                if (!seen.add(name)) throw PackageInstallException("ZIP contains a duplicate entry: $name")
                if (seen.size > release.maxFileCount || seen.size > CatalogJsonParser.MAX_FILE_COUNT) {
                    throw PackageInstallException("ZIP contains too many entries")
                }
                val limit = expected[name]?.size ?: MAX_MANIFEST_BYTES
                if (entry.size > limit) throw PackageInstallException("ZIP entry exceeds its declared size: $name")
                val destination = staged.resolve(name).normalize()
                if (!destination.startsWith(staged)) throw PackageInstallException("ZIP entry escapes staging")
                Files.createDirectories(destination.parent)
                val digest = MessageDigest.getInstance("SHA-256")
                var written = 0L
                BufferedOutputStream(
                    Files.newOutputStream(destination, StandardOpenOption.CREATE_NEW),
                ).use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val count = zip.read(buffer)
                        if (count < 0) break
                        written += count
                        totalBytes += count
                        if (written > limit || totalBytes > release.maxPackageBytes) {
                            throw PackageInstallException("ZIP expands beyond its declared budget")
                        }
                        output.write(buffer, 0, count)
                        digest.update(buffer, 0, count)
                    }
                }
                if (!Files.isRegularFile(destination, java.nio.file.LinkOption.NOFOLLOW_LINKS)) {
                    throw PackageInstallException("ZIP entry did not materialize as a regular file")
                }
                val file = expected[name]
                if (file != null) {
                    if (written != file.size || digest.hex() != file.sha256) {
                        throw PackageInstallException("Installed file does not match its descriptor: $name")
                    }
                } else {
                    manifestBytes = Files.readAllBytes(destination)
                }
                zip.closeEntry()
            }
        }
        if (seen != expectedNames) throw PackageInstallException("ZIP is missing declared entries")
        verifyManifest(manifestBytes ?: throw PackageInstallException("ZIP is missing thorium.json"), release)
    }

    private fun verifyManifest(bytes: ByteArray, release: GameRelease) {
        if (bytes.size > MAX_MANIFEST_BYTES) throw PackageInstallException("thorium.json is too large")
        val text = try {
            StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString()
        } catch (error: Exception) {
            throw PackageInstallException("thorium.json is not valid UTF-8", error)
        }
        if (sha256(bytes) != release.bundle.manifestSha256) {
            throw PackageInstallException("Archived canonical thorium.json does not match the catalog")
        }
        val manifest = try {
            JSONObject(text)
        } catch (error: Exception) {
            throw PackageInstallException("thorium.json is not valid JSON", error)
        }
        val projection = try {
            GameManifestProjectionParser.parseManifest(manifest)
        } catch (error: CatalogParseException) {
            throw PackageInstallException("thorium.json does not satisfy the supported manifest schema", error)
        }
        if (projection != release.manifest) {
            throw PackageInstallException("thorium.json policy does not exactly match the catalog projection")
        }
    }

    private fun installed(release: GameRelease, target: Path) = InstalledGamePackage(
        packageId = release.packageId,
        version = release.version,
        contentDigest = release.contentDigest,
        directory = target,
    )

    private fun isComplete(target: Path, record: InstalledReleaseRecord): Boolean = runCatching {
        Files.isDirectory(target, LinkOption.NOFOLLOW_LINKS) &&
            isLinkFree(target) &&
            isTrustedRegularFile(target.resolve(COMPLETION_MARKER)) &&
            Files.size(target.resolve(COMPLETION_MARKER)) <= MAX_COMPLETION_MARKER_BYTES &&
            readUtf8(target.resolve(COMPLETION_MARKER)) == completionMarker(record) &&
            GamePackagePaths.relativeRelease(record) == storageRoot.relativize(target).toString()
                .replace(java.io.File.separatorChar, '/')
    }.getOrDefault(false)

    private fun readInstalledRecord(target: Path): InstalledReleaseRecord? {
        val path = target.resolve(RELEASE_RECORD)
        if (
            !isTrustedRegularFile(path) ||
            Files.size(path) > InstalledReleaseRecordCodec.MAX_ENCODED_BYTES
        ) return null
        return InstalledReleaseRecordCodec.decode(readUtf8(path))
    }

    private fun quarantine(target: Path): Path {
        val releasesRoot = storageRoot.resolve("releases").normalize()
        if (!target.normalize().startsWith(releasesRoot)) {
            throw PackageInstallException("Invalid package repair target")
        }
        val quarantineRoot = storageRoot.resolve(".quarantine")
        Files.createDirectories(quarantineRoot)
        val destination = quarantineRoot.resolve(UUID.randomUUID().toString())
        try {
            return Files.move(target, destination, StandardCopyOption.ATOMIC_MOVE)
        } catch (error: AtomicMoveNotSupportedException) {
            throw PackageInstallException("Internal storage does not support atomic package repair", error)
        }
    }

    private fun verifyInstalledBytes(target: Path, record: InstalledReleaseRecord): Boolean {
        val integrity = record.integrity ?: return false
        if (integrity.files.map { it.path }.toSet() != record.runtimeFiles) return false
        val manifest = target.resolve(MANIFEST_NAME).normalize()
        if (
            !isTrustedRegularFile(manifest) || Files.size(manifest) > MAX_MANIFEST_BYTES ||
            sha256(manifest) != integrity.manifestSha256
        ) return false
        val verifiedManifest = GameManifestProjectionParser.parseManifest(JSONObject(readUtf8(manifest)))
        if (verifiedManifest.controllerBindings != record.controllerBindings) return false
        return integrity.files.all { expected ->
            val path = target.resolve(expected.path).normalize()
            path.startsWith(target) && isTrustedRegularFile(path) &&
                Files.size(path) == expected.size && sha256(path) == expected.sha256
        }
    }

    private fun isTrustedRegularFile(path: Path): Boolean =
        isLinkFree(path) && Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)

    private fun isLinkFree(path: Path): Boolean {
        val root = storageRoot.normalize()
        val candidate = path.normalize()
        if (!candidate.startsWith(root)) return false
        var current = root
        if (Files.isSymbolicLink(current)) return false
        for (part in root.relativize(candidate)) {
            current = current.resolve(part)
            if (Files.isSymbolicLink(current)) return false
        }
        return true
    }

    private fun completionMarker(release: GameRelease): String =
        "${release.packageId}\n${release.version}\n${release.contentDigest}\n"

    private fun completionMarker(record: InstalledReleaseRecord): String =
        "${record.packageId}\n${record.version}\n${record.contentDigest}\n"

    private fun readUtf8(path: Path): String = String(Files.readAllBytes(path), Charsets.UTF_8)

    private fun sha256(path: Path): String {
        val digest = MessageDigest.getInstance("SHA-256")
        Files.newInputStream(path).use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.hex()
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).hex()

    private fun MessageDigest.hex(): String = digest().hex()

    private fun ByteArray.hex(): String = joinToString("") { byte -> "%02x".format(byte) }

    companion object {
        private const val MANIFEST_NAME = "thorium.json"
        private const val COMPLETION_MARKER = ".thorium-verified"
        private const val RELEASE_RECORD = ".thorium-release.json"
        private const val MAX_MANIFEST_BYTES = 64L * 1024
        private const val MAX_COMPLETION_MARKER_BYTES = 512L
    }
}
