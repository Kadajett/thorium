package dev.yougotserved.thorium

internal enum class AppUpdateStage { HIDDEN, AVAILABLE, DOWNLOADING, READY, PERMISSION, INSTALLING, FAILED }

internal data class AppUpdateState(
    val stage: AppUpdateStage = AppUpdateStage.HIDDEN,
    val candidate: AppUpdateCandidate? = null,
    val prepared: AppUpdatePrepared? = null,
    val selected: Int = 1,
)

internal fun appUpdateMove(state: AppUpdateState, command: CatalogControllerCommand): AppUpdateState {
    if (appUpdateButton(state.stage) == null) return state.copy(selected = 1)
    val directions = setOf(
        CatalogControllerCommand.MOVE_UP, CatalogControllerCommand.MOVE_DOWN,
        CatalogControllerCommand.MOVE_LEFT, CatalogControllerCommand.MOVE_RIGHT,
    )
    return if (command in directions) state.copy(selected = 1 - state.selected) else state
}

internal fun appUpdateHeading(stage: AppUpdateStage): String = when (stage) {
    AppUpdateStage.AVAILABLE -> "Thorium update available"
    AppUpdateStage.DOWNLOADING -> "Downloading and verifying update"
    AppUpdateStage.READY -> "Update verified"
    AppUpdateStage.PERMISSION -> "Allow Android to install this update"
    AppUpdateStage.INSTALLING -> "Continue in Android’s installer"
    AppUpdateStage.FAILED -> "Update could not be completed"
    AppUpdateStage.HIDDEN -> ""
}

internal fun appUpdateButton(stage: AppUpdateStage): String? = when (stage) {
    AppUpdateStage.AVAILABLE -> "Download update"
    AppUpdateStage.READY -> "Install update"
    AppUpdateStage.PERMISSION -> "Open Android settings"
    else -> null
}

internal fun appUpdateDescription(state: AppUpdateState): String = when (state.stage) {
    AppUpdateStage.AVAILABLE -> "Version ${state.candidate?.manifest?.version?.versionName}. " +
        "Download from GitHub? Your games and saves stay on this device."
    AppUpdateStage.DOWNLOADING -> "Checking the download, package identity, version and signing certificate."
    AppUpdateStage.READY -> "Android will ask you to confirm installation. Nothing installs silently."
    AppUpdateStage.PERMISSION -> "Android requires your permission for Thorium to request installation. " +
        "Return here afterwards and choose Install update."
    AppUpdateStage.INSTALLING -> "You can accept or cancel the update in Android."
    AppUpdateStage.FAILED -> "No update was installed by Thorium. You can continue playing and try again later."
    AppUpdateStage.HIDDEN -> ""
}
