package dev.yougotserved.thorium

import android.content.Intent
import android.util.Log

class CompanionGameActivity : GameSurfaceActivity() {
    override val surfaceRole = SurfaceRole.COMPANION

    override fun isLaunchPlacementValid(intent: Intent): Boolean {
        val expected = intent.getIntExtra(GameLaunch.EXPECTED_DISPLAY_ID, -1)
        val actual = DisplayLauncher.activityDisplayId(this)
        Log.i("ThoriumDisplay", "Companion expected=$expected actual=$actual")
        return expected >= 0 && expected == actual
    }
}
