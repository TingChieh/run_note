package com.tingchieh.runnote

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.core.net.toUri
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import com.getcapacitor.BridgeActivity
import com.getcapacitor.CapConfig
import com.getcapacitor.Logger
import kotlin.math.max

class MainActivity : BridgeActivity(), RunNoteWebViewClient.HostCallbacks {

    private var backEvaluationInFlight = false
    private lateinit var activeServerUrl: String
    private var lastFailedUrl: String? = null
    private var activeThemePreference = "system"
    private var connectionErrorOverlay: View? = null
    private var errorTitleView: TextView? = null
    private var errorBodyView: TextView? = null
    private var errorBackButton: Button? = null
    private var loadingProgressBar: ProgressBar? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        applySystemBarTheme(activeThemePreference)
    }

    override fun load() {
        val defaultConfig = CapConfig.loadDefault(this)
        val minMajor = max(
            defaultConfig.minWebViewVersion,
            WebViewSupport.DEFAULT_MIN_CHROMIUM_WEBVIEW_MAJOR,
        )
        val status = WebViewSupport.inspect(this, minMajor)
        if (!status.supported) {
            Logger.warn(
                "RunNoteWebView",
                "Unsupported system WebView: package=" +
                    status.packageName +
                    ", version=" +
                    status.versionName +
                    ", required>=" +
                    status.minRequiredMajor,
            )
            showWebViewUpgradeScreen(status)
            return
        }

        val serverCheck = ServerUrlPolicy.validate(
            BuildConfig.RUNNOTE_SERVER_URL,
            BuildConfig.DEBUG,
        )
        if (!serverCheck.valid) {
            Logger.error("RunNoteConfig", "Invalid server URL configuration: " + serverCheck.reason, null)
            showStandaloneConfigError()
            return
        }
        val serverUrl = serverCheck.normalizedUrl!!
        activeServerUrl = serverUrl

        config = CapConfig.Builder(this)
            .setServerUrl(serverUrl)
            .setAllowMixedContent(false)
            .setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
            .setLoggingEnabled(BuildConfig.DEBUG)
            .create()

        registerPlugin(SystemAppearancePlugin::class.java)
        registerPlugin(HealthDataPlugin::class.java)
        registerPlugin(LocationRecorderPlugin::class.java)
        super.load()

        val bridge = getBridge()
        if (bridge != null && bridge.webView != null) {
            val webView: WebView = bridge.webView
            installNativeOverlays()
            bridge.setWebViewClient(RunNoteWebViewClient(bridge, this, serverUrl, this))
            webView.webChromeClient = RunNoteWebChromeClient(bridge)
            installBackFallback(webView)
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applySystemBarTheme(activeThemePreference)
    }

    override fun onPause() {
        super.onPause()
        flushCookies()
    }

    override fun onStop() {
        super.onStop()
        flushCookies()
    }

    private fun flushCookies() {
        if (getBridge() != null) {
            CookieManager.getInstance().flush()
        }
    }

    fun getCurrentBarStyleSpec(): SystemBarStyleHelper.StyleSpec {
        val nightMask = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        val systemNight = nightMask == Configuration.UI_MODE_NIGHT_YES
        return SystemBarStyleHelper.resolve(activeThemePreference, systemNight)
    }

    @Suppress("DEPRECATION")
    fun applySystemBarTheme(rawTheme: String?) {
        activeThemePreference = SystemBarStyleHelper.normalizeTheme(rawTheme)
        val spec = getCurrentBarStyleSpec()
        val window = getWindow() ?: return
        val decorView = window.decorView
        decorView.setBackgroundColor(spec.backgroundColor)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            window.statusBarColor = spec.backgroundColor
            window.navigationBarColor = spec.backgroundColor
        }
        val controller = WindowCompat.getInsetsController(window, decorView)
        controller.isAppearanceLightStatusBars = spec.appearanceLightBars
        controller.isAppearanceLightNavigationBars = spec.appearanceLightBars
        connectionErrorOverlay?.let { overlay ->
            overlay.setBackgroundColor(spec.backgroundColor)
            val fg = if (spec.dark) 0xFFF2F0EE.toInt() else 0xFF1E302B.toInt()
            val muted = if (spec.dark) 0xFFB1ACA6.toInt() else 0xFF596B63.toInt()
            errorTitleView?.setTextColor(fg)
            errorBodyView?.setTextColor(muted)
        }
    }

    private fun installNativeOverlays() {
        val contentRoot: ViewGroup = findViewById(android.R.id.content) ?: return

        if (loadingProgressBar == null) {
            val bar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal)
            bar.isIndeterminate = true
            bar.visibility = View.VISIBLE
            val heightPx = Math.round(3 * resources.displayMetrics.density)
            val params = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                max(heightPx, 4),
                Gravity.TOP,
            )
            contentRoot.addView(bar, params)
            loadingProgressBar = bar
        }

        if (connectionErrorOverlay == null) {
            val overlay = LayoutInflater.from(this).inflate(R.layout.view_connection_error, contentRoot, false)
            contentRoot.addView(overlay)
            connectionErrorOverlay = overlay
            errorTitleView = overlay.findViewById(R.id.connection_error_title)
            errorBodyView = overlay.findViewById(R.id.connection_error_body)
            val retryButton: Button = overlay.findViewById(R.id.connection_error_retry_button)
            val backButton: Button = overlay.findViewById(R.id.connection_error_back_button)
            errorBackButton = backButton

            retryButton.setOnClickListener { retryLastNavigation() }
            backButton.setOnClickListener { dismissErrorAndGoBack() }
            applySystemBarTheme(activeThemePreference)
        }
    }

    private fun retryLastNavigation() {
        val webView = getBridge()?.webView ?: return
        hideConnectionError()
        onLoadingStateChanged(true)
        val failedUrl = lastFailedUrl
        val target = if (
            failedUrl != null &&
            NavigationPolicy.classify(failedUrl, activeServerUrl) == NavigationPolicy.Decision.ALLOW_IN_WEBVIEW
        ) {
            failedUrl
        } else {
            activeServerUrl
        }
        webView.loadUrl(target)
    }

    private fun dismissErrorAndGoBack() {
        hideConnectionError()
        val webView = getBridge()?.webView
        if (webView != null && webView.canGoBack()) {
            webView.goBack()
        }
    }

    private fun hideConnectionError() {
        connectionErrorOverlay?.visibility = View.GONE
    }

    private fun isConnectionErrorVisible(): Boolean =
        connectionErrorOverlay?.visibility == View.VISIBLE

    override fun onLoadingStateChanged(loading: Boolean) {
        runOnUiThread {
            loadingProgressBar?.visibility = if (loading) View.VISIBLE else View.GONE
        }
    }

    override fun onMainFrameLoaded() {
        runOnUiThread { hideConnectionError() }
    }

    override fun onFallbackThemeObserved(theme: String) {
        runOnUiThread { applySystemBarTheme(theme) }
    }

    override fun onMainFrameError(kind: RunNoteWebViewClient.ErrorKind, failedUrl: String) {
        runOnUiThread {
            lastFailedUrl = failedUrl
            val overlay = connectionErrorOverlay ?: return@runOnUiThread
            val titleView = errorTitleView!!
            val bodyView = errorBodyView!!
            when (kind) {
                RunNoteWebViewClient.ErrorKind.OFFLINE -> {
                    titleView.setText(R.string.connection_error_offline_title)
                    bodyView.setText(R.string.connection_error_offline_body)
                }
                RunNoteWebViewClient.ErrorKind.TLS -> {
                    titleView.setText(R.string.connection_error_tls_title)
                    bodyView.setText(R.string.connection_error_tls_body)
                }
                RunNoteWebViewClient.ErrorKind.UNREACHABLE -> {
                    titleView.setText(R.string.connection_error_unreachable_title)
                    bodyView.setText(R.string.connection_error_unreachable_body)
                }
            }
            val canGoBack = getBridge()?.webView?.canGoBack() == true
            errorBackButton?.visibility = if (canGoBack) View.VISIBLE else View.GONE
            overlay.visibility = View.VISIBLE
        }
    }

    override fun isDeviceOnline(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager? ?: return true
        val active = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(active)
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun showStandaloneConfigError() {
        setContentView(R.layout.view_connection_error)
        findViewById<View>(R.id.connection_error_overlay)?.visibility = View.VISIBLE
        findViewById<TextView>(R.id.connection_error_title)?.setText(R.string.connection_error_config_title)
        findViewById<TextView>(R.id.connection_error_body)?.setText(R.string.connection_error_config_body)
        findViewById<Button>(R.id.connection_error_retry_button)?.visibility = View.GONE
    }

    private fun installBackFallback(webView: WebView) {
        // Runs ahead of Capacitor AppPlugin's callback so pages without JS backButton listeners
        // (older web deployments, offline/error overlays, pre-hydration) still close overlays,
        // navigate back cleanly, or exit instead of swallowing Back.
        val callback = object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (isConnectionErrorVisible()) {
                    val action = BackNavigationHelper.decide(
                        null,
                        webView.canGoBack(),
                        true,
                    )
                    if (action == BackNavigationHelper.Action.DISMISS_ERROR_AND_GO_BACK) {
                        dismissErrorAndGoBack()
                    } else {
                        finish()
                    }
                    return
                }
                if (backEvaluationInFlight) {
                    return
                }
                backEvaluationInFlight = true
                webView.evaluateJavascript(FALLBACK_BACK_DISMISS_JS) { rawResult ->
                    backEvaluationInFlight = false
                    if (isFinishing || isDestroyed) {
                        return@evaluateJavascript
                    }
                    val action = BackNavigationHelper.decide(
                        rawResult,
                        webView.canGoBack(),
                        false,
                    )
                    when (action) {
                        BackNavigationHelper.Action.DELEGATE_TO_JS -> {
                            isEnabled = false
                            onBackPressedDispatcher.onBackPressed()
                            isEnabled = true
                        }
                        BackNavigationHelper.Action.CONSUMED_BY_OVERLAY -> Unit
                        BackNavigationHelper.Action.GO_BACK -> webView.goBack()
                        BackNavigationHelper.Action.EXIT_APP,
                        BackNavigationHelper.Action.DISMISS_ERROR_AND_GO_BACK,
                        -> finish()
                    }
                }
            }
        }
        onBackPressedDispatcher.addCallback(this, callback)
    }

    private fun showWebViewUpgradeScreen(status: WebViewSupport.Status) {
        setContentView(R.layout.activity_webview_upgrade)

        val bodyView: TextView = findViewById(R.id.webview_upgrade_body)
        val detectedView: TextView = findViewById(R.id.webview_upgrade_detected)
        val statusView: TextView = findViewById(R.id.webview_upgrade_status)
        val updateButton: Button = findViewById(R.id.webview_upgrade_update_button)
        val settingsButton: Button = findViewById(R.id.webview_upgrade_settings_button)
        val retryButton: Button = findViewById(R.id.webview_upgrade_retry_button)

        bodyView.text = getString(R.string.webview_upgrade_body, status.minRequiredMajor)
        if (status.packageName != null && status.versionName != null) {
            detectedView.text = getString(R.string.webview_upgrade_detected, status.versionName, status.packageName)
        } else {
            detectedView.setText(R.string.webview_upgrade_missing)
        }

        val targetPackage = WebViewSupport.resolveUpdatePackage(status.packageName)
        updateButton.setOnClickListener {
            if (!openWebViewStore(targetPackage)) {
                statusView.setText(R.string.webview_upgrade_no_store)
                statusView.visibility = View.VISIBLE
            }
        }

        settingsButton.setOnClickListener {
            if (!openPackageSettings(targetPackage)) {
                statusView.setText(R.string.webview_upgrade_no_store)
                statusView.visibility = View.VISIBLE
            }
        }

        retryButton.setOnClickListener {
            val latest = WebViewSupport.inspect(this, status.minRequiredMajor)
            if (latest.supported) {
                recreate()
            } else {
                val label = latest.versionName ?: "未知"
                statusView.text = getString(R.string.webview_upgrade_still_unsupported, label)
                statusView.visibility = View.VISIBLE
            }
        }
    }

    private fun openWebViewStore(packageName: String): Boolean {
        val marketIntent = Intent(
            Intent.ACTION_VIEW,
            ("market://details?id=" + Uri.encode(packageName)).toUri(),
        )
        marketIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            startActivity(marketIntent)
            return true
        } catch (_: ActivityNotFoundException) {
            val webIntent = Intent(
                Intent.ACTION_VIEW,
                ("https://play.google.com/store/apps/details?id=" + Uri.encode(packageName)).toUri(),
            )
            webIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                startActivity(webIntent)
                return true
            } catch (_: ActivityNotFoundException) {
                return openPackageSettings(packageName)
            }
        }
    }

    private fun openPackageSettings(packageName: String): Boolean {
        val settingsIntent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", packageName, null),
        )
        settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            startActivity(settingsIntent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }

    private companion object {
        const val FALLBACK_BACK_DISMISS_JS: String =
            "(function(){" +
                "if(window.__runnoteBackBridgeActive){return 'delegated';}" +
                "var ds=document.querySelectorAll('dialog[open]');" +
                "if(ds.length){var d=ds[ds.length-1];var e=new Event('cancel',{cancelable:true});d.dispatchEvent(e);" +
                "if(!e.defaultPrevented&&typeof d.close==='function'){d.close();}return 'overlay';}" +
                "try{var ps=document.querySelectorAll('[popover]:popover-open');" +
                "if(ps.length){var p=ps[ps.length-1];if(typeof p.hidePopover==='function'){p.hidePopover();return 'overlay';}}}catch(_){}" +
                "if(document.querySelector('#app-navigation.nav-open,#public-mobile-menu')){" +
                "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return 'overlay';}" +
                "return 'navigate';" +
                "})();"
    }
}
