package com.tingchieh.runnote

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Syncs Android status/navigation bar background color and icon contrast with RunNote's active
 * light/dark appearance (including manual overrides that differ from the OS theme).
 */
@CapacitorPlugin(name = "SystemAppearance")
class SystemAppearancePlugin : Plugin() {

    @PluginMethod
    fun setTheme(call: PluginCall) {
        val theme = SystemBarStyleHelper.normalizeTheme(call.getString("theme", "system"))
        val activity = getActivity()
        if (activity is MainActivity) {
            activity.runOnUiThread {
                activity.applySystemBarTheme(theme)
                call.resolve()
            }
            return
        }
        call.resolve()
    }
}
