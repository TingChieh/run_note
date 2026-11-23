package org.runnote.phasezero;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.Arrays;
import java.util.List;

public class RunNoteWebChromeClient extends BridgeWebChromeClient {

    private final ActivityResultLauncher<Intent> filePickerLauncher;
    private ValueCallback<Uri[]> pendingFileCallback;

    public RunNoteWebChromeClient(Bridge bridge) {
        super(bridge);
        this.filePickerLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            this::handlePickerResult
        );
    }

    @Override
    public boolean onShowFileChooser(
        WebView webView,
        ValueCallback<Uri[]> filePathCallback,
        FileChooserParams fileChooserParams
    ) {
        List<String> acceptTypes = Arrays.asList(fileChooserParams.getAcceptTypes());
        boolean captureEnabled = fileChooserParams.isCaptureEnabled();
        if (captureEnabled && (acceptTypes.contains("image/*") || acceptTypes.contains("video/*"))) {
            return super.onShowFileChooser(webView, filePathCallback, fileChooserParams);
        }

        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }

        boolean allowMultiple = fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
        MimeTypeMap mimeMap = MimeTypeMap.getSingleton();
        FilePickerIntentHelper.Plan plan = FilePickerIntentHelper.buildPlan(
            fileChooserParams.getAcceptTypes(),
            allowMultiple,
            mimeMap::getMimeTypeFromExtension
        );
        Intent intent = FilePickerIntentHelper.applyToIntent(fileChooserParams.createIntent(), plan);

        pendingFileCallback = filePathCallback;
        try {
            filePickerLauncher.launch(intent);
        } catch (ActivityNotFoundException ex) {
            pendingFileCallback = null;
            filePathCallback.onReceiveValue(null);
        }
        return true;
    }

    private void handlePickerResult(ActivityResult activityResult) {
        ValueCallback<Uri[]> callback = pendingFileCallback;
        pendingFileCallback = null;
        if (callback == null) {
            return;
        }

        Intent data = activityResult.getData();
        Uri[] uris;
        if (activityResult.getResultCode() == Activity.RESULT_OK && data != null && data.getClipData() != null) {
            ClipData clipData = data.getClipData();
            uris = new Uri[clipData.getItemCount()];
            for (int i = 0; i < clipData.getItemCount(); i++) {
                uris[i] = clipData.getItemAt(i).getUri();
            }
        } else {
            uris = WebChromeClient.FileChooserParams.parseResult(activityResult.getResultCode(), data);
        }
        callback.onReceiveValue(uris);
    }
}
