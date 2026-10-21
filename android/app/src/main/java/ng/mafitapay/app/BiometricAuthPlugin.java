package ng.mafitapay.app;

import android.app.Activity;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;

import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.cert.Certificate;

/**
 * Fingerprint + face unlock via AndroidX BiometricPrompt.
 *
 * Uses BIOMETRIC_WEAK so Class 2 face unlock and Class 3 fingerprints both work.
 * (BIOMETRIC_STRONG alone rejects most face unlock and some OEM fingerprints.)
 */
@CapacitorPlugin(name = "BiometricAuth")
public class BiometricAuthPlugin extends Plugin {
    private static final int AUTHENTICATORS =
        BiometricManager.Authenticators.BIOMETRIC_STRONG
            | BiometricManager.Authenticators.BIOMETRIC_WEAK;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        BiometricManager manager = BiometricManager.from(getContext());
        int status = manager.canAuthenticate(AUTHENTICATORS);

        if (status != BiometricManager.BIOMETRIC_SUCCESS) {
            int weakOnly = manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK);
            if (weakOnly == BiometricManager.BIOMETRIC_SUCCESS) {
                status = weakOnly;
            } else {
                int strongOnly = manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
                if (strongOnly == BiometricManager.BIOMETRIC_SUCCESS) {
                    status = strongOnly;
                }
            }
        }

        JSObject ret = new JSObject();
        ret.put("available", status == BiometricManager.BIOMETRIC_SUCCESS);
        ret.put("status", status);
        ret.put("statusLabel", statusLabel(status));
        call.resolve(ret);
    }

    @PluginMethod
    public void isTransactionBiometricAvailable(PluginCall call) {
        int status = BiometricManager.from(getContext()).canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG
        );
        JSObject ret = new JSObject();
        ret.put("available", status == BiometricManager.BIOMETRIC_SUCCESS);
        ret.put("status", status);
        ret.put("statusLabel", statusLabel(status));
        call.resolve(ret);
    }

    @PluginMethod
    public void createKeyAndSign(PluginCall call) {
        String deviceId = call.getString("deviceId", "");
        String challenge = call.getString("challenge", "");
        if (!deviceId.matches("mfp_[a-f0-9]{32}") || challenge.isEmpty()) {
            call.reject("Native biometric enrollment request is invalid.");
            return;
        }
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_EC,
                "AndroidKeyStore"
            );
            KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
                keyAlias(deviceId),
                KeyProperties.PURPOSE_SIGN
            )
                .setAlgorithmParameterSpec(new java.security.spec.ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setAttestationChallenge(challenge.getBytes(StandardCharsets.UTF_8))
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
            } else {
                spec.setUserAuthenticationValidityDurationSeconds(-1);
            }
            generator.initialize(spec.build());
            KeyPair pair = generator.generateKeyPair();
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            Certificate[] certificateChain = keyStore.getCertificateChain(keyAlias(deviceId));
            if (certificateChain == null || certificateChain.length == 0) {
                call.reject("This device cannot provide a verifiable biometric key attestation.");
                return;
            }
            String[] encodedChain = new String[certificateChain.length];
            for (int index = 0; index < certificateChain.length; index++) {
                encodedChain[index] = Base64.encodeToString(
                    certificateChain[index].getEncoded(),
                    Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING
                );
            }
            Signature signature = Signature.getInstance("SHA256withECDSA");
            signature.initSign(pair.getPrivate());
            promptForSignature(call, deviceId, challenge, signature, pair.getPublic().getEncoded(), encodedChain);
        } catch (Exception e) {
            call.reject(messageOrDefault(e, "Could not create the protected biometric key."));
        }
    }

    @PluginMethod
    public void signChallenge(PluginCall call) {
        String deviceId = call.getString("deviceId", "");
        String challenge = call.getString("challenge", "");
        if (!deviceId.matches("mfp_[a-f0-9]{32}") || challenge.isEmpty()) {
            call.reject("Native biometric approval request is invalid.");
            return;
        }
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            PrivateKey privateKey = (PrivateKey) keyStore.getKey(keyAlias(deviceId), null);
            if (privateKey == null) {
                call.reject("This device key is unavailable. Enroll transaction biometrics again.");
                return;
            }
            Signature signature = Signature.getInstance("SHA256withECDSA");
            signature.initSign(privateKey);
            promptForSignature(call, deviceId, challenge, signature, null, null);
        } catch (Exception e) {
            call.reject(messageOrDefault(e, "Could not access the protected biometric key."));
        }
    }

    @PluginMethod
    public void deleteTransactionKey(PluginCall call) {
        String deviceId = call.getString("deviceId", "");
        if (!deviceId.matches("mfp_[a-f0-9]{32}")) {
            call.reject("Native biometric device identifier is invalid.");
            return;
        }
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            keyStore.deleteEntry(keyAlias(deviceId));
            call.resolve();
        } catch (Exception e) {
            call.reject(messageOrDefault(e, "Could not remove the device key."));
        }
    }

    @PluginMethod
    public void listTransactionKeys(PluginCall call) {
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            java.util.Enumeration<String> aliases = keyStore.aliases();
            JSArray deviceIds = new JSArray();
            String prefix = "mafitapay_tx_";
            while (aliases.hasMoreElements()) {
                String alias = aliases.nextElement();
                if (alias.startsWith(prefix) && alias.length() == prefix.length() + 32) {
                    deviceIds.put("mfp_" + alias.substring(prefix.length()));
                }
            }
            JSObject ret = new JSObject();
            ret.put("deviceIds", deviceIds);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(messageOrDefault(e, "Could not read device biometric keys."));
        }
    }

    private static String keyAlias(String deviceId) {
        return "mafitapay_tx_" + deviceId.substring(4);
    }

    private static String messageOrDefault(Exception error, String fallback) {
        return error.getMessage() != null ? error.getMessage() : fallback;
    }

    private void promptForSignature(
        PluginCall call,
        String deviceId,
        String challenge,
        Signature signature,
        byte[] encodedPublicKey,
        String[] encodedCertificateChain
    ) {
        Activity activity = getActivity();
        if (!(activity instanceof FragmentActivity)) {
            call.reject("Biometric prompt requires an active activity.");
            return;
        }
        FragmentActivity fragmentActivity = (FragmentActivity) activity;
        call.setKeepAlive(true);
        AtomicBoolean finished = new AtomicBoolean(false);
        fragmentActivity.runOnUiThread(() -> {
            try {
                BiometricPrompt prompt = new BiometricPrompt(
                    fragmentActivity,
                    ContextCompat.getMainExecutor(fragmentActivity),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                            if (!finished.compareAndSet(false, true)) return;
                            try {
                                Signature authorized = result.getCryptoObject() != null
                                    ? result.getCryptoObject().getSignature()
                                    : null;
                                if (authorized == null) throw new IllegalStateException("Biometric signature was not authorized.");
                                authorized.update(challenge.getBytes(StandardCharsets.UTF_8));
                                byte[] signed = authorized.sign();
                                JSObject ret = new JSObject();
                                ret.put("deviceId", deviceId);
                                ret.put("signature", Base64.encodeToString(signed, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING));
                                if (encodedPublicKey != null) {
                                    ret.put("publicKey", Base64.encodeToString(encodedPublicKey, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING));
                                    JSONArray chain = new JSONArray();
                                    for (String certificate : encodedCertificateChain) chain.put(certificate);
                                    ret.put("certificateChain", chain);
                                }
                                call.resolve(ret);
                            } catch (Exception e) {
                                call.reject(messageOrDefault(e, "Could not sign the biometric challenge."));
                            }
                        }

                        @Override
                        public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                            if (finished.compareAndSet(false, true)) call.reject(errString.toString());
                        }

                        @Override
                        public void onAuthenticationFailed() {
                            // Keep Android's biometric retry prompt open.
                        }
                    }
                );
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(encodedPublicKey != null ? "Enable transaction biometrics" : "Confirm transaction")
                    .setSubtitle(encodedPublicKey != null ? "Protect this device" : "Verify to approve")
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .setConfirmationRequired(false)
                    .setNegativeButtonText("Cancel")
                    .build();
                prompt.authenticate(info, new BiometricPrompt.CryptoObject(signature));
            } catch (Exception e) {
                if (finished.compareAndSet(false, true)) call.reject(messageOrDefault(e, "Could not start biometric verification."));
            }
        });
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        Activity activity = getActivity();
        if (!(activity instanceof FragmentActivity)) {
            call.reject("Biometric prompt requires an active activity.");
            return;
        }

        final FragmentActivity fragmentActivity = (FragmentActivity) activity;
        final int authenticators = resolveAuthenticators();
        if (authenticators == 0) {
            call.reject("Biometric verification is not available on this device.");
            return;
        }

        call.setKeepAlive(true);

        final String title = call.getString("title", "Verify identity");
        final String subtitle = call.getString("subtitle", "Use fingerprint or face to continue");
        final String description = call.getString("description", "");
        final AtomicBoolean finished = new AtomicBoolean(false);

        fragmentActivity.runOnUiThread(() -> {
            try {
                Executor executor = ContextCompat.getMainExecutor(fragmentActivity);
                BiometricPrompt prompt = new BiometricPrompt(
                    fragmentActivity,
                    executor,
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(
                            @NonNull BiometricPrompt.AuthenticationResult result
                        ) {
                            if (!finished.compareAndSet(false, true)) return;
                            JSObject ret = new JSObject();
                            ret.put("verified", true);
                            call.resolve(ret);
                        }

                        @Override
                        public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                            if (!finished.compareAndSet(false, true)) return;
                            boolean cancelled =
                                errorCode == BiometricPrompt.ERROR_USER_CANCELED
                                    || errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                                    || errorCode == BiometricPrompt.ERROR_CANCELED;
                            JSObject ret = new JSObject();
                            ret.put("verified", false);
                            ret.put("cancelled", cancelled);
                            ret.put("errorCode", errorCode);
                            ret.put("message", errString.toString());
                            call.resolve(ret);
                        }

                        @Override
                        public void onAuthenticationFailed() {
                            // Wrong finger/face — keep prompt open for Android retry UI.
                        }
                    }
                );

                BiometricPrompt.PromptInfo.Builder builder = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title != null ? title : "Verify identity")
                    .setSubtitle(
                        subtitle != null && !subtitle.isEmpty()
                            ? subtitle
                            : "Use fingerprint or face to continue"
                    )
                    .setAllowedAuthenticators(authenticators)
                    .setConfirmationRequired(false)
                    .setNegativeButtonText("Cancel");

                if (description != null && !description.isEmpty()) {
                    builder.setDescription(description);
                }

                prompt.authenticate(builder.build());
            } catch (Exception e) {
                if (finished.compareAndSet(false, true)) {
                    call.reject(
                        e.getMessage() != null
                            ? e.getMessage()
                            : "Could not start biometric verification"
                    );
                }
            }
        });
    }

    private int resolveAuthenticators() {
        BiometricManager manager = BiometricManager.from(getContext());
        if (manager.canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS) {
            return AUTHENTICATORS;
        }
        if (
            manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
                == BiometricManager.BIOMETRIC_SUCCESS
        ) {
            return BiometricManager.Authenticators.BIOMETRIC_WEAK;
        }
        if (
            manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                == BiometricManager.BIOMETRIC_SUCCESS
        ) {
            return BiometricManager.Authenticators.BIOMETRIC_STRONG;
        }
        return 0;
    }

    private static String statusLabel(int status) {
        switch (status) {
            case BiometricManager.BIOMETRIC_SUCCESS:
                return "success";
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
                return "no_hardware";
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                return "hw_unavailable";
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                return "none_enrolled";
            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED:
                return "security_update_required";
            case BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED:
                return "unsupported";
            case BiometricManager.BIOMETRIC_STATUS_UNKNOWN:
                return "unknown";
            default:
                return "status_" + status;
        }
    }
}
