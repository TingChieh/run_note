package org.runnote.phasezero;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class FilePickerIntentHelperTest {

    private static final FilePickerIntentHelper.MimeResolver ANDROID_LIKE_MAP = (ext) -> {
        if ("png".equals(ext)) return "image/png";
        if ("jpg".equals(ext) || "jpeg".equals(ext)) return "image/jpeg";
        if ("webp".equals(ext)) return "image/webp";
        return null; // .gpx, .tcx, .json are absent on stock API 29 MimeTypeMap
    };

    @Test
    public void broadensTrackUploadInputsForGpxAndTcx() {
        FilePickerIntentHelper.Plan plan = FilePickerIntentHelper.buildPlan(
            new String[] { ".gpx", ".tcx", "application/gpx+xml", "application/xml", "text/xml" },
            true,
            ANDROID_LIKE_MAP
        );
        assertEquals("*/*", plan.primaryType);
        assertNull(plan.extraMimeTypes);
        assertTrue(plan.allowMultiple);
    }

    @Test
    public void broadensMifitnessJsonAndGpxInputs() {
        FilePickerIntentHelper.Plan summaryPlan = FilePickerIntentHelper.buildPlan(
            new String[] { ".json", "application/json" },
            false,
            ANDROID_LIKE_MAP
        );
        assertEquals("*/*", summaryPlan.primaryType);
        assertNull(summaryPlan.extraMimeTypes);
        assertFalse(summaryPlan.allowMultiple);

        FilePickerIntentHelper.Plan gpxPlan = FilePickerIntentHelper.buildPlan(
            new String[] { ".gpx", "application/gpx+xml", "application/xml", "text/xml" },
            true,
            ANDROID_LIKE_MAP
        );
        assertEquals("*/*", gpxPlan.primaryType);
        assertNull(gpxPlan.extraMimeTypes);
        assertTrue(gpxPlan.allowMultiple);
    }

    @Test
    public void preservesStrictImageMimeFilter() {
        FilePickerIntentHelper.Plan plan = FilePickerIntentHelper.buildPlan(
            new String[] { "image/png", "image/jpeg", "image/webp" },
            false,
            ANDROID_LIKE_MAP
        );
        assertEquals("*/*", plan.primaryType);
        assertArrayEquals(new String[] { "image/png", "image/jpeg", "image/webp" }, plan.extraMimeTypes);
        assertFalse(plan.allowMultiple);
    }

    @Test
    public void handlesSingleStandardMimeType() {
        FilePickerIntentHelper.Plan plan = FilePickerIntentHelper.buildPlan(
            new String[] { "image/png" },
            false,
            ANDROID_LIKE_MAP
        );
        assertEquals("image/png", plan.primaryType);
        assertNull(plan.extraMimeTypes);
    }
}
