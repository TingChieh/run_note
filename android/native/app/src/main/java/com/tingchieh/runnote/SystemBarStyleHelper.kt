package com.tingchieh.runnote

import java.util.Locale

/**
 * Maps RunNote's effective Web theme ("light", "dark", or "system") into Android system-bar colors
 * and icon contrast flags matching frontend/src/app.css (--background).
 */
object SystemBarStyleHelper {

    const val LIGHT_BACKGROUND_COLOR: Int = 0xFFF6F7F4.toInt()
    const val DARK_BACKGROUND_COLOR: Int = 0xFF292725.toInt()

    class StyleSpec(
        @JvmField val dark: Boolean,
        @JvmField val backgroundColor: Int,
        @JvmField val appearanceLightBars: Boolean,
    )

    @JvmStatic
    fun normalizeTheme(rawTheme: String?): String {
        if (rawTheme == null) {
            return "system"
        }
        val lower = rawTheme.trimLikeJava().lowercase(Locale.ROOT)
        if (lower == "dark" || lower == "light") {
            return lower
        }
        return "system"
    }

    @JvmStatic
    fun resolve(rawTheme: String?, systemNightMode: Boolean): StyleSpec {
        val dark = when (normalizeTheme(rawTheme)) {
            "dark" -> true
            "light" -> false
            else -> systemNightMode
        }
        return StyleSpec(
            dark,
            if (dark) DARK_BACKGROUND_COLOR else LIGHT_BACKGROUND_COLOR,
            !dark,
        )
    }
}
