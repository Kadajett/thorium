package dev.yougotserved.thorium

data class DisplayProfile(
    val id: Int,
    val width: Int,
    val height: Int,
    val launchAllowed: Boolean,
)

object DisplayPolicy {
    fun chooseCompanion(
        currentDisplayId: Int,
        displays: List<DisplayProfile>,
    ): DisplayProfile? = displays.asSequence()
        .filter { display ->
            display.id != currentDisplayId && display.launchAllowed &&
                display.width > 0 && display.height > 0
        }
        .minWithOrNull(
            compareBy<DisplayProfile> { display -> display.width.toLong() * display.height }
                .thenBy { display -> display.id },
        )
}
