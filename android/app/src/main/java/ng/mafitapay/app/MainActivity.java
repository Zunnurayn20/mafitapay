package ng.mafitapay.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.annotation.RequiresApi;
import androidx.core.view.WindowCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    private static final String OFFLINE_ASSET = "file:///android_asset/public/offline.html";
    private static final String APP_URL = "https://mafitapay.com/";
    private static final long RESTORE_COOLDOWN_MS = 2500;

    /** Reloading past this many consecutive failures is hammering a host that is not coming back. */
    private static final int MAX_RESTORE_ATTEMPTS = 3;

    /** Reopen the exact route after a process kill only while it is still plausibly current. */
    private static final long ROUTE_MEMORY_TTL_MS = 6 * 60 * 60 * 1000L;

    private static final String PREFS_NAME = "mafitapay_shell";
    private static final String KEY_LAST_URL = "last_app_url";
    private static final String KEY_LAST_URL_AT = "last_app_url_at";

    private static final String REASON_OFFLINE = "offline";
    private static final String REASON_UNREACHABLE = "unreachable";

    private boolean appInForeground = false;
    private boolean mainFrameNavigationStarted = false;
    private boolean mainFrameLoadFailed = false;
    private String lastAppUrl = null;
    private long lastRestoreAt = 0;
    private boolean restorePending = false;
    private int restoreAttempts = 0;

    /**
     * Resolved from capacitor.config at startup rather than hardcoded, so a dev build pointed at
     * MAFITAPAY_MOBILE_SERVER_URL recovers to that host instead of bouncing to production.
     */
    private String appLaunchUrl = APP_URL;
    private String appHost = "mafitapay.com";

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
        mainHandler.removeCallbacksAndMessages(null);
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

    /**
     * Host-matched rather than a substring test, because failed URLs now flow from the error
     * callbacks straight into loadUrl.
     */
    private boolean isAppDocumentUrl(String url) {
        if (url == null || isOfflineDocument(url)) return false;
        try {
            String host = Uri.parse(url).getHost();
            if (host == null) return false;
            return host.equals(appHost) || host.endsWith("." + appHost);
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private WebView currentWebView() {
        Bridge bridge = getBridge();
        return bridge != null ? bridge.getWebView() : null;
    }

    /**
     * Remember the route so a recovery — or a relaunch after Android kills us — can return to it.
     * Called from doUpdateVisitedHistory as well as onPageFinished, because Next.js App Router
     * navigates with pushState and onPageFinished never fires for that.
     */
    private void rememberAppUrl(String url) {
        if (!isAppDocumentUrl(url)) return;
        lastAppUrl = url;
        try {
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_LAST_URL, url)
                .putLong(KEY_LAST_URL_AT, System.currentTimeMillis())
                .apply();
        } catch (RuntimeException ignored) {
        }
    }

    /** The stored route, or null when there is nothing worth reopening. */
    private String readRestorableUrl() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String url = prefs.getString(KEY_LAST_URL, null);
            long savedAt = prefs.getLong(KEY_LAST_URL_AT, 0);

            if (!isAppDocumentUrl(url) || url.equals(appLaunchUrl)) return null;
            if (savedAt <= 0) return null;

            long age = System.currentTimeMillis() - savedAt;
            // A negative age means the clock moved backwards; treat that as untrustworthy.
            if (age < 0 || age > ROUTE_MEMORY_TTL_MS) return null;

            return url;
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private String chooseRestoreTarget(String preferred) {
        if (isAppDocumentUrl(preferred)) return preferred;
        if (isAppDocumentUrl(lastAppUrl)) return lastAppUrl;
        return appLaunchUrl;
    }

    /** Branded screen, told where to go back to and why it is showing. */
    private void showBrandedOffline(WebView view, String reason) {
        if (view == null || isOfflineDocument(view.getUrl())) return;
        String target = isAppDocumentUrl(lastAppUrl) ? lastAppUrl : appLaunchUrl;
        view.stopLoading();
        view.loadUrl(OFFLINE_ASSET + "?reason=" + reason + "&return=" + Uri.encode(target));
    }

    private void restoreApp(WebView view, String preferredUrl) {
        if (view == null) return;

        if (restoreAttempts >= MAX_RESTORE_ATTEMPTS) {
            // Connected, but this origin keeps failing. Say that rather than reload forever.
            showBrandedOffline(view, REASON_UNREACHABLE);
            return;
        }

        final String target = chooseRestoreTarget(preferredUrl);
        long now = SystemClock.elapsedRealtime();
        long sinceLast = now - lastRestoreAt;

        if (sinceLast < RESTORE_COOLDOWN_MS) {
            // Never simply drop this. onReceivedError cannot un-paint the WebView's own error page,
            // so a skipped restore is what leaves that page on screen. Defer instead, collapsing a
            // burst of errors into a single load.
            if (!restorePending) {
                restorePending = true;
                mainHandler.postDelayed(() -> {
                    restorePending = false;
                    restoreApp(currentWebView(), target);
                }, RESTORE_COOLDOWN_MS - sinceLast);
            }
            return;
        }

        lastRestoreAt = now;
        restoreAttempts++;
        view.stopLoading();
        view.loadUrl(target);
    }

    private void recoverIfNetworkRestored() {
        if (!appInForeground || !hasValidatedNetwork()) return;

        WebView view = currentWebView();
        if (view == null || !isOfflineDocument(view.getUrl())) return;

        // The network genuinely came back, so the previous failures should not count against us.
        restoreAttempts = 0;
        restoreApp(view, null);
    }

    /**
     * Capacitor's BridgeWebViewClient always loads server.errorPath on a main-frame error.
     * Sleep / minimize fire those errors even on a full connection. We take over:
     *   - no validated network → branded offline.html (never the WebView default page)
     *   - validated network → reload the route that failed (never an error page)
     *
     * Declining to call super only stops Capacitor's errorPath load; the WebView has already
     * painted its own error page by the time this runs, so the reload is what removes it.
     */
    private void handleMainFrameError(WebView view, String failedUrl) {
        if (hasValidatedNetwork()) {
            restoreApp(view, failedUrl);
            return;
        }

        if (appInForeground) {
            showBrandedOffline(view, REASON_OFFLINE);
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

        // Resolve the real origin before anything consults isAppDocumentUrl.
        String configuredServerUrl = bridge.getServerUrl();
        if (configuredServerUrl != null && !configuredServerUrl.trim().isEmpty()) {
            appLaunchUrl = configuredServerUrl;
            try {
                String host = Uri.parse(configuredServerUrl).getHost();
                if (host != null && !host.isEmpty()) {
                    appHost = host;
                }
            } catch (RuntimeException ignored) {
            }
        }

        WebView webView = bridge.getWebView();
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        webView.setWebViewClient(
            new BridgeWebViewClient(bridge) {
                @Override
                public void onPageStarted(WebView view, String url, Bitmap favicon) {
                    mainFrameNavigationStarted = !isOfflineDocument(url);
                    mainFrameLoadFailed = false;
                    super.onPageStarted(view, url, favicon);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    mainFrameNavigationStarted = false;
                    if (isAppDocumentUrl(url)) {
                        rememberAppUrl(url);
                        // onPageFinished also fires for a failed load, so only a clean one may
                        // hand the retry budget back.
                        if (!mainFrameLoadFailed) {
                            restoreAttempts = 0;
                        }
                    }
                }

                @Override
                public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                    super.doUpdateVisitedHistory(view, url, isReload);
                    // Fires for pushState/replaceState, which is how Next.js App Router navigates.
                    // Without this the remembered route freezes at the last full page load.
                    rememberAppUrl(url);
                }

                @Override
                public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error
                ) {
                    if (request != null && request.isForMainFrame()) {
                        mainFrameLoadFailed = true;
                        Uri failed = request.getUrl();
                        handleMainFrameError(view, failed != null ? failed.toString() : null);
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
                    mainFrameLoadFailed = true;
                    handleMainFrameError(view, failingUrl);
                }

                @Override
                public void onReceivedHttpError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceResponse errorResponse
                ) {
                    // An HTTP response means the device reached a server. Never treat that as offline.
                    if (request != null && request.isForMainFrame()) {
                        mainFrameLoadFailed = true;
                        if (mainFrameNavigationStarted) {
                            Uri failed = request.getUrl();
                            restoreApp(view, failed != null ? failed.toString() : null);
                        }
                        return;
                    }
                    super.onReceivedHttpError(view, request, errorResponse);
                }

                @Override
                @RequiresApi(api = Build.VERSION_CODES.O)
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    super.onRenderProcessGone(view, detail);
                    // Returning false lets Android kill the process, so a renderer reclaimed during a
                    // long idle would cost the user their place. Rebuild the activity instead; the
                    // remembered route brings them back.
                    //
                    // The dead WebView is deliberately left alone: BridgeActivity.onDetachedFromWindow
                    // routes into Bridge.onDetachedFromWindow, which already calls removeAllViews and
                    // destroy during the recreate teardown. Destroying it here would double up.
                    mainHandler.post(MainActivity.this::recreate);
                    return true;
                }
            }
        );

        String restorable = readRestorableUrl();
        if (restorable != null) {
            lastAppUrl = restorable;
            // Capacitor has already started loading server.url; this supersedes it. The native splash
            // is held until the web layer hides it (launchAutoHide: false), so the swap is not seen.
            webView.loadUrl(restorable);
        }
    }
}
