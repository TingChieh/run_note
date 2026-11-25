package com.tingchieh.runnote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SystemBarStyleHelperTest {

    @Test
    fun resolvesExplicitLightAndDarkThemesRegardlessOfSystemNightMode() {
        val darkOnLightSystem = SystemBarStyleHelper.resolve("dark", false)
        assertTrue(darkOnLightSystem.dark)
        assertEquals(SystemBarStyleHelper.DARK_BACKGROUND_COLOR, darkOnLightSystem.backgroundColor)
        assertFalse(darkOnLightSystem.appearanceLightBars)

        val lightOnDarkSystem = SystemBarStyleHelper.resolve("LIGHT", true)
        assertFalse(lightOnDarkSystem.dark)
        assertEquals(SystemBarStyleHelper.LIGHT_BACKGROUND_COLOR, lightOnDarkSystem.backgroundColor)
        assertTrue(lightOnDarkSystem.appearanceLightBars)
    }

    @Test
    fun followsSystemNightModeForSystemOrUnknownPreference() {
        val sysDark = SystemBarStyleHelper.resolve("system", true)
        assertTrue(sysDark.dark)
        assertEquals(SystemBarStyleHelper.DARK_BACKGROUND_COLOR, sysDark.backgroundColor)
        assertFalse(sysDark.appearanceLightBars)

        val sysLight = SystemBarStyleHelper.resolve(null, false)
        assertFalse(sysLight.dark)
        assertEquals(SystemBarStyleHelper.LIGHT_BACKGROUND_COLOR, sysLight.backgroundColor)
        assertTrue(sysLight.appearanceLightBars)

        assertEquals("system", SystemBarStyleHelper.normalizeTheme("unexpected"))
    }
}
