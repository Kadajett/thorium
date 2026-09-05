package dev.yougotserved.thorium

import android.app.Activity
import android.app.ActivityManager
import android.app.ActivityOptions
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.display.DisplayManager
import android.os.Build
import android.util.Log
import android.view.Display

object DisplayLauncher {
    private const val TAG = "ThoriumDisplay"

    fun launchCompanion(activity: Activity, launch: GameLaunch): Boolean {
        if (!supportsSecondaryActivities(activity)) return false
        val intent = launch.putInto(
            Intent(activity, CompanionGameActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            includedSessionCapabilities = setOf(SurfaceRole.COMPANION),
        )
        val currentId = activityDisplayId(activity)
        val target = DisplayPolicy.chooseCompanion(currentId, displayProfiles(activity, intent))
            ?: return false
        intent.putExtra(GameLaunch.EXPECTED_DISPLAY_ID, target.id)
        val options = ActivityOptions.makeBasic().setLaunchDisplayId(target.id)
        AndroidHostTrace.lifecycle(activity, "main", "launch-companion target=${target.id}")
        return runCatching { activity.startActivity(intent, options.toBundle()) }
            .onFailure { error -> Log.e(TAG, "Companion launch failed on ${target.id}", error) }
            .isSuccess
    }

    private fun supportsSecondaryActivities(activity: Activity): Boolean =
        activity.packageManager.hasSystemFeature(
            PackageManager.FEATURE_ACTIVITIES_ON_SECONDARY_DISPLAYS,
        )

    private fun displayProfiles(activity: Activity, intent: Intent): List<DisplayProfile> {
        val displayManager = activity.getSystemService(DisplayManager::class.java)
        val activityManager = activity.getSystemService(ActivityManager::class.java)
        return displayManager.displays.map { display ->
            DisplayProfile(
                id = display.displayId,
                width = display.mode.physicalWidth,
                height = display.mode.physicalHeight,
                launchAllowed = activityManager.isActivityStartAllowedOnDisplay(
                    activity,
                    display.displayId,
                    intent,
                ),
            )
        }
    }

    @Suppress("DEPRECATION")
    fun activityDisplayId(activity: Activity): Int = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        activity.display?.displayId ?: Display.DEFAULT_DISPLAY
    } else {
        activity.windowManager.defaultDisplay.displayId
    }
}
