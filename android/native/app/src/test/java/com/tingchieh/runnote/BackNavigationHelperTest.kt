package com.tingchieh.runnote

import org.junit.Assert.assertEquals
import org.junit.Test

class BackNavigationHelperTest {

    @Test
    fun prioritizesErrorOverlayBeforeWebViewJs() {
        assertEquals(
            BackNavigationHelper.Action.DISMISS_ERROR_AND_GO_BACK,
            BackNavigationHelper.decide("\"delegated\"", true, true),
        )
        assertEquals(
            BackNavigationHelper.Action.EXIT_APP,
            BackNavigationHelper.decide("\"delegated\"", false, true),
        )
    }

    @Test
    fun delegatesWhenJsBackBridgeIsActive() {
        assertEquals(
            BackNavigationHelper.Action.DELEGATE_TO_JS,
            BackNavigationHelper.decide("\"delegated\"", true, false),
        )
        assertEquals(
            BackNavigationHelper.Action.DELEGATE_TO_JS,
            BackNavigationHelper.decide("\"delegated\"", false, false),
        )
    }

    @Test
    fun handlesNativeFallbackOverlayHistoryAndRootExit() {
        assertEquals(
            BackNavigationHelper.Action.CONSUMED_BY_OVERLAY,
            BackNavigationHelper.decide("\"overlay\"", true, false),
        )
        assertEquals(
            BackNavigationHelper.Action.GO_BACK,
            BackNavigationHelper.decide("\"navigate\"", true, false),
        )
        assertEquals(
            BackNavigationHelper.Action.EXIT_APP,
            BackNavigationHelper.decide("\"navigate\"", false, false),
        )
        assertEquals(
            BackNavigationHelper.Action.EXIT_APP,
            BackNavigationHelper.decide(null, false, false),
        )
    }
}
