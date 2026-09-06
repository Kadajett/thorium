package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdatePolicyTest {
    @Test fun onlyStrictlyNewerCompatiblePublicReleaseIsEligible() {
        val installed = updateInstalled()
        assertTrue(appUpdateEligible(installed, updateCandidate().manifest))
        assertFalse(appUpdateEligible(installed, updateCandidate(9).manifest))
        assertFalse(appUpdateEligible(installed, updateCandidate(8).manifest))
        assertFalse(appUpdateEligible(installed.copy(sdk = 28), updateCandidate().manifest))
        val privateVersion = installed.version.copy(packageId = "dev.yougotserved.thorium.rewrite")
        val privateApp = installed.copy(version = privateVersion)
        assertFalse(appUpdateEligible(privateApp, updateCandidate().manifest))
        val selected = selectAppUpdate(installed, listOf(updateCandidate(10), updateCandidate(12)))
        assertEquals(12L, selected?.manifest?.version?.versionCode)
    }

    @Test fun actualApkMustMatchAllMetadataAndCurrentSigner() {
        val candidate = updateCandidate()
        val archive = updateArchive()
        verifyAppUpdate(updateInstalled(), candidate, archive)
        rejects(archive.copy(signerDigests = setOf("other-signer")))
        rejects(archive.copy(signerDigests = emptySet()))
        rejects(archive.copy(minSdk = 30))
        rejects(archive.copy(version = archive.version.copy(versionCode = 11)))
        rejects(archive.copy(version = archive.version.copy(versionName = "different")))
        rejects(archive.copy(version = archive.version.copy(packageId = "foreign.package")))
    }

    @Test fun currentVersionRecheckedBeforeInstallAndEmptyInstalledSignerRejected() {
        val candidate = updateCandidate()
        val installed = updateInstalled().copy(version = candidate.manifest.version)
        assertThrows(AppUpdateException::class.java) { verifyAppUpdate(installed, candidate, updateArchive()) }
        assertThrows(AppUpdateException::class.java) {
            verifyAppUpdate(updateInstalled().copy(signerDigests = emptySet()), candidate, updateArchive())
        }
    }

    @Test fun checksAreThrottledButClockRollbackRecovers() {
        assertTrue(appUpdateCheckDue(100, 0))
        assertFalse(appUpdateCheckDue(101, 100))
        assertTrue(appUpdateCheckDue(100 + AppUpdateLimits.CHECK_INTERVAL_MS, 100))
        assertTrue(appUpdateCheckDue(99, 100))
    }

    private fun rejects(archive: AppUpdateArchive) {
        assertThrows(AppUpdateException::class.java) { verifyAppUpdate(updateInstalled(), updateCandidate(), archive) }
    }
}
