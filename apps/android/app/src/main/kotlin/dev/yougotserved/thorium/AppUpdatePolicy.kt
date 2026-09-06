package dev.yougotserved.thorium

internal fun appUpdateEligible(installed: AppUpdateInstalled, manifest: AppUpdateManifest): Boolean =
    installed.version.packageId == AppUpdateLimits.PACKAGE_ID &&
        manifest.version.packageId == installed.version.packageId &&
        manifest.version.versionCode > installed.version.versionCode && manifest.minSdk <= installed.sdk

internal fun selectAppUpdate(
    installed: AppUpdateInstalled,
    candidates: List<AppUpdateCandidate>,
): AppUpdateCandidate? = candidates.filter { appUpdateEligible(installed, it.manifest) }
    .maxWithOrNull(compareBy<AppUpdateCandidate> { it.manifest.version.versionCode }.thenBy { it.tag })

internal fun verifyAppUpdate(
    installed: AppUpdateInstalled,
    candidate: AppUpdateCandidate,
    archive: AppUpdateArchive,
) {
    requireAppUpdate(appUpdateEligible(installed, candidate.manifest), "This update is not for this installed app.")
    requireAppUpdate(archive.version == candidate.manifest.version, "The APK identity does not match its release.")
    requireAppUpdate(archive.minSdk == candidate.manifest.minSdk, "The APK Android requirement does not match.")
    requireAppUpdate(installed.signerDigests.isNotEmpty(), "The installed signing certificate is unavailable.")
    requireAppUpdate(archive.signerDigests == installed.signerDigests, "The APK was signed by a different developer.")
}

internal fun appUpdateCheckDue(now: Long, lastCheck: Long): Boolean =
    lastCheck <= 0 || now < lastCheck || now - lastCheck >= AppUpdateLimits.CHECK_INTERVAL_MS
