package dev.yougotserved.thorium

/** Strict JSON grammar validation without constructing the saved value's object graph. */
object LocalSaveJson {
    private const val MAX_DEPTH = 32
    private val number = Regex("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")
    fun requireValid(text: String) {
        if (space(text, value(text, space(text, 0), 0)) != text.length) invalid()
    }

    private fun value(text: String, start: Int, depth: Int): Int {
        return when (text.getOrNull(start)) {
            '"' -> LocalSaveJsonString.end(text, start + 1)
            '[' -> array(text, space(text, start + 1), nextDepth(depth))
            '{' -> obj(text, space(text, start + 1), nextDepth(depth))
            't' -> literal(text, start, "true")
            'f' -> literal(text, start, "false")
            'n' -> literal(text, start, "null")
            else -> numeric(text, start)
        }
    }
    private fun nextDepth(depth: Int): Int {
        if (depth >= MAX_DEPTH) invalid()
        return depth + 1
    }

    private fun literal(text: String, start: Int, expected: String): Int {
        if (!text.startsWith(expected, start)) invalid()
        return start + expected.length
    }

    private fun numeric(text: String, start: Int): Int {
        val matched = number.find(text, start) ?: invalid()
        if (matched.range.first != start || matched.value.toDoubleOrNull()?.isFinite() != true) invalid()
        return matched.range.last + 1
    }

    private fun array(text: String, start: Int, depth: Int): Int =
        if (text.getOrNull(start) == ']') start + 1 else elements(text, start, depth)

    private tailrec fun elements(text: String, start: Int, depth: Int): Int {
        val after = space(text, value(text, start, depth))
        if (text.getOrNull(after) == ']') return after + 1
        if (text.getOrNull(after) != ',') invalid()
        return elements(text, space(text, after + 1), depth)
    }

    private fun obj(text: String, start: Int, depth: Int): Int =
        if (text.getOrNull(start) == '}') start + 1 else members(text, start, depth)

    private tailrec fun members(text: String, start: Int, depth: Int): Int {
        if (text.getOrNull(start) != '"') invalid()
        val colon = space(text, LocalSaveJsonString.end(text, start + 1))
        if (text.getOrNull(colon) != ':') invalid()
        val after = space(text, value(text, space(text, colon + 1), depth))
        if (text.getOrNull(after) == '}') return after + 1
        if (text.getOrNull(after) != ',') invalid()
        return members(text, space(text, after + 1), depth)
    }

    private tailrec fun space(text: String, start: Int): Int =
        if (text.getOrNull(start) in listOf(' ', '\t', '\r', '\n')) space(text, start + 1) else start

    private fun invalid(): Nothing = LocalSavePolicy.fail("invalid_request")
}
