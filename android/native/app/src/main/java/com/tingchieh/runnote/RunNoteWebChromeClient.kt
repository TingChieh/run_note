package com.tingchieh.runnote

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.webkit.MimeTypeMap
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import com.getcapacitor.Bridge
import com.getcapacitor.BridgeWebChromeClient

class RunNoteWebChromeClient(bridge: Bridge) : BridgeWebChromeClient(bridge) {

    private var pendingFileCallback: ValueCallback<Array<Uri?>?>? = null
    private val filePickerLauncher: ActivityResultLauncher<Intent> = bridge.registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { activityResult -> handlePickerResult(activityResult) }

    override fun onShowFileChooser(
        webView: WebView?,
        filePathCallback: ValueCallback<Array<Uri?>?>?,
        fileChooserParams: FileChooserParams,
    ): Boolean {
        val acceptTypes = fileChooserParams.acceptTypes.asList()
        val captureEnabled = fileChooserParams.isCaptureEnabled
        if (captureEnabled && ("image/*" in acceptTypes || "video/*" in acceptTypes)) {
            return super.onShowFileChooser(webView, filePathCallback, fileChooserParams)
        }

        pendingFileCallback?.let {
            it.onReceiveValue(null)
            pendingFileCallback = null
        }

        val allowMultiple = fileChooserParams.mode == FileChooserParams.MODE_OPEN_MULTIPLE
        val mimeMap = MimeTypeMap.getSingleton()
        val plan = FilePickerIntentHelper.buildPlan(
            fileChooserParams.acceptTypes,
            allowMultiple,
            mimeMap::getMimeTypeFromExtension,
        )
        val intent = FilePickerIntentHelper.applyToIntent(fileChooserParams.createIntent(), plan)

        pendingFileCallback = filePathCallback
        try {
            filePickerLauncher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            pendingFileCallback = null
            filePathCallback?.onReceiveValue(null)
        }
        return true
    }

    private fun handlePickerResult(activityResult: ActivityResult) {
        val callback = pendingFileCallback
        pendingFileCallback = null
        if (callback == null) {
            return
        }

        val data: Intent? = activityResult.data
        val clipData = data?.clipData
        val uris: Array<Uri?>? = if (activityResult.resultCode == Activity.RESULT_OK && clipData != null) {
            Array<Uri?>(clipData.itemCount) { i -> clipData.getItemAt(i).uri }
        } else {
            WebChromeClient.FileChooserParams.parseResult(activityResult.resultCode, data)
        }
        callback.onReceiveValue(uris)
    }
}
