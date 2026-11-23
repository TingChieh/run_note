package com.tingchieh.runnote;

import android.content.Intent;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Normalizes HTML file-input accept tokens into Android DocumentsUI intent filters.
 *
 * <p>Android's MimeTypeMap has no entry for .gpx/.tcx (and some providers classify .gpx/.tcx/.json
 * as application/octet-stream or text/plain). Filtering strictly by resolved MIME types disables
 * standard Downloads files in DocumentsUI, so those inputs fall back to a broad openable filter
 * while RunNote's client and server parsers continue validating exact file formats.
 */
public final class FilePickerIntentHelper {

    public interface MimeResolver {
        String fromExtension(String extension);
    }

    private static final Set<String> BROAD_FALLBACK_TOKENS = new HashSet<>(
        Arrays.asList(
            ".gpx",
            ".tcx",
            ".json",
            "application/gpx+xml",
            "application/vnd.garmin.tcx+xml"
        )
    );

    private FilePickerIntentHelper() {}

    public static final class Plan {

        public final String primaryType;
        public final String[] extraMimeTypes;
        public final boolean allowMultiple;

        public Plan(String primaryType, String[] extraMimeTypes, boolean allowMultiple) {
            this.primaryType = primaryType;
            this.extraMimeTypes = extraMimeTypes;
            this.allowMultiple = allowMultiple;
        }
    }

    public static Plan buildPlan(String[] acceptTypes, boolean allowMultiple, MimeResolver resolver) {
        if (acceptTypes == null || acceptTypes.length == 0) {
            return new Plan("*/*", null, allowMultiple);
        }

        List<String> validTypes = new ArrayList<>();
        boolean requiresBroadFilter = false;

        for (String raw : acceptTypes) {
            if (raw == null) {
                continue;
            }
            for (String part : raw.split(",")) {
                String token = part.trim().toLowerCase(Locale.ROOT);
                if (token.isEmpty()) {
                    continue;
                }
                if ("*/*".equals(token) || BROAD_FALLBACK_TOKENS.contains(token)) {
                    requiresBroadFilter = true;
                    continue;
                }
                if (token.startsWith(".")) {
                    String ext = token.substring(1);
                    String mapped = ext.isEmpty() || resolver == null ? null : resolver.fromExtension(ext);
                    if (mapped == null || mapped.trim().isEmpty()) {
                        requiresBroadFilter = true;
                    } else if (!validTypes.contains(mapped)) {
                        validTypes.add(mapped);
                    }
                } else if (!validTypes.contains(token)) {
                    validTypes.add(token);
                }
            }
        }

        if (requiresBroadFilter || validTypes.isEmpty()) {
            return new Plan("*/*", null, allowMultiple);
        }
        if (validTypes.size() == 1) {
            return new Plan(validTypes.get(0), null, allowMultiple);
        }
        return new Plan("*/*", validTypes.toArray(new String[0]), allowMultiple);
    }

    public static Intent applyToIntent(Intent intent, Plan plan) {
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(plan.primaryType);
        if (plan.extraMimeTypes != null && plan.extraMimeTypes.length > 0) {
            intent.putExtra(Intent.EXTRA_MIME_TYPES, plan.extraMimeTypes);
        } else {
            intent.removeExtra(Intent.EXTRA_MIME_TYPES);
        }
        if (plan.allowMultiple) {
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        return intent;
    }
}
