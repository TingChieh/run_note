package org.runnote.phasezero;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import com.getcapacitor.Logger;

public class MainActivity extends BridgeActivity {

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

    @Override
    protected void load() {
        CapConfig loadedConfig = config != null ? config : CapConfig.loadDefault(this);
        int minMajor = Math.max(
            loadedConfig.getMinWebViewVersion(),
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

        super.load();
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.setWebChromeClient(new RunNoteWebChromeClient(getBridge()));
            installBackFallback(webView);
        }
    }

    private void installBackFallback(WebView webView) {
        // Runs ahead of Capacitor AppPlugin's callback so pages without JS backButton listeners
        // (older web deployments, offline/503 pages, pre-hydration) still close overlays, go back,
        // and exit cleanly when no history remains instead of swallowing Back.
        OnBackPressedCallback callback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (backEvaluationInFlight) {
                    return;
                }
                backEvaluationInFlight = true;
                webView.evaluateJavascript(FALLBACK_BACK_DISMISS_JS, (rawResult) -> {
                    backEvaluationInFlight = false;
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }
                    if ("\"delegated\"".equals(rawResult)) {
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                        setEnabled(true);
                        return;
                    }
                    if ("\"overlay\"".equals(rawResult)) {
                        return;
                    }
                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        finish();
                    }
                });
            }
        };
        getOnBackPressedDispatcher().addCallback(this, callback);
    }

    @Override
    public void onPause() {
        super.onPause();
        if (getBridge() != null) {
            CookieManager.getInstance().flush();
        }
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
