package com.tingchieh.runnote

/**
 * Pure decision helper for Android Back button / edge-gesture handling in MainActivity.
 */
object BackNavigationHelper {

    enum class Action {
        DISMISS_ERROR_AND_GO_BACK,
        DELEGATE_TO_JS,
        CONSUMED_BY_OVERLAY,
        GO_BACK,
        EXIT_APP,
    }

    @JvmStatic
    fun decide(rawJsResult: String?, canGoBack: Boolean, errorOverlayVisible: Boolean): Action {
        if (errorOverlayVisible) {
            return if (canGoBack) Action.DISMISS_ERROR_AND_GO_BACK else Action.EXIT_APP
        }
        if (rawJsResult == "\"delegated\"") {
            return Action.DELEGATE_TO_JS
        }
        if (rawJsResult == "\"overlay\"") {
            return Action.CONSUMED_BY_OVERLAY
        }
        return if (canGoBack) Action.GO_BACK else Action.EXIT_APP
    }
}
