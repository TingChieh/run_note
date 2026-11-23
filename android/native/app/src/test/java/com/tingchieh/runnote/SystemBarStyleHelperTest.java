package com.tingchieh.runnote;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SystemBarStyleHelperTest {

    @Test
    public void resolvesExplicitLightAndDarkThemesRegardlessOfSystemNightMode() {
        SystemBarStyleHelper.StyleSpec darkOnLightSystem = SystemBarStyleHelper.resolve("dark", false);
        assertTrue(darkOnLightSystem.dark);
        assertEquals(SystemBarStyleHelper.DARK_BACKGROUND_COLOR, darkOnLightSystem.backgroundColor);
        assertFalse(darkOnLightSystem.appearanceLightBars);

        SystemBarStyleHelper.StyleSpec lightOnDarkSystem = SystemBarStyleHelper.resolve("LIGHT", true);
        assertFalse(lightOnDarkSystem.dark);
        assertEquals(SystemBarStyleHelper.LIGHT_BACKGROUND_COLOR, lightOnDarkSystem.backgroundColor);
        assertTrue(lightOnDarkSystem.appearanceLightBars);
    }

    @Test
    public void followsSystemNightModeForSystemOrUnknownPreference() {
        SystemBarStyleHelper.StyleSpec sysDark = SystemBarStyleHelper.resolve("system", true);
        assertTrue(sysDark.dark);
        assertEquals(SystemBarStyleHelper.DARK_BACKGROUND_COLOR, sysDark.backgroundColor);
        assertFalse(sysDark.appearanceLightBars);

        SystemBarStyleHelper.StyleSpec sysLight = SystemBarStyleHelper.resolve(null, false);
        assertFalse(sysLight.dark);
        assertEquals(SystemBarStyleHelper.LIGHT_BACKGROUND_COLOR, sysLight.backgroundColor);
        assertTrue(sysLight.appearanceLightBars);

        assertEquals("system", SystemBarStyleHelper.normalizeTheme("unexpected"));
    }
}
