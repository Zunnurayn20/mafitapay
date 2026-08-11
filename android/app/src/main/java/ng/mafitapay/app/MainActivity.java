package ng.mafitapay.app;

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

        // Keep remote-load failures in the native WebView instead of handing the error URL to
        // Android's external browser. This mirrors the established mobile-shell behavior.
        webView.setWebViewClient(
            new BridgeWebViewClient(bridge) {
                @Override
                public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error
                ) {
                    if (request != null && request.isForMainFrame()) {
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
                    view.stopLoading();
                    view.loadUrl(OFFLINE_ASSET);
                }
            }
        );
    }
}
