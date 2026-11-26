package com.tingchieh.runnote

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.MessageDigest
import java.util.Locale

enum class SessionLifecycleState(val wireValue: String) {
    ACTIVE("active"),
    REAUTH_REQUIRED("reauth_required"),
    SIGNED_OUT("signed_out"),
    ;

    companion object {
        fun fromWireValue(raw: String?): SessionLifecycleState =
            entries.firstOrNull { it.wireValue == raw } ?: SIGNED_OUT
    }
}

data class TransportSessionSnapshot(
    val state: SessionLifecycleState,
    val serverUrl: String?,
    val serverOriginHash: String?,
    val accountId: String?,
    val accessToken: String?,
    val accessExpiresAtIso: String?,
    val refreshToken: String?,
    val refreshExpiresAtIso: String?,
    val userJson: String?,
) {
    companion object {
        fun empty(serverUrl: String? = null): TransportSessionSnapshot = TransportSessionSnapshot(
            state = SessionLifecycleState.SIGNED_OUT,
            serverUrl = serverUrl,
            serverOriginHash = serverUrl?.let { sha256Hex(it) },
            accountId = null,
            accessToken = null,
            accessExpiresAtIso = null,
            refreshToken = null,
            refreshExpiresAtIso = null,
            userJson = null,
        )
    }
}

interface TransportVault {
    fun read(): TransportSessionSnapshot
    fun saveActiveSession(
        serverUrl: String,
        accountId: String,
        accessToken: String,
        accessExpiresAtIso: String,
        refreshToken: String,
        refreshExpiresAtIso: String,
        userJson: String,
    )
    fun markReauthRequired(preserveServerUrl: String?, preserveAccountId: String?)
    fun clearSession(preserveServerUrl: String?)
}

internal fun sha256Hex(value: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
    val out = StringBuilder(digest.size * 2)
    for (byte in digest) {
        out.append(String.format(Locale.ROOT, "%02x", byte.toInt() and 0xFF))
    }
    return out.toString()
}

/**
 * Hardware-backed Android Keystore credential vault using EncryptedSharedPreferences (AES-256-GCM).
 * Tokens never leave native code and are never exposed to WebView JS, cookies, or logs.
 */
class EncryptedPrefsTransportVault(context: Context) : TransportVault {

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context.applicationContext,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    @Synchronized
    override fun read(): TransportSessionSnapshot {
        val serverUrl = prefs.getString(KEY_SERVER_URL, null)?.takeIf { it.isNotBlank() }
        val storedHash = prefs.getString(KEY_SERVER_ORIGIN_HASH, null)?.takeIf { it.isNotBlank() }
        val state = SessionLifecycleState.fromWireValue(prefs.getString(KEY_SESSION_STATE, null))
        return TransportSessionSnapshot(
            state = state,
            serverUrl = serverUrl,
            serverOriginHash = storedHash ?: serverUrl?.let { sha256Hex(it) },
            accountId = prefs.getString(KEY_ACCOUNT_ID, null)?.takeIf { it.isNotBlank() },
            accessToken = prefs.getString(KEY_ACCESS_TOKEN, null)?.takeIf { it.isNotBlank() },
            accessExpiresAtIso = prefs.getString(KEY_ACCESS_EXPIRES_AT, null)?.takeIf { it.isNotBlank() },
            refreshToken = prefs.getString(KEY_REFRESH_TOKEN, null)?.takeIf { it.isNotBlank() },
            refreshExpiresAtIso = prefs.getString(KEY_REFRESH_EXPIRES_AT, null)?.takeIf { it.isNotBlank() },
            userJson = prefs.getString(KEY_USER_JSON, null)?.takeIf { it.isNotBlank() },
        )
    }

    @Synchronized
    override fun saveActiveSession(
        serverUrl: String,
        accountId: String,
        accessToken: String,
        accessExpiresAtIso: String,
        refreshToken: String,
        refreshExpiresAtIso: String,
        userJson: String,
    ) {
        prefs.edit()
            .putString(KEY_SESSION_STATE, SessionLifecycleState.ACTIVE.wireValue)
            .putString(KEY_SERVER_URL, serverUrl)
            .putString(KEY_SERVER_ORIGIN_HASH, sha256Hex(serverUrl))
            .putString(KEY_ACCOUNT_ID, accountId)
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putString(KEY_ACCESS_EXPIRES_AT, accessExpiresAtIso)
            .putString(KEY_REFRESH_TOKEN, refreshToken)
            .putString(KEY_REFRESH_EXPIRES_AT, refreshExpiresAtIso)
            .putString(KEY_USER_JSON, userJson)
            .commit()
    }

    @Synchronized
    override fun markReauthRequired(preserveServerUrl: String?, preserveAccountId: String?) {
        val editor = prefs.edit()
            .putString(KEY_SESSION_STATE, SessionLifecycleState.REAUTH_REQUIRED.wireValue)
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_ACCESS_EXPIRES_AT)
            .remove(KEY_REFRESH_TOKEN)
            .remove(KEY_REFRESH_EXPIRES_AT)
        if (!preserveServerUrl.isNullOrBlank()) {
            editor.putString(KEY_SERVER_URL, preserveServerUrl)
            editor.putString(KEY_SERVER_ORIGIN_HASH, sha256Hex(preserveServerUrl))
        }
        if (!preserveAccountId.isNullOrBlank()) {
            editor.putString(KEY_ACCOUNT_ID, preserveAccountId)
        }
        editor.commit()
    }

    @Synchronized
    override fun clearSession(preserveServerUrl: String?) {
        val editor = prefs.edit()
            .putString(KEY_SESSION_STATE, SessionLifecycleState.SIGNED_OUT.wireValue)
            .remove(KEY_ACCOUNT_ID)
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_ACCESS_EXPIRES_AT)
            .remove(KEY_REFRESH_TOKEN)
            .remove(KEY_REFRESH_EXPIRES_AT)
            .remove(KEY_USER_JSON)
        if (!preserveServerUrl.isNullOrBlank()) {
            editor.putString(KEY_SERVER_URL, preserveServerUrl)
            editor.putString(KEY_SERVER_ORIGIN_HASH, sha256Hex(preserveServerUrl))
        } else {
            editor.remove(KEY_SERVER_URL)
            editor.remove(KEY_SERVER_ORIGIN_HASH)
        }
        editor.commit()
    }

    private companion object {
        const val PREFS_NAME = "runnote_secure_transport"
        const val KEY_SESSION_STATE = "session_state"
        const val KEY_SERVER_URL = "active_server_url"
        const val KEY_SERVER_ORIGIN_HASH = "server_origin_hash"
        const val KEY_ACCOUNT_ID = "account_id"
        const val KEY_ACCESS_TOKEN = "access_token"
        const val KEY_ACCESS_EXPIRES_AT = "access_expires_at"
        const val KEY_REFRESH_TOKEN = "refresh_token"
        const val KEY_REFRESH_EXPIRES_AT = "refresh_expires_at"
        const val KEY_USER_JSON = "user_json"
    }
}
