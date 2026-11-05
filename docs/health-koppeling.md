# Stappen en verbrande calorieën koppelen aan Spotter

Advies, november 2026. Dit document beschrijft hoe Spotter dagelijkse stappen en verbrande calorieën uit gezondheidsapps en smartwatches kan halen. Het gaat over de web-app nu (stap 1), een Android-app (stap 2) en later een iPhone-app (stap 3).

---

## 1. Samenvatting

- **Een website kan niet bij gezondheidsdata.** Health Connect (Android) en Apple Health (iPhone) bewaren alles op de telefoon en hebben geen web- of cloud-API. Een PWA in de browser komt er niet bij. Een native app-schil is dus nodig.
- **Aanbevolen route:** maak met Capacitor 8 een dunne native schil om de bestaande Next.js-app. Gebruik de plugin `@capgo/capacitor-health` voor zowel Health Connect als HealthKit. Er is één codebase voor web, Android en later iOS, en de UI hoeft niet herschreven te worden.
- **Het horloge maakt niet uit.** Garmin, Samsung Galaxy Watch, Fitbit/Google Health, Xiaomi, Amazfit, Polar en Withings schrijven op Android allemaal naar Health Connect. Spotter leest alleen Health Connect en hoeft geen koppeling per merk te bouwen. Op de iPhone werkt het net zo via Apple Health.
- **Stap 1 (nu, alleen web):** een databasetabel met één regel per gebruiker, dag en bron, plus handmatige invoer, een Home-kaart, een weekranglijst voor vrienden, een instelling om verbrande calorieën mee te laten tellen bij voeding, en toestemmingen en een privacyverklaring. De database is zo opgezet dat de apps later alleen nog dagtotalen hoeven te versturen.
- **Stap 2 (Android):** reken op 30 tot 50 uur werk en 3 tot 5 weken doorlooptijd. De doorlooptijd komt vooral van de verplichte gesloten test met minimaal 12 testers gedurende 14 dagen, plus de controle van de gezondheidsverklaring door Google. Kosten: eenmalig 25 dollar voor een Google Play-account.
- **Stap 3 (iOS):** kan zonder Mac via een cloud-buildservice (Codemagic, gratis tier). Kost 99 dollar per jaar voor het Apple Developer Program. Verspreiding naar vrienden gaat via TestFlight. Het grootste risico is dat Apple de app afwijst als "verpakte website" (richtlijn 4.2).
- **Privacy:** stappen en calorieën gelden onder de AVG als gezondheidsgegevens (artikel 9). Daarom zijn nodig: een aparte, actieve toestemming; aparte keuzes voor delen met vrienden en voor gebruik door de AI-coach; een privacyverklaring op een vaste URL; en verwijderen moet net zo makkelijk zijn als aanzetten.
- **Calorieën:** de dagdoelen van Spotter rekenen nu met een activiteitsfactor (TDEE). Als je daar de verbrande calorieën van het horloge nog eens bij optelt, tel je dubbel. Het advies is daarom: verbrande kcal standaard alleen tonen. Wie wil, zet een gedeeltelijke bonus aan, en die bonus telt alleen activiteit mee die boven wat het doel al verwacht uitkomt.

---

## 2. Waarom deze aanpak

| Optie | Oordeel | Reden |
|---|---|---|
| **Capacitor 8 schil + `@capgo/capacitor-health`** | **Aanbevolen** | Hergebruikt de hele bestaande UI. Eén plugin voor Health Connect en HealthKit. Actief onderhouden (versie 8.11.14, uitgebracht 2 nov 2026). |
| Trusted Web Activity / PWABuilder | Afgeraden | Draait in Chrome, dus geen toegang tot Health Connect zonder veel eigen Kotlin en een eigen berichtenkanaal. Geen route voor iOS. |
| React Native / Expo | Afgeraden | Vergt het herschrijven van de hele UI. Het enige voordeel (iOS bouwen in de cloud) heeft Capacitor ook via Codemagic. |
| Cloud-API's per merk (Garmin, Google Health API, Strava) | Niet als hoofdroute | De Google Health API (opvolger van de Fitbit Web API, die op 2 nov 2026 is uitgezet) heeft een jaarlijkse beveiligingsaudit nodig boven 100 gebruikers. Strava levert geen dagstappen en verbiedt AI-gebruik. Garmin's "Starter"-programma (heropend 21 okt 2026) is gratis maar was 2026 zeven maanden bevroren. Hoogstens een latere optie. |
| Betaalde aggregators (Terra, ROOK, Thryve, Spike) | Afgeraden | Ongeveer 300 tot 500 dollar per maand, en ze hebben toch een native app nodig. |
| Google Fit | Niet gebruiken | De API's verdwijnen in 2026. |

### Gecontroleerde tegenstrijdigheden uit het vooronderzoek

- **Ontdubbeling in Health Connect.** De officiële documentatie (pagina "Aggregate data") zegt dat het Aggregate API data van **Activity- en Sleep-types** ontdubbelt op basis van de app-prioriteit die de gebruiker instelt. Stappen, actieve calorieën en totale calorieën zijn Activity-types en worden dus ontdubbeld. De bewering in een van de onderzoeken dat alleen stappen en afstand worden ontdubbeld, klopt niet. Test het wel op een echt toestel met twee bronnen.
- **Totale calorieën in de plugin.** In de broncode van `@capgo/capacitor-health` (HealthManager.kt en Health.swift) kan `queryAggregated` alleen `steps`, `distance` en `calories` (actief) optellen. `totalCalories` en `basalCalories` worden geweigerd. Op iOS verwijst `totalCalories` zelfs naar actieve energie. Conclusie: Spotter werkt met **stappen en actieve kcal**. Totale kcal is een optioneel extra veld.
- **Fitbit Web API.** Volgens Google zelf eindigde de ondersteuning op 30 september 2026 en ging de API op 2 november 2026 uit.

---

## 3. Architectuur

### 3.1 Nu: web (stap 1)

```
Browser/PWA ──► Supabase (tabel daily_activity, RLS)
   │                ▲
   └─ handmatige invoer via RPC upsert_daily_activity
```

Er is nog geen automatische bron. Gebruikers voeren stappen en actieve kcal zelf in, of laten het leeg. De database, de toestemmingen en de UI staan dan al klaar voor de apps.

**Wat er in stap 1 gebouwd is:**

- **Database:** `supabase/upgrade-activity.sql` (eenmalig plakken in de SQL Editor, veilig om opnieuw te draaien). Zonder dit script werkt de app gewoon en tonen de activiteitsonderdelen "nog niet ingeschakeld".
  - Tabellen `activity_settings` (toestemmingen, stappendoel, percentage terugverdienen), `activity_consent_log` (alleen toevoegen) en `daily_activity` (één rij per gebruiker, lokale datum en bron).
  - View `daily_activity_effective`: één waarde per dag, bronnen worden nooit opgeteld. Een rij zonder stappen, of 0 stappen uit Apple Health, komt achteraan.
  - Alle tabellen tonen alleen je eigen rijen. Vrienden en groepsgenoten lezen nooit rechtstreeks. De ranglijst gebruikt de functie `activity_steps_for`: alleen stappen en bron per dag, en alleen als beide personen delen en vrienden zijn of een groep delen. Wie zelf niet deelt, ziet dus ook anderen niet.
  - Schrijven gaat alleen via de functies `upsert_daily_activity` en `save_activity_settings`.
  - `upsert_daily_activity` accepteert voorlopig **alleen de bron `manual`** (hooguit 7 dagen terug). Anders zou iedereen via de browser zelf getypte getallen als "Health Connect" kunnen opslaan. Zie 3.2 voor wat er in stap 2 verandert.
- **Code:** `src/lib/activity.ts` (types, data, bronlabels, `activityCredit`/`applyCredit`, ranglijst), `src/components/home/ActivityCard.tsx`, `src/components/activity/` (`ConsentSheet`, `ActivityEntrySheet`, `StepsLeaderboard`, en `ActivitySettings` voor de sectie "Koppelingen" in het profiel), `src/components/nutrition/BurnCreditSetting.tsx`, de coach-tool `get_activity` en de openbare pagina `/privacy`.

### 3.2 Android (stap 2)

> **Gebouwd (nov 2026):** zie `docs/android-app.md` voor wat er staat, hoe je de APK bouwt en installeert, en wat er nog ontbreekt. De server accepteert toestelbronnen na `supabase/upgrade-activity-native.sql` (gekozen optie: de RPC laat `health_connect` en `healthkit` toe, met dezelfde controles en hooguit 30 dagen terug).

```
Garmin / Galaxy Watch / Fitbit / Xiaomi ──► hun eigen app ──► Health Connect (op de telefoon)
                                                                   │  aggregate per dag (ontdubbeld)
Spotter Android-app (Capacitor-schil, laadt https://myspotter.nl) ◄┘
   │  JS in de WebView roept de plugin aan
   └──► Supabase RPC upsert_daily_activity (met de bestaande inlogsessie)
```

**Concrete stack (versies van 5 nov 2026):**

| Onderdeel | Versie | Opmerking |
|---|---|---|
| `@capacitor/core`, `@capacitor/cli`, `@capacitor/android` | ^8.6.0 | Niet de 9.0-beta. Vereist Node 22+, compile/target SDK 36, Android Studio Otter (2025.2.1) of nieuwer. |
| `@capgo/capacitor-health` | ^8.11.14 | MPL-2.0. Volg wijzigingen bij voorkeur upstream via een pull request, niet met een lokale patch. |
| `@capacitor/app` | ^8.1 | Terugknop en deep links. |
| `@capacitor-firebase/messaging` | ^8.6 | Native push. Web Push werkt niet in een WebView. |
| Health Connect client (komt mee met de plugin) | 1.1.x stabiel | 1.2.0 is nog alpha. |

**Werkwijze van de sync:**
1. Bij het openen en hervatten van de app controleert de JS-code `Capacitor.isNativePlatform()` en de toestemming in Spotter. Daarna vraagt hij de Health Connect-rechten aan: alleen `READ_STEPS` en `READ_ACTIVE_CALORIES_BURNED`, en optioneel `READ_TOTAL_CALORIES_BURNED`.
2. `queryAggregated({ dataType: 'steps' | 'calories', bucket: 'day', aggregation: 'sum' })` over de laatste 7 dagen, of 30 dagen bij de eerste sync. Dagen worden in de lokale tijd van de telefoon geteld.
3. Eén aanroep met de dagen (`DailyActivityPayload[]` uit `src/lib/activity.ts`) voor de bron `health_connect`. Die is idempotent: dezelfde dag opnieuw sturen vervangt de waarden en telt niets op. Let op: in stap 1 weigert `upsert_daily_activity` alle bronnen behalve `manual`. Maak in stap 2 een afgeschermde route voor toestelbronnen (bijvoorbeeld een route handler met de service-rol en een token per toestel, die dezelfde controles uitvoert), of laat de RPC toestelbronnen weer toe als je het risico van zelf ingevoerde "Health Connect"-getallen binnen de vriendengroep acceptabel vindt.
4. Synchroniseer bij elke opening ook de laatste 2 tot 3 dagen opnieuw, omdat horloges vaak later synchroniseren.

**Belangrijk bij het bouwen:**
- **Manifest opschonen.** De plugin declareert in zijn eigen manifest ongeveer 45 lees- en schrijfrechten (hartslag, slaap, bloeddruk en meer). Die komen automatisch in de uiteindelijke app terecht. De Play-gezondheidsverklaring moet precies overeenkomen met wat je echt gebruikt. Verwijder de overige rechten in `android/app/src/main/AndroidManifest.xml` met `tools:node="remove"` en controleer het samengevoegde manifest in Android Studio. Dit is de meest genoemde reden voor afwijzing.
- **Privacy-scherm.** De plugin levert een `PermissionsRationaleActivity`. Die moet de privacyverklaring tonen, en dat moet dezelfde URL zijn als in de Play Store (`https://myspotter.nl/privacy`).
- **Inloggen.** Een magic link uit de mail opent in Chrome en niet in de app. Los dit op met Android App Links (`/.well-known/assetlinks.json` in `public/`) of met de 6-cijferige code uit de e-mail. Inloggen met wachtwoord werkt gewoon.
- **Push.** De bestaande VAPID-webpush doet niets in de app. Voeg FCM toe naast web-push in `src/lib/push-server.ts` en sla tokens op in een aparte tabel.
- **Laden van de site.** `server.url = https://myspotter.nl` is pragmatisch: Google Play staat JavaScript in een WebView toe. Lever wel een offline-scherm mee in de app en beperk navigatie tot het eigen domein.

**Synchroniseren op de achtergrond (later, optioneel).** De plugin kan niet op de achtergrond lezen. Daarvoor heb je nodig: het recht `READ_HEALTH_DATA_IN_BACKGROUND`, een kleine eigen Kotlin-`WorkManager`-taak (bijvoorbeeld elke 1 tot 3 uur) en een manier om zonder WebView naar Supabase te schrijven. Dat kan met een opgeslagen refresh-token in versleutelde opslag of met een apart uploadtoken per toestel. Batterijbesparing op Samsung en Xiaomi stelt zulke taken vaak uit. Begin daarom met synchroniseren bij het openen van de app. Dat is voor een vriendengroep ruim voldoende, omdat iedereen de app toch opent om te trainen.

### 3.3 iOS (stap 3)

Dezelfde Capacitor-code en dezelfde plugin, maar dan via HealthKit:
- Lees `steps` en `calories` (activeEnergyBurned) per dag. De plugin gebruikt `HKStatisticsCollectionQuery` met `cumulativeSum`, dus iPhone en Apple Watch worden niet dubbel geteld. Gebruik op iOS **niet** `totalCalories`.
- HealthKit verbergt een geweigerde leestoestemming: het lijkt dan alsof er geen data is. Toon in de UI 0 of ontbrekende waarden als "geen data, controleer de rechten in Apple Health" en niet als 0 stappen. Laat zulke dagen niet meetellen in de ranglijst.
- Nodig: de HealthKit-capability op de App ID (via het webportaal), de entitlement `com.apple.developer.healthkit`, `NSHealthShareUsageDescription` in Info.plist, en geen schrijfrechten.
- Synchroniseer bij het openen en hervatten. Achtergrondlevering (`HKObserverQuery`) vergt eigen Swift-code en werkt niet als de telefoon vergrendeld is. Bouw dat alleen als het echt nodig blijkt.

**Bouwen zonder Mac:** gebruik Codemagic, met 500 gratis macOS-minuten per maand (genoeg voor tientallen builds), automatische ondertekening via een App Store Connect API-sleutel en upload naar TestFlight. Een alternatief is GitHub Actions op macOS, maar dat vraagt meer eigen configuratie. Gebruik geen Ionic Appflow: daar worden sinds februari 2025 geen nieuwe klanten meer aangenomen en de dienst stopt eind 2027. Zonder Mac heb je geen simulator en geen Safari Web Inspector. Je test dan op een echte iPhone via TestFlight-builds.

**Apple-richtlijn 4.2 ("meer dan een verpakte website"):** een schil die alleen de Vercel-URL laadt, loopt reëel risico op afwijzing. Zorg voor native meerwaarde:
- een zichtbaar scherm "Verbind met Apple Health"
- native push
- een offline-scherm
- een demo-account voor de reviewer
- Apple Health genoemd in de beschrijving

Verspreid eerst via TestFlight met een openbare link. Een TestFlight-build verloopt na 90 dagen, dus maak minstens elk kwartaal een nieuwe build. Weigert Apple de app toch, dan is de terugvaloptie een gebundelde SPA-build. Dat is een flinke refactor, omdat server actions en API-routes dan via absolute URL's met een Bearer-token moeten.

**Tussenoplossing voor iPhone-vrienden vóór de iOS-app (optioneel):** een Apple Shortcut die bij "App wordt geopend" de stappen naar een Spotter-endpoint stuurt met een persoonlijk token. Dit is gratis, maar onbetrouwbaar: het werkt niet bij een vergrendelde telefoon, en iPhone- en Watch-stappen worden dubbel geteld tenzij je op één bron filtert. Alleen doen als iPhone-vrienden erom vragen.

---

## 4. Hoe de data van elk horloge binnenkomt

| Horloge / bron | Android (Health Connect) | iPhone (Apple Health) | Aandachtspunten |
|---|---|---|---|
| **Garmin** (ouders) | Garmin Connect, Instellingen, Health Connect, rechten aanzetten. Stappen, actieve en totale kcal. | Garmin Connect, Verbonden apps, Apple Health, per categorie aanzetten. | Op Android werkt dit volgens berichten pas vanaf **Android 14**. Data komt pas binnen nadat het horloge met Garmin Connect heeft gesynchroniseerd. Bij Android 13 of ouder: handmatige invoer, de betaalde app Health Sync, of later Garmin's cloudprogramma. |
| **Samsung Galaxy Watch** | Samsung Health schrijft stappen naar Health Connect (aanzetten in Samsung Health). | Werkt niet: Galaxy Watch 4 en nieuwer koppelt niet met een iPhone. | Calorieën van Samsung zijn wisselend: vaak alleen trainingscalorieën. Vertrouw op stappen. |
| **Fitbit / Pixel Watch** | De Google Health-app (voorheen Fitbit) schrijft stappen en totale kcal, maar **geen actieve kcal**. | Sinds Google Health v5.05 (aug 2026) rechtstreeks naar Apple Health. Stappen zijn bevestigd. | Actieve kcal ontbreekt dus vaak. Toon dan alleen stappen. |
| **Apple Watch** | n.v.t. | Native. | Ontdubbeling met de iPhone gebeurt door HealthKit-statistieken. |
| **Alleen telefoon, geen horloge** | Android 14+ telt zelf stappen in Health Connect zodra een app `READ_STEPS` heeft. Op Android 13 of ouder is er alleen data als een andere app schrijft. | De iPhone telt stappen en schat actieve kcal. | |
| Xiaomi (Mi Fitness), Amazfit (Zepp), Polar, Withings, Oura | Schrijven naar Health Connect. | Meestal ook naar Apple Health. | Oura levert geen totale kcal. |
| Huawei | Geen eigen Health Connect-koppeling. | Beperkt. | Alleen via de betaalde app Health Sync, of handmatig. |

**Tip voor gebruikers (in de app uitleggen):** zet in Health Connect, onder Instellingen > App-prioriteit voor Activiteit, de horloge-app bovenaan. Dan kiest Health Connect bij overlap de data van het horloge en niet die van de telefoon.

**Actie vóór stap 2:** vraag in de groep welk telefoonmodel en welke Android-versie iedereen heeft, vooral de ouders. Dat bepaalt of de Garmin-koppeling werkt.

---

## 5. Ontdubbelen

Er zijn drie niveaus:
1. **Binnen de telefoon:** Health Connect en HealthKit ontdubbelen zelf als je **dagtotalen via aggregatie** opvraagt en niet zelf losse metingen optelt. De app doet daarom altijd `queryAggregated` per dag.
2. **Tussen bronnen in Spotter:** de database bewaart per dag één regel per bron (`manual`, `health_connect`, `healthkit`, later eventueel `garmin`/`shortcut`). Bronnen worden **nooit opgeteld**. Een view kiest per dag één "effectieve" waarde in vaste volgorde: telefoonbron eerst, daarna `garmin`, `shortcut` en `manual`. Handmatige invoer is dus de terugvaloptie en geen extra bovenop de telefoondata.
3. **Herhaald synchroniseren:** de upsert is idempotent op (gebruiker, datum, bron). Opnieuw versturen vervangt de waarden.

---

## 6. Winkels: eisen en kosten

### Google Play (stap 2)

| Punt | Wat |
|---|---|
| Account | Eenmalig 25 dollar, persoonlijk account met ID-verificatie, minimaal 18 jaar. |
| Gesloten test | Persoonlijke accounts die na 13 november 2023 zijn aangemaakt, moeten een gesloten test draaien met **minimaal 12 testers die 14 dagen achter elkaar aangemeld blijven**. Pas daarna kun je productie aanvragen. Een tester die zich afmeldt en weer aanmeldt, start de telling opnieuw. Organisatie-accounts (met D-U-N-S-nummer) zijn vrijgesteld. |
| Health apps-verklaring | Play Console > App-content > Health apps. Kies "Activiteit en fitness" en motiveer per datatype (stappen, actieve kcal). Vraag niets aan wat je niet zichtbaar gebruikt. Zonder goedgekeurde verklaring ziet een gebruiker van de Play-versie de melding "kan geen toegang krijgen tot Health Connect". De beoordeling duurt volgens ervaringen van ontwikkelaars ongeveer 1 tot 2 weken. |
| Data safety-formulier | Gezondheids- en fitnessgegevens opgeven: verzameld, niet verkocht, versleuteld onderweg, verwijderbaar. |
| Privacyverklaring | Dezelfde URL in de Play-listing en in het Health Connect-rationale-scherm. |
| Beleid | Geen advertenties en geen verkoop van data. Gebruik alleen voor zichtbare functies. Openbaar of sociaal delen alleen met expliciete toestemming. Er moet uitleg zijn over hoe je je data verwijdert. |
| Sideloaden | Een ondertekende APK die je buiten Play installeert, kan Health Connect waarschijnlijk wel gebruiken. Gadgetbridge doet dat ook. Zo kun je de vriendengroep al laten testen vóór de Play-beoordeling. Let op: Android-ontwikkelaarsverificatie geldt vanaf 2027 wereldwijd ook voor gesideloade apps. Daarvoor is er een gratis account voor "beperkte verspreiding" (tot 20 toestellen). |

### Apple (stap 3)

| Punt | Wat |
|---|---|
| Account | Apple Developer Program, 99 dollar per jaar. Een gratis account is zonder Mac onbruikbaar. |
| Verspreiding | TestFlight met een openbare link (tot 10.000 externe testers). De eerste build gaat door een Beta App Review. Builds verlopen na 90 dagen. |
| Richtlijnen | 2.5.1: HealthKit alleen voor gezondheid en fitness en vermelden in de beschrijving. 5.1.3: geen reclame of datamining, niet opslaan in iCloud, en vermelden welke gezondheidsdata je verzamelt. 5.1.1: privacylink in de app en in App Store Connect, en account verwijderen in de app (bestaat al). 4.2: geen "verpakte website". |
| EU (DSA) | Bij publicatie in de App Store moet je je "trader-status" opgeven. Een hobby-app zonder inkomsten kan waarschijnlijk "non-trader" kiezen. Controleer dat in App Store Connect. Bij alleen TestFlight speelt dit niet. |
| Bouwen | Codemagic, gratis tier met 500 macOS-minuten per maand. |

### Kostenoverzicht

| Post | Bedrag |
|---|---|
| Google Play-account | 25 dollar eenmalig |
| Apple Developer Program (pas bij stap 3) | 99 dollar per jaar |
| Codemagic | 0 dollar (gratis tier) |
| Firebase Cloud Messaging | 0 dollar |
| Health Sync voor Huawei- of oudere Garmin-gebruikers (optioneel, per gebruiker) | een paar euro, betaald door de gebruiker |

---

## 7. Privacy en AVG

**Status van de data.** Het Europees Hof heeft in 2024 (C-21/23, Lindenapotheke) "gegevens over gezondheid" ruim uitgelegd. De Autoriteit Persoonsgegevens zag eerder al calorieverbruik en beweegdata als gevoelige gegevens (Nike+, 2015/2016). Spotter combineert stappen en kcal met gewicht, voeding en training. Behandel het daarom als **bijzondere persoonsgegevens (art. 9 AVG)**. De grondslag is **uitdrukkelijke toestemming**. Een uitzondering voor huishoudelijk gebruik is niet van toepassing: de app staat op een openbaar domein en is bedoeld om te groeien.

**Wat de app moet hebben (onderdeel van stap 1):**
1. **Drie losse toestemmingen**, allemaal standaard uit, elk met een eigen schakelaar:
   - activiteit opslaan in Spotter (vereist voor alles hieronder)
   - delen met vrienden en groepsgenoten (ranglijst, profiel)
   - gebruik door de AI-coach (gegevens gaan naar Anthropic)
2. **Bewijs van toestemming:** tijdstip, versie van de tekst en scope. Wordt opgeslagen bij elke wijziging.
3. **Intrekken is net zo makkelijk als geven:** dezelfde schakelaar. Als je de opslagtoestemming intrekt, worden alle activiteitsgegevens direct verwijderd (met een bevestigingsvraag). Een account verwijderen ruimt de gegevens ook op.
4. **Dataminimalisatie:** alleen dagtotalen (datum, stappen, actieve kcal, optioneel totale kcal, bron). Geen losse metingen, hartslag, slaap of GPS. Vraag in de apps alleen die rechten aan.
5. **Minderjarigen:** onder 16 jaar is toestemming van een ouder nodig (UAVG art. 5). Spotter blokkeert de toestemming als de geboortedatum aangeeft dat iemand jonger dan 16 is.
6. **Privacyverklaring op `https://myspotter.nl/privacy`**, openbaar zonder in te loggen. Inhoud:
   - wie verantwoordelijk is en hoe je contact opneemt
   - welke gegevens (inclusief gezondheidsgegevens), bronnen (Health Connect, Apple Health, handmatig) en doelen
   - grondslag (toestemming)
   - ontvangers en verwerkers: Supabase (database), Vercel (hosting), Anthropic (AI-coach, alleen met toestemming), Google/Apple (push)
   - doorgifte buiten de EU (Data Privacy Framework of standaardcontractbepalingen)
   - bewaartermijn: zolang de toestemming loopt, verwijderd bij intrekken of bij accountverwijdering
   - rechten: inzage, correctie, verwijderen, klacht bij de AP
   - de mededeling dat er geen advertenties, geen verkoop en geen opslag in iCloud is
7. **Verwerkersovereenkomsten:** controleer of het Supabase-project in een EU-regio staat. Accepteer de DPA van Supabase en Vercel (via de dashboards). De commerciële voorwaarden van Anthropic bevatten een DPA.
8. **DPIA:** waarschijnlijk niet verplicht bij tientallen gebruikers, maar een korte risicoanalyse van één pagina is verstandig. Doe dat opnieuw als de groep groeit.

---

## 8. Verbrande calorieën en het voedingsdoel

**Probleem.** Het dagdoel in `src/lib/nutrition/targets.ts` is `BMR × activiteitsfactor ± doel`, met standaard "Gemiddeld" (× 1,55). Die factor bevat al het verwachte bewegen. Als je de actieve kcal van een horloge daar nog eens bij optelt, tel je dubbel. Daarnaast zitten horloges er bij calorieën gemiddeld 27 tot 30 procent of meer naast (Stanford 2017; JMIR-review 2022). Stappen zijn veel nauwkeuriger (ongeveer 8 procent fout).

**Hoe andere apps het doen.** MacroFactor telt trainingscalorieën bewust niet mee. MyFitnessPal geeft alleen een correctie als het horloge meer meet dan MFP al verwachtte. Cronometer haalt het BMR-deel eruit en adviseert de activiteit op "zittend" te zetten als er een tracker gekoppeld is.

**Advies voor Spotter:**
- **Standaard: alleen tonen.** "Verbrand door activiteit: 640 kcal (schatting)" bij Voeding en op Home. Het doel verandert niet.
- **Optioneel, "Calorieën terugverdienen":** kies 25, 50, 75 of 100 procent. Bij aanzetten wordt 50 procent voorgesteld. De bonus telt alleen het deel boven de verwachte activiteit:
  - verwachte actieve kcal = `TDEE − BMR × 1,1` (bij "Gemiddeld" en BMR 1.700 is dat ongeveer 765 kcal)
  - bonus = `percentage × max(0, actieve kcal van vandaag − verwachte actieve kcal)`, met een maximum van 1.000 kcal per dag
  - zo telt een gewone dag niet extra mee, en een lange wandeldag of wedstrijd wel gedeeltelijk
- Werkt alleen als BMR en TDEE berekend kunnen worden (gewicht, lengte, leeftijd en geslacht ingevuld). Bij een handmatig kcal-doel zonder die gegevens toont Spotter de verbrande kcal alleen als informatie.
- Gebruik **actieve** kcal, nooit totale kcal. Totale kcal bevat het rustverbruik, dat al in het doel zit.

---

## 9. Stappendoel en ranglijst

- **Standaard stappendoel: 7.000 per dag**, door de gebruiker aan te passen (bijvoorbeeld 8.000 of 10.000). Een meta-analyse uit 2025 (Lancet Public Health) toont dat de gezondheidswinst rond 5.000 tot 7.000 stappen afvlakt. 10.000 blijft een prima uitdaging.
- **Weekranglijst op stappen, niet op kcal.** Kcal verschilt te veel per merk: Fitbit levert geen actieve kcal, en Samsung meet vooral trainingen. Een kcal-ranglijst zou dus oneerlijk zijn.
- Alleen gebruikers die "delen" aan hebben, verschijnen op de ranglijst (opt-in). Toon ook "X van Y dagen het doel gehaald", zodat consistentie telt en niet alleen uitschieters.
- Handmatige invoer krijgt een klein label, zodat duidelijk is welke getallen niet gemeten zijn.

---

## 10. Stappenplan met inschatting

| Fase | Inhoud | Werk (hobby-uren) | Doorlooptijd |
|---|---|---|---|
| **Stap 1: web** | SQL-script (tabel, view, toestemmingen, RPC's), Home-kaart, invoerscherm, weekranglijst, voedingsinstelling, sectie "Koppelingen" in het profiel, privacypagina, coach-tool | 15–25 uur | 1–2 weken |
| **Stap 2a: Android MVP** | Capacitor-schil, offline-scherm, plugin, sync bij openen, manifest opschonen, App Links of OTP-login, FCM-push | 25–40 uur | 2–3 weken |
| **Stap 2b: Play** | Account (25 dollar), interne test, gesloten test met 12 of meer vrienden gedurende 14 dagen, Health apps-verklaring, Data safety | 5–10 uur | 3–4 weken (wachten) |
| **Stap 2c (optioneel)** | Achtergrond-sync met WorkManager en een uploadtoken per toestel | 10–20 uur | 1–2 weken |
| **Stap 3: iOS** | Apple-account (99 dollar per jaar), Codemagic-pipeline, HealthKit-entitlements, APNs via Firebase, Universal Links, TestFlight-review | 25–40 uur | 3–6 weken |
| Optioneel | Garmin Starter-cloudkoppeling (webhook naar dezelfde tabel), voor Garmin-gebruikers met Android 13 of ouder | 10–15 uur | Afhankelijk van Garmin-goedkeuring |

Tip: maak het Play-account al tijdens stap 1 aan en meld de vrienden aan als testers zodra de eerste Android-build er is. Zo loopt de 14-dagenklok parallel aan het afbouwen.

---

## 11. Risico's

| Risico | Kans/impact | Wat te doen |
|---|---|---|
| Play wijst de Health-verklaring af, omdat het samengevoegde manifest extra rechten bevat (de plugin declareert er ongeveer 45) | Hoog / middel | `tools:node="remove"` voor alle ongebruikte rechten en het samengevoegde manifest controleren vóór de upload. |
| Garmin-sync werkt niet op de telefoon van de ouders (Android 13 of ouder) | Middel / middel | Eerst de versies uitvragen. Terugvaloptie: handmatige invoer, Health Sync of Garmin Starter. |
| Kcal-cijfers zijn onvergelijkbaar tussen merken | Hoog / laag | Ranglijst op stappen. Kcal alleen als schatting en voor jezelf. |
| Apple wijst de iOS-app af onder 4.2 | Middel / hoog | Native meerwaarde toevoegen en eerst via TestFlight verspreiden. Terugvaloptie: gebundelde SPA. |
| Achtergrond-sync is onbetrouwbaar (Samsung, Xiaomi, vergrendelde iPhone) | Hoog / laag | Synchroniseren bij openen is de basis. Toon "laatst gesynchroniseerd". |
| HealthKit verbergt geweigerde rechten (lijkt 0 stappen) | Middel / middel | 0 of leeg tonen als "geen data" en niet meetellen in de ranglijst. |
| Gezondheidsdata delen zonder geldige toestemming | Laag / hoog | Drie losse opt-ins, RLS, privacyverklaring, eenvoudig verwijderen. |
| Gesloten test loopt vertraging op (testers haken af) | Middel / laag | 14 of meer testers aanmelden en uitleggen dat ze aangemeld moeten blijven. |
| Plugin wordt minder onderhouden of moet mee naar Capacitor 9 | Laag / middel | Versies vastzetten. De integratie zit in één bestand (`src/lib/health/native.ts`), zodat wisselen goedkoop is. |
| Android-ontwikkelaarsverificatie (2027) maakt sideloaden lastiger | Zeker / laag | Via Play verspreiden. |

---

## 12. Open vragen voor de eigenaar

1. Welke telefoons en Android-versies hebben de vrienden en ouders? Hoeveel vrienden hebben een iPhone?
2. Mag de trainer (als groepslid) altijd de stappen zien, of alleen als het lid "delen" aanzet? Het advies is: alleen met delen aan, omdat dat het eenvoudigst en AVG-veilig is.
3. Is het Supabase-project in een EU-regio?
4. Zijn er leden jonger dan 16?

---

## 13. Bronnen

**Health Connect / Android**
- Aggregate data, ontdubbeling en prioriteit: https://developer.android.com/health-and-fitness/guides/health-connect/develop/aggregate-data
- Datatypes en rechten: https://developer.android.com/health-and-fitness/guides/health-connect/plan/data-types
- Aan de slag (manifest, beschikbaarheid): https://developer.android.com/health-and-fitness/guides/health-connect/develop/get-started
- Data lezen, achtergrond en historie: https://developer.android.com/health-and-fitness/guides/health-connect/develop/read-data
- Stappen van de telefoon zelf: https://developer.android.com/health-and-fitness/health-connect/features/steps
- Releases van de library: https://developer.android.com/jetpack/androidx/releases/health-connect
- Toegang declareren bij Play: https://developer.android.com/health-and-fitness/guides/health-connect/publish/declare-access
- Play Health apps-beleid: https://support.google.com/googleplay/android-developer/answer/12991134
- Testeisen voor nieuwe persoonlijke accounts: https://support.google.com/googleplay/android-developer/answer/14151465
- Android-ontwikkelaarsverificatie: https://android-developers.googleblog.com/2026/03/android-developer-verification-rolling-out-to-all-developers.html

**Plugins en Capacitor**
- @capgo/capacitor-health (broncode en README): https://github.com/Cap-go/capacitor-health
- npm-registry: https://registry.npmjs.org/@capgo/capacitor-health
- Capacitor-configuratie (server.url): https://capacitorjs.com/docs/config
- Capacitor 8-upgrade: https://capacitorjs.com/docs/updating/8-0
- Deep links: https://capacitorjs.com/docs/guides/deep-links
- Next.js static export (beperkingen): https://nextjs.org/docs/app/guides/static-exports

**Apple**
- HealthKit-statistieken: https://developer.apple.com/documentation/healthkit/hkstatistics
- HealthKit-privacy: https://developer.apple.com/documentation/healthkit/protecting-user-privacy
- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- TestFlight: https://developer.apple.com/testflight/
- Developer Program: https://developer.apple.com/programs/
- Codemagic-prijzen: https://codemagic.io/pricing/

**Wearables en cloud-API's**
- Garmin en Health Connect: https://www.androidcentral.com/wearables/garmin/heres-everything-garmin-will-and-wont-share-with-google-health-connect
- Garmin Connect Developer Program: https://developer.garmin.com/gc-developer-program/overview
- Google Health API / einde Fitbit Web API: https://developers.google.com/health/about
- Google Fit-deprecatie: https://developers.google.com/fit
- Fitbit/Google Health en Health Connect: https://support.google.com/fitbit/answer/14506680
- Samsung Health en Health Connect: https://developer.samsung.com/health/blog/en/accessing-samsung-health-data-through-health-connect
- Fitbit naar Apple Health (aug 2026): https://www.macrumors.com/2026/08/03/fitbit-apple-health-syncing/

**Privacy en AVG**
- AVG-tekst: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- CJEU C-21/23 Lindenapotheke: https://cm.twobirds.com/en/insights/2024/global/feeling-unwell-after-the-cjeus-lindenapotheke-decision
- AP over wearables: https://www.dataprotectionreport.com/2016/03/dutch-dpa-employers-may-not-process-employee-health-data-from-wearables/
- Nike+ en CBP: https://www.iculture.nl/nieuws/nike-running-app-aangepast-kritiek-cbp/
- EDPB over toestemming: https://www.edpb.europa.eu/system/files/2026-04/edpb-summary-consent_en.pdf
- DPIA-lijst AP: https://zoek.officielebekendmakingen.nl/stcrt-2019-64418.pdf

**Calorieën en stappen**
- Nauwkeurigheid van energieverbruik (JMIR-review 2022): https://pubmed.ncbi.nlm.nih.gov/35060915/
- Nauwkeurigheid wearables (review): https://pmc.ncbi.nlm.nih.gov/articles/PMC8817215/
- MacroFactor over trainingscalorieën: https://help.macrofactorapp.com/en/articles/256-i-ve-started-exercising-more-why-isn-t-my-expenditure-increasing
- Cronometer en Garmin: https://support.cronometer.com/hc/en-us/articles/16957825757204-Garmin
- Stappen en sterfte (Lancet Public Health 2025): https://pubmed.ncbi.nlm.nih.gov/40713949/
- Competitie en beweging (STEP UP, JAMA Intern Med 2019): https://pubmed.ncbi.nlm.nih.gov/31498375/
