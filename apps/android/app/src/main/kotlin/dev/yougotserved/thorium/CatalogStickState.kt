package dev.yougotserved.thorium

import kotlin.math.abs

internal const val CATALOG_STICK_ACTIVATION = 0.62f
internal const val CATALOG_STICK_RELEASE = 0.34f
internal const val CATALOG_STICK_INITIAL_REPEAT_MILLIS = 360L
internal const val CATALOG_STICK_REPEAT_MILLIS = 120L

data class CatalogStickPolicy(
    val activationThreshold: Float = CATALOG_STICK_ACTIVATION,
    val releaseThreshold: Float = CATALOG_STICK_RELEASE,
    val initialRepeatDelayMillis: Long = CATALOG_STICK_INITIAL_REPEAT_MILLIS,
    val repeatIntervalMillis: Long = CATALOG_STICK_REPEAT_MILLIS,
) {
    init {
        require(activationThreshold in 0f..1f)
        require(releaseThreshold in 0f..activationThreshold)
        require(initialRepeatDelayMillis >= 0)
        require(repeatIntervalMillis > 0)
    }
}

data class CatalogStickSample(val horizontal: Float, val vertical: Float, val timeMillis: Long) {
    init {
        require(horizontal.isFinite())
        require(vertical.isFinite())
        require(timeMillis >= 0)
    }
}

data class CatalogStickState(
    val activeDirection: CatalogControllerCommand? = null,
    val nextRepeatAtMillis: Long = 0,
)

data class CatalogStickTransition(
    val state: CatalogStickState,
    val command: CatalogControllerCommand? = null,
)

fun reduceCatalogStick(
    state: CatalogStickState,
    sample: CatalogStickSample,
    policy: CatalogStickPolicy = CatalogStickPolicy(),
): CatalogStickTransition {
    val magnitude = maxOf(abs(sample.horizontal), abs(sample.vertical))
    return when {
        magnitude <= policy.releaseThreshold -> CatalogStickTransition(CatalogStickState())
        magnitude < policy.activationThreshold -> CatalogStickTransition(state)
        else -> deflectCatalogStick(state, sample, policy)
    }
}

private fun deflectCatalogStick(
    state: CatalogStickState,
    sample: CatalogStickSample,
    policy: CatalogStickPolicy,
): CatalogStickTransition {
    val direction = catalogStickDirection(sample)
    return when {
        direction != state.activeDirection -> CatalogStickTransition(
            CatalogStickState(direction, sample.timeMillis + policy.initialRepeatDelayMillis), direction,
        )
        sample.timeMillis < state.nextRepeatAtMillis -> CatalogStickTransition(state)
        else -> CatalogStickTransition(
            CatalogStickState(direction, sample.timeMillis + policy.repeatIntervalMillis), direction,
        )
    }
}

private fun catalogStickDirection(sample: CatalogStickSample): CatalogControllerCommand = when {
    abs(sample.horizontal) > abs(sample.vertical) -> horizontalStickDirection(sample.horizontal)
    sample.vertical < 0 -> CatalogControllerCommand.MOVE_UP
    else -> CatalogControllerCommand.MOVE_DOWN
}

private fun horizontalStickDirection(horizontal: Float): CatalogControllerCommand =
    if (horizontal < 0) CatalogControllerCommand.MOVE_LEFT else CatalogControllerCommand.MOVE_RIGHT
