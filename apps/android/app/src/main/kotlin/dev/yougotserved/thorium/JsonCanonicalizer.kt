package dev.yougotserved.thorium

import org.json.JSONArray
import org.json.JSONObject

object JsonCanonicalizer {
    fun canonicalize(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> {
            val keys = buildList {
                val iterator = value.keys()
                while (iterator.hasNext()) add(iterator.next())
            }.sorted()
            keys.joinToString(separator = ",", prefix = "{", postfix = "}") { key ->
                "${quote(key)}:${canonicalize(value.get(key))}"
            }
        }
        is JSONArray -> (0 until value.length()).joinToString(separator = ",", prefix = "[", postfix = "]") {
            index -> canonicalize(value.get(index))
        }
        is String -> quote(value)
        is Number -> JSONObject.numberToString(value)
        is Boolean -> value.toString()
        else -> throw CatalogParseException("Unsupported JSON value")
    }

    private fun quote(value: String): String = buildString {
        append('"')
        value.forEachIndexed { index, character ->
            when (character) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\u000c' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> when {
                    character.code < 0x20 -> append("\\u%04x".format(character.code))
                    character.isHighSurrogate() &&
                        value.getOrNull(index + 1)?.isLowSurrogate() != true ->
                        throw CatalogParseException("Unpaired JSON surrogate")
                    character.isLowSurrogate() &&
                        value.getOrNull(index - 1)?.isHighSurrogate() != true ->
                        throw CatalogParseException("Unpaired JSON surrogate")
                    else -> append(character)
                }
            }
        }
        append('"')
    }
}
