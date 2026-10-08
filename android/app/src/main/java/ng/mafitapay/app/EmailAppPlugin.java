package ng.mafitapay.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "EmailApp")
public class EmailAppPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        JSObject result = new JSObject();
        try {
            Intent intent = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_EMAIL);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            result.put("opened", true);
        } catch (ActivityNotFoundException exception) {
            result.put("opened", false);
        }
        call.resolve(result);
    }
}
