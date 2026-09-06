package dev.yougotserved.thorium

import java.nio.file.Path

internal data class AppUpdateHttpPort(
    val read: (String, Int) -> ByteArray,
    val download: (String, Path, AppUpdateApk) -> Unit,
)
