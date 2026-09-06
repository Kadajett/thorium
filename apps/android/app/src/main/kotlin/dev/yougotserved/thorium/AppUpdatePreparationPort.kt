package dev.yougotserved.thorium

import java.nio.file.Path

internal data class AppUpdatePreparationPort(
    val installed: () -> AppUpdateInstalled,
    val inspect: (Path) -> AppUpdateArchive,
    val download: (String, Path, AppUpdateApk) -> Unit,
    val directory: Path,
)
