package com.tingchieh.runnote;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsIntent;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.Logger;

/**
 * Enforces RunNote's Phase 1 navigation allowlist, external browser delegation, native loading
 * progress, connection/TLS error handling, and fallback theme sync for older web deployments.
 */
public class RunNoteWebViewClient extends BridgeWebViewClient {

    public enum ErrorKind {
        OFFLINE,
        UNREACHABLE,
        TLS,
    }

    public interface HostCallbacks {
        void onLoadingStateChanged(boolean loading);
        void onMainFrameError(ErrorKind kind, String failedUrl);
        void onMainFrameLoaded();
        void onFallbackThemeObserved(String theme);
        boolean isDeviceOnline();
    }

    // Fallback observer only runs if the loaded web deployment has not registered capacitor-theme.ts.
    private static final String FALLBACK_THEME_OBSERVER_JS =
        "(function(){" +
        "if(window.__runnoteThemeBridgeActive||window.__runnoteThemeFallbackInstalled){return;}" +
        "window.__runnoteThemeFallbackInstalled=true;" +
        "function push(){" +
        "var t=document.documentElement&&document.documentElement.dataset?document.documentElement.dataset.theme:'';" +
        "if(t!=='dark'&&t!=='light'){return;}" +
        "var p=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.SystemAppearance;" +
        "if(p&&typeof p.setTheme==='function'){p.setTheme({theme:t});}" +
        "}" +
        "push();" +
        "window.addEventListener('runnote-theme-change',push);" +
        "try{new MutationObserver(push).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});}catch(_){}" +
        "})();";

    private final MainActivity activity;
    private final String allowedOriginUrl;
    private final HostCallbacks callbacks;
    private boolean mainFrameFailed = false;

    public RunNoteWebViewClient(
        Bridge bridge,
        MainActivity activity,
        String allowedOriginUrl,
        HostCallbacks callbacks
    ) {
        super(bridge);
        this.activity = activity;
        this.allowedOriginUrl = allowedOriginUrl;
        this.callbacks = callbacks;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri uri = request != null ? request.getUrl() : null;
        String targetUrl = uri != null ? uri.toString() : null;
        NavigationPolicy.Decision decision = NavigationPolicy.classify(targetUrl, allowedOriginUrl);
        switch (decision) {
            case ALLOW_IN_WEBVIEW:
                return false;
            case OPEN_EXTERNAL_BROWSER:
                openExternalBrowser(uri);
                return true;
            case OPEN_SYSTEM_ACTION:
                openSystemAction(uri);
                return true;
            case BLOCK:
            default:
                Logger.warn("RunNoteNav", "Blocked disallowed WebView navigation scheme");
                return true;
        }
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        super.onPageStarted(view, url, favicon);
        mainFrameFailed = false;
        callbacks.onLoadingStateChanged(true);
    }

    @Override
    public void onPageCommitVisible(WebView view, String url) {
        super.onPageCommitVisible(view, url);
        if (!mainFrameFailed) {
            callbacks.onMainFrameLoaded();
            callbacks.onLoadingStateChanged(false);
            syncThemeFromDocument(view);
        }
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        callbacks.onLoadingStateChanged(false);
        if (!mainFrameFailed) {
            callbacks.onMainFrameLoaded();
            syncThemeFromDocument(view);
        }
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        super.onReceivedError(view, request, error);
        if (request == null || !request.isForMainFrame()) {
            return;
        }
        // Ignore aborted navigations (e.g. rapid SPA redirect or cancelled load).
        if (error != null && error.getErrorCode() == ERROR_UNKNOWN && error.getDescription() != null) {
            String desc = error.getDescription().toString();
            if (desc.contains("ERR_ABORTED")) {
                return;
            }
        }
        mainFrameFailed = true;
        callbacks.onLoadingStateChanged(false);
        String failedUrl = request.getUrl() != null ? request.getUrl().toString() : allowedOriginUrl;
        ErrorKind kind = callbacks.isDeviceOnline() ? ErrorKind.UNREACHABLE : ErrorKind.OFFLINE;
        callbacks.onMainFrameError(kind, failedUrl);
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        // Never proceed on TLS certificate errors.
        handler.cancel();
        mainFrameFailed = true;
        callbacks.onLoadingStateChanged(false);
        String failedUrl = error != null && error.getUrl() != null ? error.getUrl() : allowedOriginUrl;
        callbacks.onMainFrameError(ErrorKind.TLS, failedUrl);
    }

    private void syncThemeFromDocument(WebView view) {
        if (view == null) {
            return;
        }
        view.evaluateJavascript(
            "(function(){return document.documentElement&&document.documentElement.dataset?document.documentElement.dataset.theme||'':'';})();",
            (raw) -> {
                if ("\"dark\"".equals(raw)) {
                    callbacks.onFallbackThemeObserved("dark");
                } else if ("\"light\"".equals(raw)) {
                    callbacks.onFallbackThemeObserved("light");
                }
            }
        );
        view.evaluateJavascript(FALLBACK_THEME_OBSERVER_JS, null);
    }

    private void openExternalBrowser(Uri uri) {
        if (uri == null) {
            return;
        }
        try {
            SystemBarStyleHelper.StyleSpec spec = activity.getCurrentBarStyleSpec();
            CustomTabColorSchemeParams colorParams = new CustomTabColorSchemeParams.Builder()
                .setToolbarColor(spec.backgroundColor)
                .build();
            CustomTabsIntent customTabsIntent = new CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(colorParams)
                .setShowTitle(true)
                .build();
            customTabsIntent.launchUrl(activity, uri);
            return;
        } catch (ActivityNotFoundException | SecurityException ignored) {
            // Fall back to standard system browser intent below.
        }
        Intent browserIntent = new Intent(Intent.ACTION_VIEW, uri);
        browserIntent.addCategory(Intent.CATEGORY_BROWSABLE);
        browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            activity.startActivity(browserIntent);
        } catch (ActivityNotFoundException | SecurityException ignored) {
            Logger.warn("RunNoteNav", "No browser available to handle external URL");
        }
    }

    private void openSystemAction(Uri uri) {
        if (uri == null) {
            return;
        }
        Intent mailIntent = new Intent(Intent.ACTION_SENDTO, uri);
        mailIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            activity.startActivity(mailIntent);
        } catch (ActivityNotFoundException | SecurityException ignored) {
            Logger.warn("RunNoteNav", "No system handler available for mailto URI");
        }
    }
}
