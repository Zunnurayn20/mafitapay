package ng.mafitapay.app;

import android.app.Activity;
import android.view.View;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps the navigation bar icons legible against whatever the web layer is painting.
 *
 * The shell draws edge-to-edge with a fully transparent navigation bar and no contrast scrim
 * (see MainActivity.makeNavigationBarTransparent), so back / home / recents are stencilled
 * straight onto our own page. Android picks their colour from the activity theme, which is
 * DayNight — i.e. from the *device's* light/dark setting, which has nothing to do with the
 * in-app theme toggle. On a light-mode phone that means dark icons over our near-black page,
 * and they disappear. This lets the web layer state which theme it is actually showing.
 *
 * Scope is the navigation bar alone: the status bar has an official Capacitor plugin, and
 * having two owners for one appearance flag is how they end up disagreeing.
 */
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {
    /**
     * @param lightTheme true when the page is on the light palette, so the bar needs dark icons.
     */
    static void applyNavigationBarAppearance(Activity activity, boolean lightTheme) {
        if (activity == null) return;

        Window window = activity.getWindow();
        if (window == null) return;

        View decor = window.getDecorView();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
        controller.setAppearanceLightNavigationBars(lightTheme);
    }

    @PluginMethod
    public void setNavigationBarAppearance(PluginCall call) {
        final boolean lightTheme = Boolean.TRUE.equals(call.getBoolean("lightTheme", false));
        final Activity activity = getActivity();

        activity.runOnUiThread(() -> {
            applyNavigationBarAppearance(activity, lightTheme);
            call.resolve();
        });
    }
}
