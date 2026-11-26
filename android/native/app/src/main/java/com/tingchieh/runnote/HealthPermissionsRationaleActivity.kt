package com.tingchieh.runnote

import android.os.Bundle
import android.widget.Button
import androidx.appcompat.app.AppCompatActivity

/**
 * Displays RunNote's read-only Health Connect privacy rationale when invoked from Android
 * Health Connect permission settings (Android 10-13 ACTION_SHOW_PERMISSIONS_RATIONALE and
 * Android 14+ VIEW_PERMISSION_USAGE).
 */
class HealthPermissionsRationaleActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_health_rationale)
        val closeButton: Button? = findViewById(R.id.health_rationale_close_button)
        closeButton?.setOnClickListener { finish() }
    }
}
