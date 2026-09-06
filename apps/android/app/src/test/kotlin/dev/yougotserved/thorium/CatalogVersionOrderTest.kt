package dev.yougotserved.thorium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogVersionOrderTest {
    @Test
    fun comparesEveryNumericComponentNumericallyWithoutIntegerOverflow() {
        val pairs = listOf(
            "1.9.0" to "1.10.0", "1.0.9" to "1.0.10", "9.0.0" to "10.0.0",
            "9223372036854775807.0.0" to "9223372036854775808.0.0",
        )
        pairs.forEach { (older, newer) ->
            assertTrue(compareCatalogVersions(older, newer) < 0)
            assertTrue(compareCatalogVersions(newer, older) > 0)
        }
    }

    @Test
    fun followsSemverPrereleasePrecedenceAndNumericIdentifiers() {
        val versions = listOf(
            "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta",
            "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0",
        )
        versions.zipWithNext().forEach { (older, newer) ->
            assertTrue(compareCatalogVersions(older, newer) < 0)
        }
        assertTrue(compareCatalogVersions("1.0.0-dev.9", "1.0.0-dev.10") < 0)
    }

    @Test
    fun stableReleasesBeatTheirOwnPrereleaseButNotANewerVersionFamily() {
        assertTrue(compareCatalogVersions("1.0.0-rc.999", "1.0.0") < 0)
        assertTrue(compareCatalogVersions("1.0.0", "1.1.0-alpha") < 0)
    }

    @Test
    fun buildMetadataDoesNotAffectPrecedence() {
        assertEquals(0, compareCatalogVersions("1.0.0+001", "1.0.0+999"))
        assertEquals(0, compareCatalogVersions("1.0.0-beta+first", "1.0.0-beta+second"))
    }

    @Test
    fun legacyUnparseableVersionsCannotOutrankAValidRelease() {
        assertTrue(compareCatalogVersions("not-a-version", "1.0.0") < 0)
        assertTrue(compareCatalogVersions("1.0.0", "not-a-version") > 0)
        assertEquals(0, compareCatalogVersions("unknown", "unknown"))
    }
}
