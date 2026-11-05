# Android-app van Spotter

November 2026. Stap 2 uit `docs/health-koppeling.md`: een Android-app die de live site laat zien en dagelijkse stappen en actieve kcal uit Health Connect ophaalt.

---

## 1. Hoe het werkt

- De app is een **Capacitor 8-schil** om de live site. Hij laadt `https://myspotter.nl` (APK's van vóór 5 nov 2026 laden nog `https://gymapp-eight-kappa.vercel.app`). Een nieuwe versie van de site staat dus meteen in de app, zonder nieuwe APK.
- Alleen een **offline-scherm** zit in de app zelf (`native/www/index.html`). Dat verschijnt als de site niet laadt, met een knop "Opnieuw proberen". Komt de verbinding terug, dan probeert het scherm het vanzelf opnieuw.
- **Health Connect:** de plugin `@capgo/capacitor-health` leest per dag het totaal van stappen en actieve kcal. Health Connect ontdubbelt die zelf volgens de app-prioriteit van de gebruiker. De app stuurt de dagen in één aanroep naar Supabase (`upsert_daily_activity`, bron `health_connect`). Daarna verschijnen ze op Home, bij Voeding en op de ranglijst.
- **Wanneer wordt er gesynchroniseerd?**
  - Bij het verbinden: de laatste 30 dagen.
  - Bij het openen van de app en bij terugkeren naar de app: hooguit eens per kwartier, de laatste 3 dagen (horloges werken vaak later bij). Is de app langer niet geopend, dan alle gemiste dagen, tot 30.
  - Met de knop "Nu synchroniseren": de laatste 7 dagen.
  - Alleen als de gebruiker in Spotter toestemming heeft gegeven voor activiteit (AVG) en Health Connect op dat toestel heeft verbonden.
- **Terugknop van Android:** sluit eerst een open paneel, gaat anders een pagina terug, en sluit de app op Home of het inlogscherm.
- Op het web verandert er niets. De pluginbestanden worden alleen in de app geladen.

### Bestanden

| Bestand | Wat |
|---|---|
| `capacitor.config.ts` | App-id `nl.myspotter.app`, naam, server-adres, toegestane domeinen, offline-scherm, systeembalken |
| `native/www/` | Offline-scherm (`index.html`) en het adres voor "Opnieuw proberen" (`app-url.js`, gemaakt door `scripts/native-app-url.mjs`) |
| `android/` | Het Android Studio-project (wordt gecommit; bouwmappen niet) |
| `android/app/src/main/AndroidManifest.xml` | Alleen `READ_STEPS` en `READ_ACTIVE_CALORIES_BURNED`; alle andere rechten van de plugin verwijderd; privacyscherm voor Health Connect |
| `android/app/src/main/res/values/strings.xml` | `health_connect_privacy_policy_url`: de privacyverklaring die Health Connect toont |
| `src/lib/native/health.ts` | Beschikbaarheid, rechten, sync en de koppeling per toestel |
| `src/components/activity/NativeHealthSync.tsx` | Sync bij openen en terugkeren (in `AuthProvider`) |
| `src/components/activity/HealthConnectPanel.tsx` | Profiel > Koppelingen: verbinden, status, nu synchroniseren, ontkoppelen |
| `src/components/platform/NativeBackButton.tsx` | Terugknop van Android |
| `supabase/upgrade-activity-native.sql` | Server accepteert ook de bronnen `health_connect` en `healthkit` |
| `scripts/android-build.mjs`, `scripts/android-icons.mjs`, `scripts/native-app-url.mjs` | Bouwen, iconen, offline-adres |

---

## 2. Eenmalig: database bijwerken

Plak `supabase/upgrade-activity-native.sql` in Supabase > SQL Editor > New query > Run. Zonder dit script weigert de server de gegevens uit Health Connect. De app meldt dan "Synchroniseren met Health Connect is nog niet ingeschakeld op de server".

Draai je `upgrade-activity.sql` later opnieuw, draai dit script daarna ook opnieuw.

---

## 3. De debug-APK bouwen op deze pc (Windows)

### Eenmalig

1. Open Android Studio en rond de installatiewizard af. De SDK komt in `%LOCALAPPDATA%\Android\Sdk`.
2. Controleer in Android Studio onder Settings > Languages & Frameworks > Android SDK dat **Android 16 (API 36)** en de nieuwste **SDK Build-Tools** geïnstalleerd zijn.
3. **Java.** Niets extra nodig: de Gradle-wrapper staat op 9.2.1, en die draait op de Java die bij Android Studio 2026.2 zit (`jbr`, Java 25). Het bouwscript vindt die vanzelf (het accepteert JDK 21 t/m 25). Zet `org.gradle.java.home` niet in `gradle.properties`: dat pad hoort bij deze pc.

### Bouwen

```powershell
npm install
npm run android:build
```

Dit doet het volgende:

1. Het zet het server-adres in het offline-scherm.
2. Het draait `cap sync android` (config, plugins en het offline-scherm naar `android/`).
3. Het bouwt `gradlew assembleDebug`.

De eerste keer downloadt Gradle ongeveer 1 GB aan onderdelen. Dat duurt even.

Resultaat: `android\app\build\outputs\apk\debug\app-debug.apk`

Liever via Android Studio:

```powershell
npm run cap:sync
npm run android:open
```

Kies daarna in Android Studio Build > Build App Bundle(s) / APK(s) > Build APK(s). Met een telefoon via USB kan het ook direct met de groene Run-knop.

Na een wijziging in `capacitor.config.ts`, een nieuwe plugin of een nieuw offline-scherm: altijd opnieuw `npm run cap:sync` (zit al in `android:build`). Een wijziging aan de site zelf heeft geen nieuwe APK nodig: deploy naar Vercel en de app laadt de nieuwe versie.

### Iconen en opstartscherm

Die zijn al gemaakt uit de huisstijl (halter, `#c8f53a` op `#0b0d10`, adaptief icoon met thema-variant). Opnieuw maken: `npm run android:icons`. Dat gebruikt `sharp`, dat met Next.js meekomt. Werkt dat niet, gebruik dan in Android Studio rechtsklik op `app` > New > Image Asset en kies `public/icons/maskable-512.png` als voorgrond met achtergrond `#0b0d10`.

### Inspecteren

Een debug-build kan je inspecteren in Chrome op de pc: open `chrome://inspect` met de telefoon via USB (USB-foutopsporing aan). Daar zie je de console van de site in de app.

---

## 4. Installeren op een telefoon (sideloaden) zodat vrienden kunnen testen

1. Stuur `app-debug.apk` naar de telefoon, bijvoorbeeld via Google Drive, een USB-kabel of een chat-app. Hernoem hem gerust naar `Spotter.apk`.
2. Open het bestand op de telefoon. Android vraagt om **installeren van onbekende apps** toe te staan voor de app waarmee je het opent (Drive, Bestanden, Chrome). Sta dat toe.
3. Play Protect kan waarschuwen dat de app onbekend is. Kies "Toch installeren" en, als het gevraagd wordt, "Niet scannen" of "Installeren zonder scannen".
4. Met een kabel kan het ook vanaf de pc: `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb install -r android\app\build\outputs\apk\debug\app-debug.apk`.

**Health Connect op de telefoon:**
- Android 14 of nieuwer: Health Connect zit in het systeem (Instellingen > Beveiliging en privacy > Privacy > Health Connect, of zoek op "Health Connect").
- Android 9 tot en met 13: installeer de app Health Connect uit de Play Store. Spotter toont daarvoor een knop.
- Zet in Garmin Connect, Samsung Health of Google Health zelf het delen met Health Connect aan.
- Garmin Connect schrijft volgens berichten pas vanaf Android 14 naar Health Connect.

**In de app:** log in met e-mail en wachtwoord. Ga naar Profiel > Koppelingen en activiteit. Zet "Activiteit bijhouden" aan en kies "Verbinden met Health Connect". Zet daarna in Health Connect onder App-prioriteit (Activiteit) de app van je horloge bovenaan.

**Let op bij updates:** een debug-APK is ondertekend met de debug-sleutel van déze pc (`%USERPROFILE%\.android\debug.keystore`). Een nieuwe versie installeert alleen over de oude heen als hij met dezelfde sleutel is gemaakt. Bouw dus altijd op deze pc. Anders moeten testers de app eerst verwijderen. Kopieer die sleutel als je op een andere pc wilt bouwen.

**Gesideloade apps en Health Connect:** dat werkt. Health Connect eist geen Play-installatie, alleen een privacyverklaring in de app. Die is er. Vanaf 2027 geldt de ontwikkelaarsverificatie van Android ook voor gesideloade apps. Daarvoor is er een gratis account voor "beperkte verspreiding" (tot 20 toestellen).

---

## 5. Server-adres wisselen naar myspotter.nl

Gedaan op 5 nov 2026 (stappen 1, 2 en 4). Zo ging het, en zo doe je het bij een volgend domein:

1. `capacitor.config.ts`: zet `DEFAULT_SERVER_URL` op het adres dat Vercel **zonder doorverwijzing** serveert (controleer met `curl -I https://myspotter.nl` en `curl -I https://www.myspotter.nl`: het juiste adres geeft 200, niet 307/308). Let op: beide domeinen staan in `allowNavigation`, dus een doorverwijzing blijft wel in de app, maar Capacitor zet zijn brug (`window.Capacitor`) alleen op precies het adres van `server.url`. Na een doorverwijzing naar een ander adres werken Health Connect, de achtergrond-sync en de terugknop dus niet meer.
2. `android/app/src/main/res/values/strings.xml`: zet `health_connect_privacy_policy_url` op `https://myspotter.nl/privacy`. Dit moet hetzelfde adres zijn als in de Play Store.
3. Supabase > Authentication > URL Configuration: voeg `https://myspotter.nl` toe (Site URL en Redirect URLs).
4. `npm run android:build` en de nieuwe APK verspreiden.
5. Laat `https://gymapp-eight-kappa.vercel.app` de app gewoon blijven serveren (geen doorverwijzing naar myspotter.nl) tot iedereen de nieuwe APK heeft. Anders verliezen alle oude APK's hun Health Connect-koppeling. De site toont in een oude app wel een melding dat er een nieuwe versie is.

**Let op:** de inlogsessie hoort bij het domein. Na de wissel moet iedereen in de app één keer opnieuw inloggen.

Tijdelijk een ander adres testen (bijvoorbeeld een Vercel-preview), zonder iets te wijzigen:

```powershell
$env:CAP_SERVER_URL = "https://jouw-preview.vercel.app"; npm run android:build; Remove-Item Env:CAP_SERVER_URL
```

---

## 6. Inloggen in de app: beperkingen

- **E-mail en wachtwoord werkt gewoon** in de app.
- **Links uit e-mails** (magic link, wachtwoord herstellen, e-mail bevestigen) openen in Chrome en niet in de app. De sessie in Chrome is een andere dan die in de app. Workaround voor testers: maak het account of het nieuwe wachtwoord aan via de website, en log daarna in de app in met e-mail en wachtwoord.
- **Later oplossen** met Android App Links:
  - `public/.well-known/assetlinks.json` met de SHA-256 van de ondertekeningssleutel
  - een `intent-filter` met `android:autoVerify="true"` voor `https://myspotter.nl` in `AndroidManifest.xml`
  - doe dit pas als het domein live is

  Een alternatief is inloggen met de 6-cijferige code uit de e-mail (Supabase OTP).

---

## 7. Wat nog ontbreekt (vervolgstappen)

1. **Native push.** Web Push (VAPID) werkt niet in de Android-WebView. Meldingen aanzetten in de app levert dus (nog) niets op. Nodig zijn:
   - Firebase Cloud Messaging met `@capacitor-firebase/messaging` en `google-services.json` in `android/app/`
   - een tabel voor FCM-tokens
   - versturen naast web-push in `src/lib/push-server.ts`

   Niet in deze stap.
2. **Synchroniseren op de achtergrond.** Nu gebeurt het alleen bij openen en terugkeren. Daarvoor zijn nodig:
   - het recht `READ_HEALTH_DATA_IN_BACKGROUND`
   - een eigen Kotlin-`WorkManager`-taak
   - een uploadroute zonder WebView (een token per toestel)

   Zie `docs/health-koppeling.md` 3.2.
3. **App Links** voor maillinks (zie 6).
4. **Bron-apps tonen** ("Health Connect · Garmin Connect"): de dagtotalen van Health Connect zeggen niet uit welke app ze komen. Daarvoor zijn losse metingen nodig (`readSamples`). Nu staat er alleen "Health Connect".
5. **iOS (stap 3):** dezelfde code met HealthKit, met de bron `healthkit` die de server al accepteert.

---

## 8. Naar de Play Store

| Stap | Wat |
|---|---|
| Account | Google Play Console, eenmalig 25 dollar, ID-verificatie. |
| Ondertekenen | Maak een upload-sleutel: Android Studio > Build > Generate Signed App Bundle > Create new. Bewaar het `.jks`-bestand en de wachtwoorden veilig en **commit ze nooit** (staat in `.gitignore`). Zet Play App Signing aan. |
| Versie | Verhoog `versionCode` (en `versionName`) in `android/app/build.gradle` bij elke upload. |
| Bundel | Build > Generate Signed App Bundle > `release` (`.aab`). |
| Gesloten test | Persoonlijk account: **minimaal 12 testers die 14 dagen achter elkaar aangemeld blijven**. Pas daarna kun je productie aanvragen. Meld je vrienden aan zodra de eerste build er is. |
| Health apps-verklaring | Play Console > App-content > Health apps. Kies "Activiteit en fitness". Licht per recht toe: stappen voor het stappendoel en de weekranglijst met vrienden, actieve kcal voor de weergave en het optioneel terugverdienen bij voeding. Alleen lezen, niets schrijven. Moet exact passen bij het manifest. |
| Data safety | Gezondheid en fitness: verzameld, niet gedeeld met derden voor reclame, niet verkocht, versleuteld onderweg, verwijderbaar (in de app en door het account te verwijderen). Delen met vrienden alleen na toestemming. |
| Privacyverklaring | Zelfde URL in de Play-vermelding en in `strings.xml`. |
| Controle | Bekijk in Android Studio `AndroidManifest.xml` > tabblad **Merged Manifest**. Daar mogen alleen `READ_STEPS` en `READ_ACTIVE_CALORIES_BURNED` als gezondheidsrechten staan. |
| Overig | Doelgroep 16+ (of hoger), geen advertenties, account verwijderen in de app (bestaat al), een demo-account voor de beoordelaar. |

Reken op 3 tot 5 weken doorlooptijd. Dat komt vooral door de gesloten test en de beoordeling van de Health apps-verklaring.
