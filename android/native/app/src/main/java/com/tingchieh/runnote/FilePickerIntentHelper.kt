package com.tingchieh.runnote

import android.content.Intent
import java.util.Locale

/**
 * Normalizes HTML file-input accept tokens into Android DocumentsUI intent filters.
 *
 * Android's MimeTypeMap has no entry for .gpx/.tcx (and some providers classify .gpx/.tcx/.json
 * as application/octet-stream or text/plain). Filtering strictly by resolved MIME types disables
 * standard Downloads files in DocumentsUI, so those inputs fall back to a broad openable filter
 * while RunNote's client and server parsers continue validating exact file formats.
 */
object FilePickerIntentHelper {

    fun interface MimeResolver {
        fun fromExtension(extension: String): String?
    }

    private val BROAD_FALLBACK_TOKENS: Set<String> = hashSetOf(
        ".gpx",
        ".tcx",
        ".json",
        "application/gpx+xml",
        "application/vnd.garmin.tcx+xml",
    )

    class Plan(
        @JvmField val primaryType: String,
        @JvmField val extraMimeTypes: Array<String>?,
        @JvmField val allowMultiple: Boolean,
    )

    @JvmStatic
    fun buildPlan(acceptTypes: Array<out String?>?, allowMultiple: Boolean, resolver: MimeResolver?): Plan {
        if (acceptTypes == null || acceptTypes.isEmpty()) {
            return Plan("*/*", null, allowMultiple)
        }

        val validTypes = ArrayList<String>()
        var requiresBroadFilter = false

        for (raw in acceptTypes) {
            if (raw == null) {
                continue
            }
            for (part in raw.split(",")) {
                val token = part.trimLikeJava().lowercase(Locale.ROOT)
                if (token.isEmpty()) {
                    continue
                }
                if (token == "*/*" || token in BROAD_FALLBACK_TOKENS) {
                    requiresBroadFilter = true
                    continue
                }
                if (token.startsWith(".")) {
                    val ext = token.substring(1)
                    val mapped = if (ext.isEmpty() || resolver == null) null else resolver.fromExtension(ext)
                    if (mapped == null || mapped.trimLikeJava().isEmpty()) {
                        requiresBroadFilter = true
                    } else if (mapped !in validTypes) {
                        validTypes.add(mapped)
                    }
                } else if (token !in validTypes) {
                    validTypes.add(token)
                }
            }
        }

        if (requiresBroadFilter || validTypes.isEmpty()) {
            return Plan("*/*", null, allowMultiple)
        }
        if (validTypes.size == 1) {
            return Plan(validTypes[0], null, allowMultiple)
        }
        return Plan("*/*", validTypes.toTypedArray(), allowMultiple)
    }

    @JvmStatic
    fun applyToIntent(intent: Intent, plan: Plan): Intent {
        intent.addCategory(Intent.CATEGORY_OPENABLE)
        intent.type = plan.primaryType
        val extraMimeTypes = plan.extraMimeTypes
        if (extraMimeTypes != null && extraMimeTypes.isNotEmpty()) {
            intent.putExtra(Intent.EXTRA_MIME_TYPES, extraMimeTypes)
        } else {
            intent.removeExtra(Intent.EXTRA_MIME_TYPES)
        }
        if (plan.allowMultiple) {
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        return intent
    }
}
