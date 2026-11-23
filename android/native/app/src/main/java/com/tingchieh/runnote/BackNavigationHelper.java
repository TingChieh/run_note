package com.tingchieh.runnote;

/**
 * Pure decision helper for Android Back button / edge-gesture handling in MainActivity.
 */
public final class BackNavigationHelper {

    public enum Action {
        DISMISS_ERROR_AND_GO_BACK,
        DELEGATE_TO_JS,
        CONSUMED_BY_OVERLAY,
        GO_BACK,
        EXIT_APP,
    }

    private BackNavigationHelper() {}

    public static Action decide(String rawJsResult, boolean canGoBack, boolean errorOverlayVisible) {
        if (errorOverlayVisible) {
            return canGoBack ? Action.DISMISS_ERROR_AND_GO_BACK : Action.EXIT_APP;
        }
        if ("\"delegated\"".equals(rawJsResult)) {
            return Action.DELEGATE_TO_JS;
        }
        if ("\"overlay\"".equals(rawJsResult)) {
            return Action.CONSUMED_BY_OVERLAY;
        }
        return canGoBack ? Action.GO_BACK : Action.EXIT_APP;
    }
}
