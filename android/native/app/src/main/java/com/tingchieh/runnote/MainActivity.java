package com.tingchieh.runnote;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import com.getcapacitor.Logger;

public class MainActivity extends BridgeActivity implements RunNoteWebViewClient.HostCallbacks {

    private static final String FALLBACK_BACK_DISMISS_JS =
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
        "})();";

    private boolean backEvaluationInFlight = false;
    private String activeServerUrl;
    private String lastFailedUrl;
    private String activeThemePreference = "system";
    private View connectionErrorOverlay;
    private TextView errorTitleView;
    private TextView errorBodyView;
    private Button errorBackButton;
    private ProgressBar loadingProgressBar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        applySystemBarTheme(activeThemePreference);
    }

    @Override
    protected void load() {
        CapConfig defaultConfig = CapConfig.loadDefault(this);
        int minMajor = Math.max(
            defaultConfig.getMinWebViewVersion(),
            WebViewSupport.DEFAULT_MIN_CHROMIUM_WEBVIEW_MAJOR
        );
        WebViewSupport.Status status = WebViewSupport.inspect(this, minMajor);
        if (!status.supported) {
            Logger.warn(
                "RunNoteWebView",
                "Unsupported system WebView: package=" +
                    status.packageName +
                    ", version=" +
                    status.versionName +
                    ", required>=" +
                    status.minRequiredMajor
            );
            showWebViewUpgradeScreen(status);
            return;
        }

        ServerUrlPolicy.ValidationResult serverCheck = ServerUrlPolicy.validate(
            BuildConfig.RUNNOTE_SERVER_URL,
            BuildConfig.DEBUG
        );
        if (!serverCheck.valid) {
            Logger.error("RunNoteConfig", "Invalid server URL configuration: " + serverCheck.reason, null);
            showStandaloneConfigError();
            return;
        }
        activeServerUrl = serverCheck.normalizedUrl;

        this.config = new CapConfig.Builder(this)
            .setServerUrl(activeServerUrl)
            .setAllowMixedContent(false)
            .setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
            .setLoggingEnabled(BuildConfig.DEBUG)
            .create();

        registerPlugin(SystemAppearancePlugin.class);
        registerPlugin(HealthDataPlugin.class);
        registerPlugin(LocationRecorderPlugin.class);
        super.load();

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            installNativeOverlays();
            getBridge().setWebViewClient(new RunNoteWebViewClient(getBridge(), this, activeServerUrl, this));
            webView.setWebChromeClient(new RunNoteWebChromeClient(getBridge()));
            installBackFallback(webView);
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applySystemBarTheme(activeThemePreference);
    }

    @Override
    public void onPause() {
        super.onPause();
        flushCookies();
    }

    @Override
    public void onStop() {
        super.onStop();
        flushCookies();
    }

    private void flushCookies() {
        if (getBridge() != null) {
            CookieManager.getInstance().flush();
        }
    }

    public SystemBarStyleHelper.StyleSpec getCurrentBarStyleSpec() {
        int nightMask = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        boolean systemNight = nightMask == Configuration.UI_MODE_NIGHT_YES;
        return SystemBarStyleHelper.resolve(activeThemePreference, systemNight);
    }

    @SuppressWarnings("deprecation")
    public void applySystemBarTheme(String rawTheme) {
        activeThemePreference = SystemBarStyleHelper.normalizeTheme(rawTheme);
        SystemBarStyleHelper.StyleSpec spec = getCurrentBarStyleSpec();
        Window window = getWindow();
        if (window == null) {
            return;
        }
        View decorView = window.getDecorView();
        decorView.setBackgroundColor(spec.backgroundColor);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            window.setStatusBarColor(spec.backgroundColor);
            window.setNavigationBarColor(spec.backgroundColor);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decorView);
        if (controller != null) {
            controller.setAppearanceLightStatusBars(spec.appearanceLightBars);
            controller.setAppearanceLightNavigationBars(spec.appearanceLightBars);
        }
        if (connectionErrorOverlay != null) {
            connectionErrorOverlay.setBackgroundColor(spec.backgroundColor);
            int fg = spec.dark ? 0xFFF2F0EE : 0xFF1E302B;
            int muted = spec.dark ? 0xFFB1ACA6 : 0xFF596B63;
            if (errorTitleView != null) {
                errorTitleView.setTextColor(fg);
            }
            if (errorBodyView != null) {
                errorBodyView.setTextColor(muted);
            }
        }
    }

    private void installNativeOverlays() {
        ViewGroup contentRoot = findViewById(android.R.id.content);
        if (contentRoot == null) {
            return;
        }

        if (loadingProgressBar == null) {
            ProgressBar bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
            bar.setIndeterminate(true);
            bar.setVisibility(View.VISIBLE);
            int heightPx = Math.round(3 * getResources().getDisplayMetrics().density);
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                Math.max(heightPx, 4),
                Gravity.TOP
            );
            contentRoot.addView(bar, params);
            loadingProgressBar = bar;
        }

        if (connectionErrorOverlay == null) {
            View overlay = LayoutInflater.from(this).inflate(R.layout.view_connection_error, contentRoot, false);
            contentRoot.addView(overlay);
            connectionErrorOverlay = overlay;
            errorTitleView = overlay.findViewById(R.id.connection_error_title);
            errorBodyView = overlay.findViewById(R.id.connection_error_body);
            Button retryButton = overlay.findViewById(R.id.connection_error_retry_button);
            errorBackButton = overlay.findViewById(R.id.connection_error_back_button);

            retryButton.setOnClickListener((v) -> retryLastNavigation());
            errorBackButton.setOnClickListener((v) -> dismissErrorAndGoBack());
            applySystemBarTheme(activeThemePreference);
        }
    }

    private void retryLastNavigation() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        hideConnectionError();
        onLoadingStateChanged(true);
        WebView webView = getBridge().getWebView();
        String target = (lastFailedUrl != null && NavigationPolicy.classify(lastFailedUrl, activeServerUrl) == NavigationPolicy.Decision.ALLOW_IN_WEBVIEW)
            ? lastFailedUrl
            : activeServerUrl;
        webView.loadUrl(target);
    }

    private void dismissErrorAndGoBack() {
        hideConnectionError();
        if (getBridge() != null && getBridge().getWebView() != null && getBridge().getWebView().canGoBack()) {
            getBridge().getWebView().goBack();
        }
    }

    private void hideConnectionError() {
        if (connectionErrorOverlay != null) {
            connectionErrorOverlay.setVisibility(View.GONE);
        }
    }

    private boolean isConnectionErrorVisible() {
        return connectionErrorOverlay != null && connectionErrorOverlay.getVisibility() == View.VISIBLE;
    }

    @Override
    public void onLoadingStateChanged(boolean loading) {
        runOnUiThread(() -> {
            if (loadingProgressBar != null) {
                loadingProgressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
            }
        });
    }

    @Override
    public void onMainFrameLoaded() {
        runOnUiThread(this::hideConnectionError);
    }

    @Override
    public void onFallbackThemeObserved(String theme) {
        runOnUiThread(() -> applySystemBarTheme(theme));
    }

    @Override
    public void onMainFrameError(RunNoteWebViewClient.ErrorKind kind, String failedUrl) {
        runOnUiThread(() -> {
            lastFailedUrl = failedUrl;
            if (connectionErrorOverlay == null) {
                return;
            }
            if (kind == RunNoteWebViewClient.ErrorKind.OFFLINE) {
                errorTitleView.setText(R.string.connection_error_offline_title);
                errorBodyView.setText(R.string.connection_error_offline_body);
            } else if (kind == RunNoteWebViewClient.ErrorKind.TLS) {
                errorTitleView.setText(R.string.connection_error_tls_title);
                errorBodyView.setText(R.string.connection_error_tls_body);
            } else {
                errorTitleView.setText(R.string.connection_error_unreachable_title);
                errorBodyView.setText(R.string.connection_error_unreachable_body);
            }
            boolean canGoBack = getBridge() != null && getBridge().getWebView() != null && getBridge().getWebView().canGoBack();
            if (errorBackButton != null) {
                errorBackButton.setVisibility(canGoBack ? View.VISIBLE : View.GONE);
            }
            connectionErrorOverlay.setVisibility(View.VISIBLE);
        });
    }

    @Override
    public boolean isDeviceOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) {
            return true;
        }
        Network active = cm.getActiveNetwork();
        if (active == null) {
            return false;
        }
        NetworkCapabilities caps = cm.getNetworkCapabilities(active);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void showStandaloneConfigError() {
        setContentView(R.layout.view_connection_error);
        View overlay = findViewById(R.id.connection_error_overlay);
        if (overlay != null) {
            overlay.setVisibility(View.VISIBLE);
        }
        TextView titleView = findViewById(R.id.connection_error_title);
        TextView bodyView = findViewById(R.id.connection_error_body);
        Button retryButton = findViewById(R.id.connection_error_retry_button);
        if (titleView != null) {
            titleView.setText(R.string.connection_error_config_title);
        }
        if (bodyView != null) {
            bodyView.setText(R.string.connection_error_config_body);
        }
        if (retryButton != null) {
            retryButton.setVisibility(View.GONE);
        }
    }

    private void installBackFallback(WebView webView) {
        // Runs ahead of Capacitor AppPlugin's callback so pages without JS backButton listeners
        // (older web deployments, offline/error overlays, pre-hydration) still close overlays,
        // navigate back cleanly, or exit instead of swallowing Back.
        OnBackPressedCallback callback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (isConnectionErrorVisible()) {
                    BackNavigationHelper.Action action = BackNavigationHelper.decide(
                        null,
                        webView.canGoBack(),
                        true
                    );
                    if (action == BackNavigationHelper.Action.DISMISS_ERROR_AND_GO_BACK) {
                        dismissErrorAndGoBack();
                    } else {
                        finish();
                    }
                    return;
                }
                if (backEvaluationInFlight) {
                    return;
                }
                backEvaluationInFlight = true;
                webView.evaluateJavascript(FALLBACK_BACK_DISMISS_JS, (rawResult) -> {
                    backEvaluationInFlight = false;
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }
                    BackNavigationHelper.Action action = BackNavigationHelper.decide(
                        rawResult,
                        webView.canGoBack(),
                        false
                    );
                    switch (action) {
                        case DELEGATE_TO_JS:
                            setEnabled(false);
                            getOnBackPressedDispatcher().onBackPressed();
                            setEnabled(true);
                            return;
                        case CONSUMED_BY_OVERLAY:
                            return;
                        case GO_BACK:
                            webView.goBack();
                            return;
                        case EXIT_APP:
                        default:
                            finish();
                    }
                });
            }
        };
        getOnBackPressedDispatcher().addCallback(this, callback);
    }

    private void showWebViewUpgradeScreen(WebViewSupport.Status status) {
        setContentView(R.layout.activity_webview_upgrade);

        TextView bodyView = findViewById(R.id.webview_upgrade_body);
        TextView detectedView = findViewById(R.id.webview_upgrade_detected);
        TextView statusView = findViewById(R.id.webview_upgrade_status);
        Button updateButton = findViewById(R.id.webview_upgrade_update_button);
        Button settingsButton = findViewById(R.id.webview_upgrade_settings_button);
        Button retryButton = findViewById(R.id.webview_upgrade_retry_button);

        bodyView.setText(getString(R.string.webview_upgrade_body, status.minRequiredMajor));
        if (status.packageName != null && status.versionName != null) {
            detectedView.setText(
                getString(R.string.webview_upgrade_detected, status.versionName, status.packageName)
            );
        } else {
            detectedView.setText(R.string.webview_upgrade_missing);
        }

        String targetPackage = WebViewSupport.resolveUpdatePackage(status.packageName);
        updateButton.setOnClickListener((view) -> {
            if (!openWebViewStore(targetPackage)) {
                statusView.setText(R.string.webview_upgrade_no_store);
                statusView.setVisibility(View.VISIBLE);
            }
        });

        settingsButton.setOnClickListener((view) -> {
            if (!openPackageSettings(targetPackage)) {
                statusView.setText(R.string.webview_upgrade_no_store);
                statusView.setVisibility(View.VISIBLE);
            }
        });

        retryButton.setOnClickListener((view) -> {
            WebViewSupport.Status latest = WebViewSupport.inspect(this, status.minRequiredMajor);
            if (latest.supported) {
                recreate();
            } else {
                String label = latest.versionName != null ? latest.versionName : "未知";
                statusView.setText(getString(R.string.webview_upgrade_still_unsupported, label));
                statusView.setVisibility(View.VISIBLE);
            }
        });
    }

    private boolean openWebViewStore(String packageName) {
        Intent marketIntent = new Intent(
            Intent.ACTION_VIEW,
            Uri.parse("market://details?id=" + Uri.encode(packageName))
        );
        marketIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(marketIntent);
            return true;
        } catch (ActivityNotFoundException ignored) {
            Intent webIntent = new Intent(
                Intent.ACTION_VIEW,
                Uri.parse("https://play.google.com/store/apps/details?id=" + Uri.encode(packageName))
            );
            webIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivity(webIntent);
                return true;
            } catch (ActivityNotFoundException secondIgnored) {
                return openPackageSettings(packageName);
            }
        }
    }

    private boolean openPackageSettings(String packageName) {
        Intent settingsIntent = new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", packageName, null)
        );
        settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(settingsIntent);
            return true;
        } catch (ActivityNotFoundException ignored) {
            return false;
        }
    }
}
