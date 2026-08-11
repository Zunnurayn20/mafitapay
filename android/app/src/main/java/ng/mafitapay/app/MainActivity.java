package ng.mafitapay.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    private static final String OFFLINE_ASSET = "file:///android_asset/public/offline.html";
    private boolean appInForeground = false;

    @Override
    public void onResume() {
        super.onResume();
        appInForeground = true;
    }

    @Override
    public void onPause() {
        appInForeground = false;
        super.onPause();
    }

    private boolean hasValidatedNetwork() {
        ConnectivityManager connectivity = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivity == null) return false;

        Network network = connectivity.getActiveNetwork();
        if (network == null) return false;

        NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(network);
        return capabilities != null
            && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BiometricAuthPlugin.class);
        super.onCreate(savedInstanceState);

        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) {
            return;
        }

        WebView webView = bridge.getWebView();
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        // Only replace the page when Android confirms the device is actually offline. WebView can
        // emit a transient main-frame error while a phone sleeps or resumes, even though the
        // existing authenticated page is still valid; replacing it then would send users to the
        // offline screen (and ultimately the login route) unnecessarily.
        webView.setWebViewClient(
            new BridgeWebViewClient(bridge) {
                @Override
                public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error
                ) {
                    if (request != null && request.isForMainFrame()
                        && appInForeground && !hasValidatedNetwork()) {
                        view.stopLoading();
                        view.loadUrl(OFFLINE_ASSET);
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
                    if (appInForeground && !hasValidatedNetwork()) {
                        view.stopLoading();
                        view.loadUrl(OFFLINE_ASSET);
                        return;
                    }
                    super.onReceivedError(view, errorCode, description, failingUrl);
                }
            }
        );
    }
}
