import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android-app (Capacitor 8): een dunne native schil om de live site, met Health Connect.
 * Zie docs/android-app.md.
 *
 * De app laadt de site van `server.url`. Overschrijven kan met de omgevingsvariabele CAP_SERVER_URL
 * (bijv. een preview-deploy), daarna `npm run cap:sync`.
 *
 * TODO: zodra https://myspotter.nl live is, DEFAULT_SERVER_URL daarop zetten (en de privacy-URL in
 * android/app/src/main/res/values/strings.xml), opnieuw `npm run cap:sync` en een nieuwe build maken.
 * Gebruik precies het adres dat Vercel ZONDER doorverwijzing serveert (`curl -I` geeft 200, geen 307/308),
 * dus kies tussen myspotter.nl en www.myspotter.nl het canonieke adres. Zie docs/android-app.md, deel 5.
 */
export const DEFAULT_SERVER_URL = "https://gymapp-eight-kappa.vercel.app";

const serverUrl = process.env.CAP_SERVER_URL || DEFAULT_SERVER_URL;

/**
 * Eigen domeinen van Spotter. Alleen hierheen mag de WebView navigeren; al het andere (maillinks,
 * YouTube, Open Food Facts, Supabase) opent in de browser. Supabase hoeft er niet in: inloggen met
 * wachtwoord gaat via fetch, niet via navigatie.
 *
 * Let op: een doorverwijzing naar een ander domein uit deze lijst blijft wel in de app, maar Capacitor 8
 * zet zijn brug (window.Capacitor) alleen op precies de origin van server.url. Op een ander adres zijn
 * Health Connect, de achtergrond-sync en de terugknop dus weg. Daarom:
 * - server.url = het adres dat zonder doorverwijzing wordt geserveerd;
 * - gymapp-eight-kappa.vercel.app blijft de app serveren (geen doorverwijzing) tot elke geïnstalleerde
 *   APK een nieuwe server.url heeft.
 * Gebeurt het toch, dan ziet de gebruiker een melding om de app bij te werken (NativeBackButton,
 * herkend aan NATIVE_USER_AGENT).
 */
const APP_HOSTS = [...new Set([new URL(serverUrl).hostname, "gymapp-eight-kappa.vercel.app", "myspotter.nl", "www.myspotter.nl"])];

/**
 * Achter de user agent van de WebView geplakt. Geldt voor elk adres (anders dan window.Capacitor), zodat
 * de site ook zonder brug weet dat hij in de app draait. Gelijk aan NATIVE_USER_AGENT in src/lib/native/health.ts.
 */
const NATIVE_USER_AGENT = "SpotterApp";

const config: CapacitorConfig = {
  appId: "nl.myspotter.app",
  appName: "Spotter",
  appendUserAgent: NATIVE_USER_AGENT,
  // Alleen het offline-scherm wordt meegeleverd; de app zelf komt van server.url.
  webDir: "native/www",
  backgroundColor: "#0b0d10",
  // Logs alleen in debug-builds.
  loggingBehavior: "debug",
  server: {
    url: serverUrl,
    androidScheme: "https",
    cleartext: false,
    allowNavigation: APP_HOSTS,
    // Getoond als de site niet laadt (geen verbinding, serverfout). Lokaal, zonder plugins.
    errorPath: "index.html",
  },
  android: {
    allowMixedContent: false,
    // webContentsDebuggingEnabled niet zetten: dan kan chrome://inspect in debug-builds wel en in release-builds niet.
  },
  plugins: {
    // Android 15+ tekent altijd edge-to-edge. De site gebruikt viewport-fit=cover en env(safe-area-inset-*),
    // net als de iPhone-PWA; "css" zorgt dat die waarden in de WebView kloppen. Lichte iconen op de donkere balk.
    SystemBars: {
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
      style: "DARK",
    },
  },
};

export default config;
