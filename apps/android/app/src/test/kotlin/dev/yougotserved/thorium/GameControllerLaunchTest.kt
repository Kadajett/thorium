package dev.yougotserved.thorium

import android.content.Intent
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GameControllerLaunchTest {
    @Test
    fun installationAndIntentRoundtripPreserveAuthoredBindingsAndNativeAuthority() {
        val original = TestPackages.valid().release
        val profile = ControllerBindings(bindings = listOf(
            ControllerBinding("button", "east", "cancel"),
            ControllerBinding("axis", "left-x", "steer-x"),
            ControllerBinding("axis-button", "right-trigger", "cancel", 1),
        ))
        val release = original.copy(manifest = original.manifest.copy(
            controls = listOf(ReleaseControl("cancel", "Cancel", "button"), ReleaseControl("steer-x", "Steer", "axis")),
            controllerBindings = profile,
        ))
        val record = InstalledReleaseRecordCodec.decode(InstalledReleaseRecordCodec.encode(InstalledReleaseRecordCodec.fromRelease(release)))
        assertEquals(profile, record.controllerBindings)
        assertNull(record.southButtonBinding)
        val launch = GameLaunch.from(record.toCatalogGame(), "controller-roundtrip")
        val intent = MemoryIntent()
        launch.putInto(intent)
        assertEquals(profile.toJson().toString(), intent.getStringExtra(GameLaunch.CONTROLLER_BINDINGS))
        assertEquals(launch, GameLaunch.from(intent))
        val bootstrap = JSONObject(GameBootstrapMessage.create(launch, SurfaceRole.MAIN, "r1")).getJSONObject("bootstrap")
        assertEquals("native", bootstrap.getString("controllerInput"))
        intent.putExtra(GameLaunch.CONTROLLER_BINDINGS, """{"schema":1,"bindings":[{"kind":"button","input":"east","control":"unknown"}]}""")
        assertNull(GameLaunch.from(intent))
    }

    @Test
    fun legacyLaunchRemainsBrowserAuthorityWithTheExistingSouthBinding() {
        val launch = GameLaunch.from(TestPackages.installedGame(), "legacy-controller")
        val intent = MemoryIntent()
        launch.putInto(intent)
        assertEquals(launch, GameLaunch.from(intent))
        assertNull(launch.controllerBindings)
        val bootstrap = JSONObject(GameBootstrapMessage.create(launch, SurfaceRole.MAIN, "r1")).getJSONObject("bootstrap")
        assertEquals("browser", bootstrap.getString("controllerInput"))
    }

    /** In-memory Android boundary; executes production Intent encoding/decoding, not Android parceling. */
    private class MemoryIntent : Intent() {
        private val values = mutableMapOf<String, Any?>()
        override fun putExtra(name: String, value: String?): Intent = apply { values[name] = value }
        override fun putExtra(name: String, value: Int): Intent = apply { values[name] = value }
        override fun putExtra(name: String, value: Double): Intent = apply { values[name] = value }
        override fun putExtra(name: String, value: Array<String>?): Intent = apply { values[name] = value }
        override fun putExtra(name: String, value: IntArray?): Intent = apply { values[name] = value }
        override fun hasExtra(name: String): Boolean = values.containsKey(name)
        override fun getStringExtra(name: String): String? = values[name] as? String
        override fun getIntExtra(name: String, defaultValue: Int): Int = values[name] as? Int ?: defaultValue
        override fun getDoubleExtra(name: String, defaultValue: Double): Double = values[name] as? Double ?: defaultValue
        @Suppress("UNCHECKED_CAST")
        override fun getStringArrayExtra(name: String): Array<String>? = values[name] as? Array<String>
        override fun getIntArrayExtra(name: String): IntArray? = values[name] as? IntArray
    }
}
