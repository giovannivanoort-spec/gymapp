package nl.myspotter.app.widget;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Lokale Capacitor-plugin "SpotterWidget" (geregistreerd in MainActivity). De site in de app roept
 * hem aan via src/lib/native/widget.ts:
 *
 * - update({ json }): bewaart de momentopname (stappen, slaap, volgende training) in SharedPreferences
 *   en tekent alle widgets opnieuw. Geeft { widgets: aantal geplaatste widgets } terug. Zonder geplaatste
 *   widget wordt er niets bewaard (en een oude momentopname gewist): stappen en slaap zijn
 *   gezondheidsgegevens en staan alleen op het toestel als de widget ze ook echt toont. De opslag gaat
 *   niet mee in Android-back-ups (res/xml/backup_rules.xml en data_extraction_rules.xml).
 * - clear(): vergeet de momentopname (na uitloggen); de widgets tonen weer "Open Spotter om te synchroniseren".
 *
 * De widget haalt zelf nooit iets op: hij toont alleen wat de app het laatst heeft gestuurd.
 */
@CapacitorPlugin(name = "SpotterWidget")
public class SpotterWidgetPlugin extends Plugin {

    /** Ruim genoeg voor een paar getallen en drie trainingstitels; alles daarboven is een fout. */
    private static final int MAX_JSON_LENGTH = 8 * 1024;

    @PluginMethod
    public void update(PluginCall call) {
        String json = call.getString("json");
        if (json == null || json.isEmpty() || json.length() > MAX_JSON_LENGTH) {
            call.reject("Ongeldige widgetgegevens.");
            return;
        }
        try {
            new JSONObject(json);
        } catch (JSONException e) {
            call.reject("Ongeldige widgetgegevens.");
            return;
        }
        Context ctx = getContext();
        if (SpotterWidgetProvider.widgetCount(ctx) == 0) {
            // Geen widget op het startscherm: niets bewaren.
            SpotterWidgetProvider.saveSnapshot(ctx, null);
            JSObject ret = new JSObject();
            ret.put("widgets", 0);
            call.resolve(ret);
            return;
        }
        SpotterWidgetProvider.saveSnapshot(ctx, json);
        JSObject ret = new JSObject();
        ret.put("widgets", SpotterWidgetProvider.updateAll(ctx));
        call.resolve(ret);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        Context ctx = getContext();
        SpotterWidgetProvider.saveSnapshot(ctx, null);
        JSObject ret = new JSObject();
        ret.put("widgets", SpotterWidgetProvider.updateAll(ctx));
        call.resolve(ret);
    }
}
