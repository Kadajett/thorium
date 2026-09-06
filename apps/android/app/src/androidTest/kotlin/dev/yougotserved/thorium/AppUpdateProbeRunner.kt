package dev.yougotserved.thorium

import android.app.Application
import android.content.Context
import androidx.test.runner.AndroidJUnitRunner

class AppUpdateProbeRunner : AndroidJUnitRunner() {
    override fun newApplication(loader: ClassLoader, name: String, context: Context): Application =
        super.newApplication(loader, AppUpdateProbeApplication::class.java.name, context)
}
