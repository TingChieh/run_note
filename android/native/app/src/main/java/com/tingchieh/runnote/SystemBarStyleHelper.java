package com.tingchieh.runnote;

import java.util.Locale;

/**
 * Maps RunNote's effective Web theme ("light", "dark", or "system") into Android system-bar colors
 * and icon contrast flags matching frontend/src/app.css (--background).
 */
public final class SystemBarStyleHelper {

    public static final int LIGHT_BACKGROUND_COLOR = 0xFFF6F7F4;
    public static final int DARK_BACKGROUND_COLOR = 0xFF292725;

    private SystemBarStyleHelper() {}

    public static final class StyleSpec {

        public final boolean dark;
        public final int backgroundColor;
        public final boolean appearanceLightBars;

        public StyleSpec(boolean dark, int backgroundColor, boolean appearanceLightBars) {
            this.dark = dark;
            this.backgroundColor = backgroundColor;
            this.appearanceLightBars = appearanceLightBars;
        }
    }

    public static String normalizeTheme(String rawTheme) {
        if (rawTheme == null) {
            return "system";
        }
        String lower = rawTheme.trim().toLowerCase(Locale.ROOT);
        if ("dark".equals(lower) || "light".equals(lower)) {
            return lower;
        }
        return "system";
    }

    public static StyleSpec resolve(String rawTheme, boolean systemNightMode) {
        String normalized = normalizeTheme(rawTheme);
        boolean dark;
        if ("dark".equals(normalized)) {
            dark = true;
        } else if ("light".equals(normalized)) {
            dark = false;
        } else {
            dark = systemNightMode;
        }
        return new StyleSpec(
            dark,
            dark ? DARK_BACKGROUND_COLOR : LIGHT_BACKGROUND_COLOR,
            !dark
        );
    }
}
