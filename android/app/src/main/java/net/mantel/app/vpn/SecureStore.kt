package net.mantel.app.vpn

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureStore(context: Context, prefsName: String) {

    companion object {
        private const val TAG = "MantelSecureStore"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "mantel_secure_v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_BYTES = 12
        private const val TAG_BITS = 128
        private val lock = Any()

        const val PREFS_USER = "mantel_secure"

        const val PREFS_INTERNAL = "mantel_internal"
    }

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(prefsName, Context.MODE_PRIVATE)

    fun get(name: String): String? = synchronized(lock) {
        val stored = prefs.getString(name, null) ?: return null
        try {
            val blob = Base64.decode(stored, Base64.NO_WRAP)
            require(blob.size > IV_BYTES) { "entry too short" }
            val key = existingKey() ?: throw GeneralSecurityException("keystore key missing")
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, blob, 0, IV_BYTES))
            cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
            String(cipher.doFinal(blob, IV_BYTES, blob.size - IV_BYTES), Charsets.UTF_8)
        } catch (e: Exception) {
            Log.w(TAG, "Dropping unreadable entry '$name': ${e.javaClass.simpleName}")
            prefs.edit().remove(name).apply()
            null
        }
    }

    fun set(name: String, value: String) = synchronized(lock) {
        val key = existingKey() ?: createKey()
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
        val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val iv = cipher.iv
        check(iv.size == IV_BYTES) { "unexpected GCM IV length ${iv.size}" }
        val blob = ByteArray(iv.size + ciphertext.size)
        System.arraycopy(iv, 0, blob, 0, iv.size)
        System.arraycopy(ciphertext, 0, blob, iv.size, ciphertext.size)
        prefs.edit().putString(name, Base64.encodeToString(blob, Base64.NO_WRAP)).commit()
        Unit
    }

    fun remove(name: String) = synchronized(lock) {
        prefs.edit().remove(name).commit()
        Unit
    }

    private fun existingKey(): SecretKey? {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        return try {
            (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
        } catch (e: GeneralSecurityException) {
            Log.w(TAG, "Keystore key unusable, recreating: ${e.javaClass.simpleName}")
            ks.deleteEntry(KEY_ALIAS)
            null
        }
    }

    private fun createKey(): SecretKey {
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return generator.generateKey()
    }
}
