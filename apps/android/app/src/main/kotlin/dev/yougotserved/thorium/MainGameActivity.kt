package dev.yougotserved.thorium

import android.content.Intent
import android.widget.Toast

class MainGameActivity : GameSurfaceActivity() {
    override val surfaceRole = SurfaceRole.MAIN
    private var companionSessionId: String? = null

    override fun onNewIntent(intent: Intent) {
        companionSessionId = null
        super.onNewIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        val launch = gameLaunch ?: return
        if (!RequiredDualSurfacePolicy.requiresCompanionLaunch(companionSessionId, launch.sessionId)) {
            return
        }
        val resolution = RequiredDualSurfacePolicy.resolveCompanionLaunch(
            sessionId = launch.sessionId,
            launched = DisplayLauncher.launchCompanion(this, launch),
        )
        companionSessionId = resolution.companionSessionId
        if (!resolution.mayContinue) {
            Toast.makeText(this, R.string.companion_unavailable, Toast.LENGTH_LONG).show()
            finish()
            return
        }
    }
}
