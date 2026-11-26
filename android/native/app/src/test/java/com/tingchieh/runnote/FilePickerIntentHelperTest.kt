package com.tingchieh.runnote

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FilePickerIntentHelperTest {

    @Test
    fun broadensTrackUploadInputsForGpxAndTcx() {
        val plan = FilePickerIntentHelper.buildPlan(
            arrayOf(".gpx", ".tcx", "application/gpx+xml", "application/xml", "text/xml"),
            true,
            ANDROID_LIKE_MAP,
        )
        assertEquals("*/*", plan.primaryType)
        assertNull(plan.extraMimeTypes)
        assertTrue(plan.allowMultiple)
    }

    @Test
    fun broadensMifitnessJsonAndGpxInputs() {
        val summaryPlan = FilePickerIntentHelper.buildPlan(
            arrayOf(".json", "application/json"),
            false,
            ANDROID_LIKE_MAP,
        )
        assertEquals("*/*", summaryPlan.primaryType)
        assertNull(summaryPlan.extraMimeTypes)
        assertFalse(summaryPlan.allowMultiple)

        val gpxPlan = FilePickerIntentHelper.buildPlan(
            arrayOf(".gpx", "application/gpx+xml", "application/xml", "text/xml"),
            true,
            ANDROID_LIKE_MAP,
        )
        assertEquals("*/*", gpxPlan.primaryType)
        assertNull(gpxPlan.extraMimeTypes)
        assertTrue(gpxPlan.allowMultiple)
    }

    @Test
    fun preservesStrictImageMimeFilter() {
        val plan = FilePickerIntentHelper.buildPlan(
            arrayOf("image/png", "image/jpeg", "image/webp"),
            false,
            ANDROID_LIKE_MAP,
        )
        assertEquals("*/*", plan.primaryType)
        assertArrayEquals(arrayOf("image/png", "image/jpeg", "image/webp"), plan.extraMimeTypes)
        assertFalse(plan.allowMultiple)
    }

    @Test
    fun handlesSingleStandardMimeType() {
        val plan = FilePickerIntentHelper.buildPlan(
            arrayOf("image/png"),
            false,
            ANDROID_LIKE_MAP,
        )
        assertEquals("image/png", plan.primaryType)
        assertNull(plan.extraMimeTypes)
    }

    private companion object {
        val ANDROID_LIKE_MAP = FilePickerIntentHelper.MimeResolver { ext ->
            when (ext) {
                "png" -> "image/png"
                "jpg", "jpeg" -> "image/jpeg"
                "webp" -> "image/webp"
                else -> null // .gpx, .tcx, .json are absent on stock API 29 MimeTypeMap
            }
        }
    }
}
