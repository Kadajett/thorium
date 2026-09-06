package dev.yougotserved.thorium

import org.junit.Assert.assertThrows
import org.junit.Test

class LocalSaveJsonTest {
    @Test
    fun acceptsStrictJsonIncludingEscapesScalarsAndNestedValues() {
        listOf(
            "null", "true", "false", "-2.3e+4", "\"火\"", "[]", "{}",
            " {\"run\":[1,null,true,{\"text\":\"\\n\\u706b\"}]} \n",
        ).forEach(LocalSaveJson::requireValid)
    }

    @Test
    fun rejectsLenientParserExtensionsAndNonFiniteNumbers() {
        listOf(
            "", "undefined", "NaN", "Infinity", "1e999", "01", "+1", "1.",
            "[1,]", "{\"x\":1,}", "{'x':1}", "{x:1}", "/*x*/0", "true false",
            "\"\\x00\"", "\"\\uXY00\"", "\"unterminated", "\"\u0001\"",
        ).forEach { value ->
            assertThrows(value, LocalSaveException::class.java) { LocalSaveJson.requireValid(value) }
        }
    }

    @Test
    fun acceptsDepthLimitAndRejectsAdditionalNesting() {
        LocalSaveJson.requireValid("[".repeat(32) + "0" + "]".repeat(32))
        assertThrows(LocalSaveException::class.java) {
            LocalSaveJson.requireValid("[".repeat(33) + "0" + "]".repeat(33))
        }
    }
}
