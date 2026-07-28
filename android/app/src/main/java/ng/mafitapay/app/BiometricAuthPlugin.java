package ng.mafitapay.app;

import android.app.Activity;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;

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
