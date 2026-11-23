package org.runnote.phasezero;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.view.View;
import android.webkit.CookieManager;
import android.widget.Button;
import android.widget.TextView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import com.getcapacitor.Logger;

public class MainActivity extends BridgeActivity {

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
            getBridge().getWebView().setWebChromeClient(new RunNoteWebChromeClient(getBridge()));
        }
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
