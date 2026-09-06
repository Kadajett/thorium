package dev.yougotserved.thorium

import java.nio.file.Files

internal fun prepareAppUpdate(port: AppUpdatePreparationPort, candidate: AppUpdateCandidate): AppUpdatePrepared {
    requireAppUpdate(appUpdateEligible(port.installed(), candidate.manifest), "Update is not eligible.")
    Files.createDirectories(port.directory)
    val path = Files.createTempFile(port.directory, "verified-", ".apk")
    var verified = false
    return try {
        port.download(candidate.url, path, candidate.manifest.apk)
        verifyAppUpdate(port.installed(), candidate, port.inspect(path))
        verified = true
        AppUpdatePrepared(candidate, path)
    } finally {
        if (!verified) Files.deleteIfExists(path)
    }
}
