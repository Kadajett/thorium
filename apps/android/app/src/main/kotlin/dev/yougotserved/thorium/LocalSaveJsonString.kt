package dev.yougotserved.thorium

/** Consumes a strict JSON string without allocating or unescaping its contents. */
internal object LocalSaveJsonString {
    private const val FIRST_PRINTABLE = 32
    private const val UNICODE_DIGITS = 4
    private const val HEX_RADIX = 16

    tailrec fun end(text: String, start: Int): Int {
        val next = text.getOrNull(start) ?: invalid()
        if (next == '"') return start + 1
        if (next.code < FIRST_PRINTABLE) invalid()
        val after = if (next == '\\') escape(text, start + 1) else start + 1
        return end(text, after)
    }

    private fun escape(text: String, start: Int): Int = when (text.getOrNull(start)) {
        '"', '\\', '/', 'b', 'f', 'n', 'r', 't' -> start + 1
        'u' -> unicode(text, start + 1)
        else -> invalid()
    }

    private fun unicode(text: String, start: Int): Int {
        val end = start + UNICODE_DIGITS
        if (end > text.length) invalid()
        if (!(start until end).all { text[it].digitToIntOrNull(HEX_RADIX) != null }) invalid()
        return end
    }

    private fun invalid(): Nothing = LocalSavePolicy.fail("invalid_request")
}
