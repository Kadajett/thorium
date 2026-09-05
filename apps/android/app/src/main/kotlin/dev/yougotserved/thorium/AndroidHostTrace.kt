package dev.yougotserved.thorium

import android.app.Activity
import android.util.Log
import android.view.KeyEvent
import android.view.MotionEvent

/** Device diagnostics deliberately omit URLs, intents, capabilities, and game messages. */
internal object AndroidHostTrace {
    fun lifecycle(activity: Activity, role: String, event: String) {
        if (!BuildConfig.DEBUG) return
        Log.i("ThoriumLifecycle", "role=$role event=$event " +
            "display=${DisplayLauncher.activityDisplayId(activity)} task=${activity.taskId}")
    }

    fun key(activity: Activity, role: String, event: KeyEvent) {
        if (!BuildConfig.DEBUG) return
        Log.i("ThoriumInput", "role=$role key=${event.keyCode} action=${event.action} " +
            "source=${event.source} display=${DisplayLauncher.activityDisplayId(activity)}")
    }

    fun motion(activity: Activity, role: String, event: MotionEvent) {
        if (!BuildConfig.DEBUG) return
        Log.i("ThoriumInput", "role=$role motion=${event.action} source=${event.source} " +
            "display=${DisplayLauncher.activityDisplayId(activity)}")
    }
}
