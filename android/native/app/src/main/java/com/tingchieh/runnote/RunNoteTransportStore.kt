package com.tingchieh.runnote

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.util.Locale

class TransportVaultUnavailableException : RuntimeException("Secure transport vault unavailable")

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
 * Tokens never leave native code, never fall back to cleartext storage, and never crash cold start
 * if Keystore/Tink initialization fails (failing closed to SIGNED_OUT).
 */
class EncryptedPrefsTransportVault(private val context: Context) : TransportVault {

    private var initialized = false
    private var prefs: SharedPreferences? = null

    private fun openEncryptedPrefs(): SharedPreferences {
        val appContext = context.applicationContext
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            appContext,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    @Synchronized
    private fun getPrefsOrNull(): SharedPreferences? {
        if (initialized) return prefs
        initialized = true
        prefs = try {
            openEncryptedPrefs()
        } catch (_: GeneralSecurityException) {
            recoverCorruptedPrefs()
        } catch (_: IOException) {
            recoverCorruptedPrefs()
        } catch (_: RuntimeException) {
            recoverCorruptedPrefs()
        }
        return prefs
    }

    private fun recoverCorruptedPrefs(): SharedPreferences? {
        return try {
            context.applicationContext.deleteSharedPreferences(PREFS_NAME)
            openEncryptedPrefs()
        } catch (_: Exception) {
            // Fail closed: never fall back to cleartext SharedPreferences.
            null
        }
    }

    @Synchronized
    override fun read(): TransportSessionSnapshot {
        val store = getPrefsOrNull() ?: return TransportSessionSnapshot.empty()
        return try {
            val serverUrl = store.getString(KEY_SERVER_URL, null)?.takeIf { it.isNotBlank() }
            val storedHash = store.getString(KEY_SERVER_ORIGIN_HASH, null)?.takeIf { it.isNotBlank() }
            val state = SessionLifecycleState.fromWireValue(store.getString(KEY_SESSION_STATE, null))
            TransportSessionSnapshot(
                state = state,
                serverUrl = serverUrl,
                serverOriginHash = storedHash ?: serverUrl?.let { sha256Hex(it) },
                accountId = store.getString(KEY_ACCOUNT_ID, null)?.takeIf { it.isNotBlank() },
                accessToken = store.getString(KEY_ACCESS_TOKEN, null)?.takeIf { it.isNotBlank() },
                accessExpiresAtIso = store.getString(KEY_ACCESS_EXPIRES_AT, null)?.takeIf { it.isNotBlank() },
                refreshToken = store.getString(KEY_REFRESH_TOKEN, null)?.takeIf { it.isNotBlank() },
                refreshExpiresAtIso = store.getString(KEY_REFRESH_EXPIRES_AT, null)?.takeIf { it.isNotBlank() },
                userJson = store.getString(KEY_USER_JSON, null)?.takeIf { it.isNotBlank() },
            )
        } catch (_: Exception) {
            TransportSessionSnapshot.empty()
        }
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
        val store = getPrefsOrNull() ?: throw TransportVaultUnavailableException()
        try {
            val committed = store.edit()
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
            if (!committed) {
                throw TransportVaultUnavailableException()
            }
        } catch (ex: TransportVaultUnavailableException) {
            throw ex
        } catch (_: Exception) {
            throw TransportVaultUnavailableException()
        }
    }

    @Synchronized
    override fun markReauthRequired(preserveServerUrl: String?, preserveAccountId: String?) {
        val store = getPrefsOrNull() ?: return
        try {
            val editor = store.edit()
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
        } catch (_: Exception) {
            // Best-effort cleanup when Keystore is unavailable; never crash.
        }
    }

    @Synchronized
    override fun clearSession(preserveServerUrl: String?) {
        val store = getPrefsOrNull() ?: return
        try {
            val editor = store.edit()
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
        } catch (_: Exception) {
            // Best-effort cleanup when Keystore is unavailable; never crash.
        }
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
