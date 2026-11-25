package com.tingchieh.runnote

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import com.getcapacitor.Bridge
import com.getcapacitor.BridgeWebViewClient
import com.getcapacitor.Logger

/**
 * Enforces RunNote's Phase 1 navigation allowlist, external browser delegation, native loading
 * progress, connection/TLS error handling, and fallback theme sync for older web deployments.
 */
class RunNoteWebViewClient(
    bridge: Bridge,
    private val activity: MainActivity,
    private val allowedOriginUrl: String,
    private val callbacks: HostCallbacks,
) : BridgeWebViewClient(bridge) {

    enum class ErrorKind {
        OFFLINE,
        UNREACHABLE,
        TLS,
    }

    interface HostCallbacks {
        fun onLoadingStateChanged(loading: Boolean)
        fun onMainFrameError(kind: ErrorKind, failedUrl: String)
        fun onMainFrameLoaded()
        fun onFallbackThemeObserved(theme: String)
        fun isDeviceOnline(): Boolean
    }

    private var mainFrameFailed = false

    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val uri: Uri? = request?.url
        val targetUrl = uri?.toString()
        return when (NavigationPolicy.classify(targetUrl, allowedOriginUrl)) {
            NavigationPolicy.Decision.ALLOW_IN_WEBVIEW -> false
            NavigationPolicy.Decision.OPEN_EXTERNAL_BROWSER -> {
                openExternalBrowser(uri)
                true
            }
            NavigationPolicy.Decision.OPEN_SYSTEM_ACTION -> {
                openSystemAction(uri)
                true
            }
            NavigationPolicy.Decision.BLOCK -> {
                Logger.warn("RunNoteNav", "Blocked disallowed WebView navigation scheme")
                true
            }
        }
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        mainFrameFailed = false
        callbacks.onLoadingStateChanged(true)
    }

    override fun onPageCommitVisible(view: WebView?, url: String?) {
        super.onPageCommitVisible(view, url)
        if (!mainFrameFailed) {
            callbacks.onMainFrameLoaded()
            callbacks.onLoadingStateChanged(false)
            syncThemeFromDocument(view)
        }
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        callbacks.onLoadingStateChanged(false)
        if (!mainFrameFailed) {
            callbacks.onMainFrameLoaded()
            syncThemeFromDocument(view)
        }
    }

    override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
        super.onReceivedError(view, request, error)
        if (request == null || !request.isForMainFrame) {
            return
        }
        // Ignore aborted navigations (e.g. rapid SPA redirect or cancelled load).
        val description: CharSequence? = error?.description
        if (error != null && error.errorCode == WebViewClient.ERROR_UNKNOWN && description != null) {
            if (description.toString().contains("ERR_ABORTED")) {
                return
            }
        }
        mainFrameFailed = true
        callbacks.onLoadingStateChanged(false)
        val failedUrl = request.url?.toString() ?: allowedOriginUrl
        val kind = if (callbacks.isDeviceOnline()) ErrorKind.UNREACHABLE else ErrorKind.OFFLINE
        callbacks.onMainFrameError(kind, failedUrl)
    }

    override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler, error: SslError?) {
        // Never proceed on TLS certificate errors.
        handler.cancel()
        mainFrameFailed = true
        callbacks.onLoadingStateChanged(false)
        val failedUrl = error?.url ?: allowedOriginUrl
        callbacks.onMainFrameError(ErrorKind.TLS, failedUrl)
    }

    private fun syncThemeFromDocument(view: WebView?) {
        if (view == null) {
            return
        }
        view.evaluateJavascript(
            "(function(){return document.documentElement&&document.documentElement.dataset?document.documentElement.dataset.theme||'':'';})();",
        ) { raw ->
            if (raw == "\"dark\"") {
                callbacks.onFallbackThemeObserved("dark")
            } else if (raw == "\"light\"") {
                callbacks.onFallbackThemeObserved("light")
            }
        }
        view.evaluateJavascript(FALLBACK_THEME_OBSERVER_JS, null)
    }

    private fun openExternalBrowser(uri: Uri?) {
        if (uri == null) {
            return
        }
        try {
            val spec = activity.getCurrentBarStyleSpec()
            val colorParams = CustomTabColorSchemeParams.Builder()
                .setToolbarColor(spec.backgroundColor)
                .build()
            val customTabsIntent = CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(colorParams)
                .setShowTitle(true)
                .build()
            customTabsIntent.launchUrl(activity, uri)
            return
        } catch (_: ActivityNotFoundException) {
            // Fall back to standard system browser intent below.
        } catch (_: SecurityException) {
            // Fall back to standard system browser intent below.
        }
        val browserIntent = Intent(Intent.ACTION_VIEW, uri)
        browserIntent.addCategory(Intent.CATEGORY_BROWSABLE)
        browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            activity.startActivity(browserIntent)
        } catch (_: ActivityNotFoundException) {
            Logger.warn("RunNoteNav", "No browser available to handle external URL")
        } catch (_: SecurityException) {
            Logger.warn("RunNoteNav", "No browser available to handle external URL")
        }
    }

    private fun openSystemAction(uri: Uri?) {
        if (uri == null) {
            return
        }
        val mailIntent = Intent(Intent.ACTION_SENDTO, uri)
        mailIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            activity.startActivity(mailIntent)
        } catch (_: ActivityNotFoundException) {
            Logger.warn("RunNoteNav", "No system handler available for mailto URI")
        } catch (_: SecurityException) {
            Logger.warn("RunNoteNav", "No system handler available for mailto URI")
        }
    }

    private companion object {
        // Fallback observer only runs if the loaded web deployment has not registered capacitor-theme.ts.
        const val FALLBACK_THEME_OBSERVER_JS: String =
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
                "})();"
    }
}
