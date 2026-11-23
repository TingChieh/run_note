package com.tingchieh.runnote;

import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Syncs Android status/navigation bar background color and icon contrast with RunNote's active
 * light/dark appearance (including manual overrides that differ from the OS theme).
 */
@CapacitorPlugin(name = "SystemAppearance")
public class SystemAppearancePlugin extends Plugin {

    @PluginMethod
    public void setTheme(PluginCall call) {
        String theme = SystemBarStyleHelper.normalizeTheme(call.getString("theme", "system"));
        AppCompatActivity activity = getActivity();
        if (activity instanceof MainActivity) {
            activity.runOnUiThread(() -> {
                ((MainActivity) activity).applySystemBarTheme(theme);
                call.resolve();
            });
            return;
        }
        call.resolve();
    }
}
