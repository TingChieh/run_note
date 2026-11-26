package com.tingchieh.runnote

/**
 * Java `String.trim()` semantics: strips leading/trailing chars <= U+0020, including control
 * characters. Kotlin `trim()` strips Unicode whitespace instead, which would change which server
 * URLs, navigation targets, accept tokens and theme values the policies ported from Java accept.
 */
@Suppress("TrimLambda") // Intentional: plain trim() is not equivalent to the Java originals.
internal fun String.trimLikeJava(): String = trim { it <= ' ' }
