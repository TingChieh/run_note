package org.runnote.phasezero;

import android.content.Context;
import android.content.pm.PackageInfo;
import androidx.webkit.WebViewCompat;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class WebViewSupport {

    public static final int DEFAULT_MIN_CHROMIUM_WEBVIEW_MAJOR = 116;
    public static final String DEFAULT_WEBVIEW_PACKAGE = "com.google.android.webview";
    private static final String HUAWEI_WEBVIEW_PACKAGE = "com.huawei.webview";
    private static final int MIN_HUAWEI_WEBVIEW_MAJOR = 10;
    private static final Pattern LEADING_DIGITS = Pattern.compile("(\\d+)");

    private WebViewSupport() {}

    public static final class Status {

        public final boolean supported;
        public final String packageName;
        public final String versionName;
        public final Integer majorVersion;
        public final int minRequiredMajor;

        public Status(
            boolean supported,
            String packageName,
            String versionName,
            Integer majorVersion,
            int minRequiredMajor
        ) {
            this.supported = supported;
            this.packageName = packageName;
            this.versionName = versionName;
            this.majorVersion = majorVersion;
            this.minRequiredMajor = minRequiredMajor;
        }
    }

    public static Integer parseMajorVersion(String versionName) {
        if (versionName == null) {
            return null;
        }
        Matcher matcher = LEADING_DIGITS.matcher(versionName.trim());
        if (!matcher.find()) {
            return null;
        }
        try {
            return Integer.parseInt(matcher.group(1));
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    public static Status evaluate(String packageName, String versionName, int minChromiumMajor) {
        int threshold = Math.max(minChromiumMajor, DEFAULT_MIN_CHROMIUM_WEBVIEW_MAJOR);
        Integer major = parseMajorVersion(versionName);
        if (packageName == null || packageName.trim().isEmpty() || major == null) {
            return new Status(false, packageName, versionName, major, threshold);
        }
        if (HUAWEI_WEBVIEW_PACKAGE.equals(packageName)) {
            return new Status(
                major >= MIN_HUAWEI_WEBVIEW_MAJOR,
                packageName,
                versionName,
                major,
                MIN_HUAWEI_WEBVIEW_MAJOR
            );
        }
        return new Status(major >= threshold, packageName, versionName, major, threshold);
    }

    public static Status inspect(Context context, int minChromiumMajor) {
        PackageInfo info = WebViewCompat.getCurrentWebViewPackage(context);
        if (info == null) {
            return evaluate(null, null, minChromiumMajor);
        }
        return evaluate(info.packageName, info.versionName, minChromiumMajor);
    }

    public static String resolveUpdatePackage(String packageName) {
        if (packageName == null || packageName.trim().isEmpty()) {
            return DEFAULT_WEBVIEW_PACKAGE;
        }
        return packageName.trim();
    }
}
