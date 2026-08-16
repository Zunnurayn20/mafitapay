package ng.mafitapay.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    private static final String OFFLINE_ASSET = "file:///android_asset/public/offline.html";
    private static final String APP_URL = "https://mafitapay.com/";
    private static final long RESTORE_COOLDOWN_MS = 2500;

    private boolean appInForeground = false;
    private boolean mainFrameNavigationStarted = false;
    private String lastAppUrl = APP_URL;
    private long lastRestoreAt = 0;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onResume() {
        super.onResume();
        appInForeground = true;
        recoverIfNetworkRestored();
    }

    @Override
    public void onPause() {
        appInForeground = false;
        super.onPause();
    }

    @Override
    public void onDestroy() {
        if (connectivity != null && networkCallback != null) {
            try {
                connectivity.unregisterNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) {
            }
        }
        super.onDestroy();
    }

    private boolean hasValidatedNetwork() {
        if (connectivity == null) {
            connectivity = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        }
        if (connectivity == null) return false;

        try {
            Network network = connectivity.getActiveNetwork();
            if (network == null) return false;

            NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(network);
            return capabilities != null
                && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private boolean isOfflineDocument(String url) {
        return url != null && (url.contains("offline.html") || url.startsWith("file:///android_asset/"));
    }

    private boolean isAppDocumentUrl(String url) {
        return url != null && url.contains("mafitapay.com") && !isOfflineDocument(url);
    }

    private void showBrandedOffline(WebView view) {
        if (view == null || isOfflineDocument(view.getUrl())) return;
        view.stopLoading();
        view.loadUrl(OFFLINE_ASSET);
    }

    private void restoreApp(WebView view) {
        if (view == null) return;
        long now = SystemClock.elapsedRealtime();
        if (now - lastRestoreAt < RESTORE_COOLDOWN_MS) return;
        lastRestoreAt = now;
        view.stopLoading();
        view.loadUrl(lastAppUrl != null ? lastAppUrl : APP_URL);
    }

    private void recoverIfNetworkRestored() {
        if (!appInForeground || !hasValidatedNetwork()) return;

        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) return;

        WebView view = bridge.getWebView();
        if (!isOfflineDocument(view.getUrl())) return;
        restoreApp(view);
    }

    /**
     * Capacitor's BridgeWebViewClient always loads server.errorPath on a main-frame error.
     * Sleep / minimize fire those errors even on a full connection. We take over:
     *   - no validated network → branded offline.html (never the WebView default page)
     *   - validated network → keep or restore the app (never an error page)
     */
    private void handleMainFrameError(WebView view) {
        if (hasValidatedNetwork()) {
            if (mainFrameNavigationStarted || isOfflineDocument(view != null ? view.getUrl() : null)) {
                restoreApp(view);
            }
            return;
        }

        if (appInForeground) {
            showBrandedOffline(view);
        }
    }

    private void registerNetworkCallback() {
        if (connectivity == null) return;

        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                mainHandler.post(() -> recoverIfNetworkRestored());
            }

            @Override
            public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) {
                if (capabilities != null
                    && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
                    mainHandler.post(() -> recoverIfNetworkRestored());
                }
            }
        };

        try {
            NetworkRequest request = new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build();
            connectivity.registerNetworkCallback(request, networkCallback);
        } catch (RuntimeException ignored) {
        }
    }

    /**
     * Nothing behind the system navigation bar but our own page.
     *
     * Android 15+ (targetSdk 35+) already lays the WebView out edge-to-edge, but it still paints an
     * 80% scrim tinted like the window background across 3-button navigation, because
     * navigationBarContrastEnforced defaults to true. Gesture navigation ignores both that flag and
     * navigationBarColor. Android 14 and below enforce nothing: the decor still fits system windows
     * (the StatusBar plugin only opts out for the status bar) and the bar keeps its opaque theme
     * colour, so both have to be cleared by hand.
     */
    @SuppressWarnings("deprecation")
    private void makeNavigationBarTransparent() {
        Window window = getWindow();

        // No-op on API 35+, this is what lets the WebView reach under the bar on older releases.
        WindowCompat.setDecorFitsSystemWindows(window, false);

        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setNavigationBarColor(Color.TRANSPARENT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.setNavigationBarDividerColor(Color.TRANSPARENT);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // The one call that removes the 3-button scrim on Android 15+.
            window.setNavigationBarContrastEnforced(false);
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BiometricAuthPlugin.class);
        super.onCreate(savedInstanceState);

        makeNavigationBarTransparent();

        connectivity = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        registerNetworkCallback();

        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) {
            return;
        }

        WebView webView = bridge.getWebView();
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        webView.setWebViewClient(
            new BridgeWebViewClient(bridge) {
                @Override
                public void onPageStarted(WebView view, String url, Bitmap favicon) {
                    mainFrameNavigationStarted = !isOfflineDocument(url);
                    super.onPageStarted(view, url, favicon);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    mainFrameNavigationStarted = false;
                    if (isAppDocumentUrl(url)) {
                        lastAppUrl = url;
                    }
                }

                @Override
                public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error
                ) {
                    if (request != null && request.isForMainFrame()) {
                        handleMainFrameError(view);
                        // Never call super — it always loads errorPath, including after lock/minimize.
                        return;
                    }
                    super.onReceivedError(view, request, error);
                }

                @Override
                @SuppressWarnings("deprecation")
                public void onReceivedError(
                    WebView view,
                    int errorCode,
                    String description,
                    String failingUrl
                ) {
                    handleMainFrameError(view);
                }

                @Override
                public void onReceivedHttpError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceResponse errorResponse
                ) {
                    // An HTTP response means the device reached a server. Never treat that as offline.
                    if (request != null && request.isForMainFrame()) {
                        if (mainFrameNavigationStarted) {
                            restoreApp(view);
                        }
                        return;
                    }
                    super.onReceivedHttpError(view, request, errorResponse);
                }
            }
        );
    }
}
