package com.tingchieh.runnote

import android.content.Context
import androidx.webkit.WebViewCompat
import java.util.regex.Pattern
import kotlin.math.max

object WebViewSupport {

    const val DEFAULT_MIN_CHROMIUM_WEBVIEW_MAJOR: Int = 116
    const val DEFAULT_WEBVIEW_PACKAGE: String = "com.google.android.webview"
    private const val HUAWEI_WEBVIEW_PACKAGE = "com.huawei.webview"
    private const val MIN_HUAWEI_WEBVIEW_MAJOR = 10
    private val LEADING_DIGITS: Pattern = Pattern.compile("(\\d+)")

    class Status(
        @JvmField val supported: Boolean,
        @JvmField val packageName: String?,
        @JvmField val versionName: String?,
        @JvmField val majorVersion: Int?,
        @JvmField val minRequiredMajor: Int,
    )

    @JvmStatic
    fun parseMajorVersion(versionName: String?): Int? {
        if (versionName == null) {
            return null
        }
        val matcher = LEADING_DIGITS.matcher(versionName.trimLikeJava())
        if (!matcher.find()) {
            return null
        }
        return try {
            Integer.parseInt(matcher.group(1)!!)
        } catch (_: NumberFormatException) {
            null
        }
    }

    @JvmStatic
    fun evaluate(packageName: String?, versionName: String?, minChromiumMajor: Int): Status {
        val threshold = max(minChromiumMajor, DEFAULT_MIN_CHROMIUM_WEBVIEW_MAJOR)
        val major = parseMajorVersion(versionName)
        if (packageName == null || packageName.trimLikeJava().isEmpty() || major == null) {
            return Status(false, packageName, versionName, major, threshold)
        }
        if (packageName == HUAWEI_WEBVIEW_PACKAGE) {
            return Status(
                major >= MIN_HUAWEI_WEBVIEW_MAJOR,
                packageName,
                versionName,
                major,
                MIN_HUAWEI_WEBVIEW_MAJOR,
            )
        }
        return Status(major >= threshold, packageName, versionName, major, threshold)
    }

    @JvmStatic
    fun inspect(context: Context, minChromiumMajor: Int): Status {
        val info = WebViewCompat.getCurrentWebViewPackage(context)
            ?: return evaluate(null, null, minChromiumMajor)
        return evaluate(info.packageName, info.versionName, minChromiumMajor)
    }

    @JvmStatic
    fun resolveUpdatePackage(packageName: String?): String {
        if (packageName == null || packageName.trimLikeJava().isEmpty()) {
            return DEFAULT_WEBVIEW_PACKAGE
        }
        return packageName.trimLikeJava()
    }
}
