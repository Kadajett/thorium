package dev.yougotserved.thorium

private const val VERSION_CORE_PARTS = 3
private val CATALOG_VERSION = Regex("^([0-9]+)\\.([0-9]+)\\.([0-9]+)(?:-([0-9A-Za-z.-]+))?(?:\\+[0-9A-Za-z.-]+)?$")

private data class CatalogVersion(val core: List<String>, val prerelease: List<String>)

/** SemVer precedence, with arbitrary-size numeric fields and no build-metadata ordering. */
internal fun compareCatalogVersions(left: String, right: String): Int {
    val parsedLeft = parseCatalogVersion(left)
    val parsedRight = parseCatalogVersion(right)
    return when {
        parsedLeft == null && parsedRight == null -> left.compareTo(right)
        parsedLeft == null -> -1
        parsedRight == null -> 1
        else -> compareCatalogVersions(parsedLeft, parsedRight)
    }
}

private fun parseCatalogVersion(value: String): CatalogVersion? {
    val match = CATALOG_VERSION.matchEntire(value) ?: return null
    val prerelease = match.groupValues[VERSION_CORE_PARTS + 1]
    return CatalogVersion(
        match.groupValues.drop(1).take(VERSION_CORE_PARTS),
        if (prerelease.isEmpty()) emptyList() else prerelease.split('.'),
    )
}

private fun compareCatalogVersions(left: CatalogVersion, right: CatalogVersion): Int {
    val core = compareVersionParts(left.core, right.core, ::compareNumericIdentifier)
    return if (core != 0) core else comparePrerelease(left.prerelease, right.prerelease)
}

private fun comparePrerelease(left: List<String>, right: List<String>): Int = when {
    left.isEmpty() && right.isEmpty() -> 0
    left.isEmpty() -> 1
    right.isEmpty() -> -1
    else -> compareVersionParts(left, right, ::comparePrereleaseIdentifier)
}

private fun compareVersionParts(
    left: List<String>,
    right: List<String>,
    compare: (String, String) -> Int,
): Int = left.zip(right).asSequence()
    .map { (a, b) -> compare(a, b) }
    .firstOrNull { it != 0 }
    ?: left.size.compareTo(right.size)

private fun compareNumericIdentifier(left: String, right: String): Int {
    val a = left.trimStart('0').ifEmpty { "0" }
    val b = right.trimStart('0').ifEmpty { "0" }
    val length = a.length.compareTo(b.length)
    return if (length != 0) length else a.compareTo(b)
}

private fun comparePrereleaseIdentifier(left: String, right: String): Int {
    val aNumeric = left.isNotEmpty() && left.all { it in '0'..'9' }
    val bNumeric = right.isNotEmpty() && right.all { it in '0'..'9' }
    return when {
        aNumeric && bNumeric -> compareNumericIdentifier(left, right)
        aNumeric -> -1
        bNumeric -> 1
        else -> left.compareTo(right)
    }
}
