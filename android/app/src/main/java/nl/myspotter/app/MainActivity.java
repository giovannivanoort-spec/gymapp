package nl.myspotter.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import nl.myspotter.app.widget.SpotterWidgetPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Lokale plugins vóór super.onCreate registreren (dan maakt Capacitor de brug).
        // SpotterWidget: de site stuurt hiermee de gegevens voor de widget op het startscherm.
        registerPlugin(SpotterWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
