package dev.yougotserved.thorium

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import java.util.UUID

internal fun deviceSaveStore(): ManagedLocalSaveStore =
    createSqliteLocalSaveStore(InstrumentationRegistry.getInstrumentation().targetContext)

internal fun saveTestNamespace(): String = "dev.thorium.save-test.${UUID.randomUUID()}"

internal fun saveWrite(value: String, revision: Long? = null): LocalSaveCommand =
    LocalSaveCommand(LocalSaveOperation.WRITE, "run", revision, value)

internal fun saveRead(): LocalSaveCommand = LocalSaveCommand(LocalSaveOperation.READ, "run")

internal fun assertSaveFailure(code: String, action: () -> Unit) {
    assertEquals(code, assertThrows(LocalSaveException::class.java, action).code)
}

internal fun saveTestLaunch(packageId: String = saveTestNamespace()): GameLaunch = GameLaunch(
    packageId = packageId,
    version = "0.1.3",
    sessionId = UUID.randomUUID().toString(),
    mainEntrypoint = "main.html",
    companionEntrypoint = "companion.html",
    runtimeFiles = setOf("main.html", "companion.html"),
    logicalWidth = 960,
    logicalHeight = 540,
    maximumDevicePixelRatio = 2.0,
    companionLogicalWidth = 620,
    companionLogicalHeight = 540,
    companionMaximumDevicePixelRatio = 2.0,
    controls = listOf(ReleaseControl("confirm", "Confirm", "button")),
    southButtonBinding = null,
    maxLocalSlots = 1,
    localPlayerSlots = setOf(0),
    maxLocalPeerMessageBytes = 16384,
    contentDigest = "a".repeat(64),
    capabilities = setOf(LocalSaveLimits.CAPABILITY),
    controlledPlayerSlots = mapOf(SurfaceRole.MAIN to emptySet(), SurfaceRole.COMPANION to setOf(0)),
)
