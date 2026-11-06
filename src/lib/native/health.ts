"use client";

/**
 * Health Connect (Android-app) → dagtotalen in Spotter. Zie docs/android-app.md en
 * docs/health-koppeling.md (3.2, 5).
 *
 * Werkt alleen in de Android-app (Capacitor). Op het web en tijdens server-rendering doet niets
 * hier iets: de plugins (@capgo/capacitor-health, @capacitor/app) worden pas met een dynamische
 * import geladen als `isNativeApp()` waar is, dus ze komen niet in de webbundel van een pagina.
 *
 * ── Publieke API ────────────────────────────────────────────────────────────────────────────────
 * - isNativeApp(), nativePlatform(), nativeBridgeMissing()
 * - healthAvailability() → { status: "available" | "needs_install" | "unsupported", reason? }
 * - nativeSupportsSleep() → kan deze app slaap lezen (Android: APK met versionCode >= 2; oudere APK's: false,
 *   toon "werk de app bij"). Zonder ondersteuning is HealthPermissions.sleep altijd false.
 * - healthPermissions() → { steps, calories, sleep } (zonder te vragen)
 * - requestHealthPermissions({ sleep }) → { steps, calories, sleep } (toont het rechtenscherm van Health Connect;
 *   alle drie tegelijk, de gebruiker kan slaap uitzetten en stappen blijven werken; sleep: false = slaap niet
 *   vragen, bijv. zolang de toestemming in Spotter van vóór slaap is)
 * - openHealthConnectSettings()
 * - syncHealth(userId, { days, sleepConsent, manual }) → { sent, days, at, sleep } — dagtotalen van de laatste
 *   `days` lokale dagen (incl. vandaag) in ÉÉN aanroep naar upsert_daily_activity met bron "health_connect"
 *   (als Spotter stappen mag lezen), en daarna (als het recht er is én sleepConsent: toestemming in Spotter
 *   voor de tekst met slaap) de nachten in ÉÉN aanroep naar upsert_daily_sleep (zie syncSleep). Alleen slaap
 *   (zonder recht op stappen) kan ook. Mislukt alleen de slaap, dan slaagt de sync wel: zie result.sleep.status.
 * - buildSleepNights(samples, dates) — puur: slaapmetingen → één nacht per wakkerworddatum (los te testen;
 *   ook bruikbaar voor HealthKit).
 * - syncDaysSince(lastSyncAt, min): hoeveel dagen een sync moet ophalen om niets te missen.
 * - healthSyncInFlight(): de lopende sync (om op te wachten vóór verwijderen).
 * - Koppeling op dit toestel (localStorage, per gebruiker): getHealthLink, markHealthConnected,
 *   disconnectHealth, useHealthLink(userId).
 * - HEALTH_CONNECT_PLAY_URL: Health Connect installeren of bijwerken (Android 13 en ouder).
 * - healthErrorMessage(err): Nederlandse melding (de plugin meldt fouten in het Engels).
 *
 * Gebruikte plugin-API (@capgo/capacitor-health 8.11, gecontroleerd in de broncode):
 * - isAvailable() → { available, reason } (reason: "Health Connect needs an update." /
 *   "Health Connect is unavailable on this device.")
 * - requestAuthorization / checkAuthorization({ read: ["steps", "calories", "sleep"] }) → readAuthorized[]
 *   ("calories" = ActiveCaloriesBurnedRecord = READ_ACTIVE_CALORIES_BURNED,
 *   "sleep" = SleepSessionRecord = READ_SLEEP)
 * - readSamples({ dataType: "sleep" }): Android geeft één meting per SleepSessionRecord (value = duur in
 *   minuten, sourceId = pakketnaam) met `stages` als de app fases schrijft (awake, asleep, light, deep, rem;
 *   AWAKE_IN_BED telt als awake, OUT_OF_BED/UNKNOWN vallen weg). Zonder fases: alleen de sessie
 *   (hasStageData false). iOS geeft één meting per HKCategorySample (sleepState inBed, asleep, awake,
 *   light = core, deep, rem; stages = [die ene fase]). Een nacht is dus een groep metingen per app.
 * - queryAggregated({ dataType, startDate, endDate, bucket: "day", aggregation: "sum" }):
 *   Health Connect aggregateGroupByDuration (ontdubbeld volgens de app-prioriteit van de gebruiker).
 *   Datums als ISO met "Z" (Instant.parse). Emmers van precies 24 uur vanaf startDate; emmers zonder
 *   data worden weggelaten. Eenheden: "count" (stappen) en "kilocalorie".
 */

import { useMemo, useSyncExternalStore } from "react";
import { ACTIVITY_LIMITS, activityErrorMessage, upsertDailyActivity, type DailyActivityPayload } from "@/lib/activity";
import { toISODate } from "@/lib/dates";
import { isSleepReconsentError, isSleepUnavailable, SLEEP_LIMITS, sleepErrorMessage, upsertDailySleep, type DailySleepPayload } from "@/lib/sleep";

// ─────────────── Platform ───────────────

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

function capacitorGlobal(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  // De native schil zet window.Capacitor voordat de pagina laadt; in een browser bestaat hij niet.
  return (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** Draait deze pagina in de Android- (of later iOS-)app? Altijd false op de server en in de browser. */
export function isNativeApp(): boolean {
  try {
    return !!capacitorGlobal()?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/** Achter de user agent van de app-WebView geplakt (capacitor.config.ts, appendUserAgent). */
export const NATIVE_USER_AGENT = "SpotterApp";

/**
 * In de app, maar zonder Capacitor-brug: de pagina komt van een ander adres dan server.url (bijv. na
 * een doorverwijzing naar een nieuw domein). Health Connect en de terugknop werken dan niet; de app
 * moet bijgewerkt worden.
 */
export function nativeBridgeMissing(): boolean {
  if (typeof navigator === "undefined" || isNativeApp()) return false;
  return navigator.userAgent.includes(NATIVE_USER_AGENT);
}

export function nativePlatform(): "android" | "ios" | "web" {
  if (!isNativeApp()) return "web";
  const p = capacitorGlobal()?.getPlatform?.();
  return p === "android" || p === "ios" ? p : "web";
}

/**
 * Laadt de plugin. Geeft hem bewust ingepakt terug ({ Health }) en nooit de plugin zelf: een
 * Capacitor-plugin is een Proxy die voor élke eigenschap een native methode maakt, ook voor `then`.
 * `await` op een async functie die de plugin zelf teruggeeft roept dan Health.then(...) native aan,
 * en die belofte komt nooit terug (de app bleef zo hangen op "Controleren…").
 */
async function healthPlugin(): Promise<{ Health: typeof import("@capgo/capacitor-health").Health }> {
  if (!isNativeApp()) throw new Error("Health Connect werkt alleen in de Android-app.");
  const mod = await import("@capgo/capacitor-health");
  return { Health: mod.Health };
}

/** Native aanroepen mogen nooit eeuwig blijven hangen: na `ms` een duidelijke fout. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Health Connect reageert niet (${what}). Probeer het opnieuw.`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Korte Nederlandse melding voor een toast. De plugin meldt fouten in het Engels; de server al in het Nederlands. */
export function healthErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/needs an update/i.test(msg)) return "Werk Health Connect eerst bij via de Play Store.";
  if (/unavailable on this device/i.test(msg)) return "Health Connect werkt niet op dit toestel.";
  if (/permission request/i.test(msg)) return "Het rechtenscherm van Health Connect kon niet worden geopend.";
  if (/securityexception|health permission|not granted|caller doesn.t have/i.test(msg)) return "Spotter heeft geen toegang tot deze gegevens. Controleer de rechten in Health Connect.";
  if (/rate ?limit|quota/i.test(msg)) return "Health Connect vraagt even te wachten. Probeer het zo opnieuw.";
  if (/bron is nog niet beschikbaar/i.test(msg)) return "Synchroniseren met Health Connect is nog niet ingeschakeld op de server.";
  return activityErrorMessage(err);
}

// ─────────────── Beschikbaarheid en rechten ───────────────

export type HealthAvailability = {
  /**
   * available: Health Connect is er en werkt.
   * needs_install: Health Connect moet geïnstalleerd of bijgewerkt worden (Android 13 en ouder).
   * unsupported: kan niet op dit toestel (of niet in de app).
   * error: controleren mislukte (bijv. geen antwoord); opnieuw proberen kan helpen.
   */
  status: "available" | "needs_install" | "unsupported" | "error";
  reason?: string;
};

/** Health Connect in de Play Store (installeren of bijwerken op Android 9 t/m 13). */
export const HEALTH_CONNECT_PLAY_URL = "https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata";

export async function healthAvailability(): Promise<HealthAvailability> {
  if (nativePlatform() !== "android") return { status: "unsupported" };
  try {
    const { Health } = await withTimeout(healthPlugin(), 15_000, "laden");
    const r = await withTimeout(Health.isAvailable(), 8_000, "beschikbaarheid");
    if (r.available) return { status: "available" };
    if (/update/i.test(r.reason ?? "")) return { status: "needs_install", reason: r.reason };
    return { status: "unsupported", reason: r.reason };
  } catch (err) {
    return { status: "error", reason: err instanceof Error ? err.message : undefined };
  }
}

/** Alleen lezen, alleen deze drie. Nooit schrijven. Gelijk aan de rechten in AndroidManifest.xml. */
const READ_TYPES = ["steps", "calories", "sleep"] as const;

/**
 * Eerste versionCode van de Android-app (android/app/build.gradle) met READ_SLEEP in het manifest. Oudere
 * APK's laden dezelfde site, maar Health Connect geeft hen nooit slaap; daar vragen we het dus niet
 * (anders zou het rechtenscherm bij elke poging opnieuw verschijnen).
 */
const SLEEP_MIN_ANDROID_BUILD = 2;
let sleepSupport: Promise<boolean> | null = null;

/**
 * Kan deze app slaap lezen? Android: alleen een APK vanaf SLEEP_MIN_ANDROID_BUILD (anders: "werk de app
 * bij"). iOS: ja (later). Web: nee.
 */
export function nativeSupportsSleep(): Promise<boolean> {
  const platform = nativePlatform();
  if (platform !== "android") return Promise.resolve(platform === "ios");
  sleepSupport ??= (async () => {
    try {
      const { App } = await import("@capacitor/app");
      const info = await withTimeout(App.getInfo(), 5_000, "appversie");
      return Number(info.build) >= SLEEP_MIN_ANDROID_BUILD;
    } catch {
      return false;
    }
  })();
  return sleepSupport;
}

async function readTypes(includeSleep = true): Promise<string[]> {
  return includeSleep && (await nativeSupportsSleep()) ? [...READ_TYPES] : READ_TYPES.filter((t) => t !== "sleep");
}

/** Per gegevenstype: mag Spotter het lezen? sleep = READ_SLEEP (los te weigeren; stappen werken dan gewoon). */
export type HealthPermissions = { steps: boolean; calories: boolean; sleep: boolean };

function toPermissions(readAuthorized: readonly string[] | undefined): HealthPermissions {
  const set = new Set(readAuthorized ?? []);
  return { steps: set.has("steps"), calories: set.has("calories"), sleep: set.has("sleep") };
}

/** Huidige rechten, zonder iets te vragen. */
export async function healthPermissions(): Promise<HealthPermissions> {
  const { Health } = await withTimeout(healthPlugin(), 15_000, "laden");
  const read = (await readTypes()) as (typeof READ_TYPES)[number][];
  const r = await withTimeout(Health.checkAuthorization({ read, write: [] }), 10_000, "rechten");
  return toPermissions(r.readAuthorized);
}

/**
 * Toont het rechtenscherm van Health Connect (stappen, actieve kcal en slaap, alleen lezen). Rechten die
 * al gegeven zijn, staan daar al aan; zo kan een bestaande koppeling ook alleen slaap erbij zetten.
 * sleep: false = niet om slaap vragen (geen toestemming in Spotter voor de tekst die slaap noemt).
 */
export async function requestHealthPermissions({ sleep = true }: { sleep?: boolean } = {}): Promise<HealthPermissions> {
  const { Health } = await withTimeout(healthPlugin(), 15_000, "laden");
  // Geen time-out: hier wacht de app op de keuze van de gebruiker in het rechtenscherm.
  const read = (await readTypes(sleep)) as (typeof READ_TYPES)[number][];
  const r = await Health.requestAuthorization({ read, write: [] });
  return toPermissions(r.readAuthorized);
}

/** Opent de instellingen van Health Connect (rechten, app-prioriteit, gegevens). */
export async function openHealthConnectSettings(): Promise<void> {
  const { Health } = await withTimeout(healthPlugin(), 15_000, "laden");
  await withTimeout(Health.openHealthConnectSettings(), 10_000, "instellingen openen");
}

// ─────────────── Koppeling op dit toestel ───────────────

export type HealthLink = {
  connected: boolean;
  connectedAt: string | null;
  /** Laatste geslaagde sync (ISO). */
  lastSyncAt: string | null;
  /** Aantal dagen met data bij de laatste sync. */
  lastSyncDays: number;
  /** Wat Health Connect bij de laatste sync teruggaf voor de laatste 3 dagen (nieuwste eerst), om te kunnen controleren. */
  lastSyncPreview: HealthDayPreview[];
  /** Versie van de telmethode bij de laatste sync; ouder dan SYNC_METHOD = eenmalig 30 dagen opnieuw ophalen. */
  method: number;
  /**
   * Laatste geslaagde slaapsync (ISO), of null als slaap nog nooit gelukt is (dan haalt de volgende
   * sync 30 nachten op, bijv. nadat het recht op slaap later is gegeven).
   */
  lastSleepSyncAt: string | null;
  /** Nachten bij de laatste slaapsync, laatste 3 wakkerworddatums (nieuwste eerst), om te kunnen controleren. */
  lastSleepPreview: HealthSleepPreview[];
  /**
   * Laatste keer (ISO) dat de server slaap weigerde omdat upgrade-sleep.sql nog niet is gedraaid. Automatische
   * syncs slaan slaap dan 24 uur over (geen 30 nachten lezen voor niets); "Nu synchroniseren" probeert het wel.
   */
  lastSleepBlockedAt: string | null;
};

/**
 * 2: per dag de app met de meeste stappen (geen som over apps). 3: slaap erbij. Ophogen = iedereen haalt
 * eenmalig 30 dagen opnieuw op.
 */
const SYNC_METHOD = 3;

export type HealthSleepPreview = {
  /** Wakkerworddatum. */
  date: string;
  /** null = geen nacht gevonden. */
  asleepMinutes: number | null;
  bedtime: string | null;
  wakeTime: string | null;
  /** Pakketnaam van de app waar de nacht vandaan komt. */
  app: string | null;
};

export type HealthDayPreview = { date: string; steps: number | null; kcal: number | null; /** Pakketnaam van de app waar de stappen vandaan komen. */ app?: string | null };

const EMPTY_LINK: HealthLink = {
  connected: false,
  connectedAt: null,
  lastSyncAt: null,
  lastSyncDays: 0,
  lastSyncPreview: [],
  method: 0,
  lastSleepSyncAt: null,
  lastSleepPreview: [],
  lastSleepBlockedAt: null,
};

function parsePreview(v: unknown): HealthDayPreview[] {
  if (!Array.isArray(v)) return [];
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return v
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object" && typeof (d as { date?: unknown }).date === "string")
    .slice(0, 3)
    .map((d) => ({ date: d.date as string, steps: num(d.steps), kcal: num(d.kcal), app: typeof d.app === "string" ? d.app : null }));
}

function parseSleepPreview(v: unknown): HealthSleepPreview[] {
  if (!Array.isArray(v)) return [];
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const str = (x: unknown) => (typeof x === "string" ? x : null);
  return v
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object" && typeof (d as { date?: unknown }).date === "string")
    .slice(0, 3)
    .map((d) => ({ date: d.date as string, asleepMinutes: num(d.asleepMinutes), bedtime: str(d.bedtime), wakeTime: str(d.wakeTime), app: str(d.app) }));
}
const LINK_EVENT = "spotter:health-link";
const linkKey = (userId: string) => `spotter:health-connect:${userId}`;

function readRaw(userId: string): string | null {
  try {
    return window.localStorage.getItem(linkKey(userId));
  } catch {
    return null;
  }
}

function parseLink(raw: string | null): HealthLink {
  if (!raw) return EMPTY_LINK;
  try {
    const v = JSON.parse(raw) as Partial<HealthLink>;
    return {
      connected: v.connected === true,
      connectedAt: typeof v.connectedAt === "string" ? v.connectedAt : null,
      lastSyncAt: typeof v.lastSyncAt === "string" ? v.lastSyncAt : null,
      lastSyncDays: Number(v.lastSyncDays) || 0,
      lastSyncPreview: parsePreview(v.lastSyncPreview),
      method: Number(v.method) || 0,
      lastSleepSyncAt: typeof v.lastSleepSyncAt === "string" ? v.lastSleepSyncAt : null,
      lastSleepPreview: parseSleepPreview(v.lastSleepPreview),
      lastSleepBlockedAt: typeof v.lastSleepBlockedAt === "string" ? v.lastSleepBlockedAt : null,
    };
  } catch {
    return EMPTY_LINK;
  }
}

function writeLink(userId: string, link: HealthLink | null) {
  try {
    if (link) window.localStorage.setItem(linkKey(userId), JSON.stringify(link));
    else window.localStorage.removeItem(linkKey(userId));
  } catch {
    // Geen opslag: de koppeling geldt dan alleen tot de app sluit.
  }
  window.dispatchEvent(new Event(LINK_EVENT));
}

export function getHealthLink(userId: string): HealthLink {
  if (typeof window === "undefined" || !userId) return EMPTY_LINK;
  return parseLink(readRaw(userId));
}

export function markHealthConnected(userId: string) {
  const cur = getHealthLink(userId);
  writeLink(userId, { ...cur, connected: true, connectedAt: cur.connectedAt ?? new Date().toISOString() });
}

/**
 * Koppeling op dit toestel vergeten (de opgeslagen dagen in Spotter blijven staan). De rechten in
 * Health Connect zelf trekt de gebruiker in via openHealthConnectSettings().
 */
export function disconnectHealth(userId: string) {
  writeLink(userId, null);
}

function subscribeLink(fn: () => void) {
  window.addEventListener(LINK_EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(LINK_EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}

/** De koppeling van deze gebruiker op dit toestel, live bijgewerkt na elke sync. */
export function useHealthLink(userId: string | null): HealthLink {
  const raw = useSyncExternalStore(
    subscribeLink,
    () => (userId ? readRaw(userId) : null),
    () => null,
  );
  return useMemo(() => parseLink(raw), [raw]);
}

// ─────────────── Synchroniseren ───────────────

const DAY_MS = 86_400_000;

/** Normaal aantal dagen; bij de eerste sync na het koppelen 30 (Health Connect geeft standaard hooguit 30 dagen terug). */
export const HEALTH_SYNC_DAYS = 7;
export const HEALTH_FIRST_SYNC_DAYS = 30;
/** Horloges synchroniseren vaak later: een automatische sync haalt altijd minstens de laatste 3 dagen opnieuw op. */
export const HEALTH_RESYNC_DAYS = 3;

/**
 * Aantal dagen (incl. vandaag) dat een sync moet ophalen om sinds `lastSyncAt` niets te missen, minstens
 * `min` en hooguit 30. Nog nooit gesynchroniseerd: 30.
 */
export function syncDaysSince(lastSyncAt: string | null, min = HEALTH_RESYNC_DAYS): number {
  const last = lastSyncAt ? Date.parse(lastSyncAt) : NaN;
  if (!Number.isFinite(last)) return HEALTH_FIRST_SYNC_DAYS;
  const since = Math.max(0, Date.now() - last);
  return Math.min(HEALTH_FIRST_SYNC_DAYS, Math.max(min, Math.ceil(since / DAY_MS) + 1));
}

type DayRange = { date: string; start: Date; end: Date };

/** De laatste `days` lokale kalenderdagen t/m vandaag, oudste eerst. Middernacht in de tijdzone van de telefoon. */
function localDays(days: number, now = new Date()): DayRange[] {
  const out: DayRange[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i + 1);
    out.push({ date: toISODate(start), start, end });
  }
  return out;
}

/**
 * De plugin snijdt de periode in emmers van precies 24 uur vanaf startDate. Rond de wissel van zomer-
 * naar wintertijd is een lokale dag 23 of 25 uur, dus per stuk met alleen dagen van 24 uur één
 * aanvraag, en zo'n afwijkende dag apart. Meestal is dat één aanvraag per gegevenstype.
 */
function segments(days: DayRange[]): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date; regular: boolean }[] = [];
  for (const d of days) {
    const regular = d.end.getTime() - d.start.getTime() === DAY_MS;
    const last = out[out.length - 1];
    if (regular && last?.regular && last.end.getTime() === d.start.getTime()) last.end = d.end;
    else out.push({ start: d.start, end: d.end, regular });
  }
  return out;
}

/** Som per lokale dag voor één gegevenstype ("steps" of "calories"). */
async function dailySums(dataType: "steps" | "calories", days: DayRange[]): Promise<Map<string, number>> {
  const { Health } = await withTimeout(healthPlugin(), 15_000, "laden");
  const sums = new Map<string, number>();
  for (const seg of segments(days)) {
    const { samples } = await withTimeout(
      Health.queryAggregated({
        dataType,
        startDate: seg.start.toISOString(),
        endDate: seg.end.toISOString(),
        bucket: "day",
        aggregation: "sum",
      }),
      30_000,
      "gegevens ophalen",
    );
    for (const s of samples ?? []) {
      const value = s.values?.sum ?? s.value;
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      // Begin van de emmer (UTC) → lokale datum. Een 25-uursdag levert een extra emmer van 1 uur
      // die nog op dezelfde datum begint; die telt mee.
      const date = toISODate(new Date(s.startDate));
      sums.set(date, (sums.get(date) ?? 0) + value);
    }
  }
  return sums;
}

type DayBest = { value: number; app: string | null };

/** Maximaal aantal losse metingen per sync; daarboven terugvallen op de dagtotalen van Health Connect. */
const MAX_RECORDS = 100_000;

/**
 * Per lokale dag het totaal van de app met het hoogste totaal (bijv. Samsung Health of Garmin Connect),
 * in plaats van de som over alle apps. Waarom: op Android 14+ telt Health Connect ook zelf stappen van
 * de telefoon, en Samsung Health of een horloge-app schrijft daarnaast zijn eigen dagtelling (waar de
 * telefoonstappen al in zitten). Het dagtotaal van Health Connect telde die in de praktijk dubbel,
 * ondanks de app-prioriteit. Apps worden hier dus nooit bij elkaar opgeteld.
 * Lukt het lezen van losse metingen niet (te veel data, fout), dan het dagtotaal van Health Connect.
 */
async function dailyBest(dataType: "steps" | "calories", days: DayRange[]): Promise<Map<string, DayBest>> {
  const { Health } = await withTimeout(healthPlugin(), 15_000, "laden");
  const first = days[0];
  const last = days[days.length - 1];
  try {
    const { samples } = await withTimeout(
      Health.readSamples({
        dataType,
        startDate: first.start.toISOString(),
        endDate: last.end.toISOString(),
        limit: MAX_RECORDS,
        ascending: true,
      }),
      60_000,
      "metingen ophalen",
    );
    if ((samples?.length ?? 0) >= MAX_RECORDS) throw new Error("te veel metingen");
    const perDay = new Map<string, Map<string, number>>();
    for (const r of samples ?? []) {
      if (typeof r.value !== "number" || !Number.isFinite(r.value)) continue;
      const date = toISODate(new Date(r.startDate));
      const app = r.sourceId || r.sourceName || "onbekend";
      const byApp = perDay.get(date) ?? new Map<string, number>();
      byApp.set(app, (byApp.get(app) ?? 0) + r.value);
      perDay.set(date, byApp);
    }
    const out = new Map<string, DayBest>();
    for (const [date, byApp] of perDay) {
      let best: DayBest | null = null;
      for (const [app, value] of byApp) if (!best || value > best.value) best = { value, app };
      if (best) out.set(date, best);
    }
    return out;
  } catch {
    const sums = await dailySums(dataType, days);
    return new Map([...sums].map(([date, value]) => [date, { value, app: null }]));
  }
}

function bounded(v: number | undefined, lim: { min: number; max: number }): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  // Buiten de grenzen van de server: weglaten in plaats van de hele sync te laten mislukken.
  return n >= lim.min && n <= lim.max ? n : null;
}

// ─────────────── Slaap ───────────────

type SleepKind = "inBed" | "asleep" | "light" | "deep" | "rem" | "awake";
const SLEEP_KINDS = new Set<string>(["inBed", "asleep", "light", "deep", "rem", "awake"]);
const ASLEEP_KINDS = new Set<SleepKind>(["asleep", "light", "deep", "rem"]);
type SleepSegment = { start: number; end: number; kind: SleepKind };

/** De velden van een slaapmeting uit de plugin (HealthSample met dataType "sleep") die hier tellen. */
export type SleepSampleLike = {
  startDate: string;
  endDate: string;
  sourceId?: string;
  sourceName?: string;
  sleepState?: string;
  stages?: { startDate: string; endDate: string; stage: string }[];
};

/** Eén nacht uit Health Connect of Apple Health, van één app. Minuten afgerond; tijden als ISO (UTC). */
export type SleepNight = {
  /** Lokale datum van wakker worden. */
  date: string;
  /** Pakketnaam (Android) of bundle-id (iOS) van de app. */
  app: string;
  asleepMinutes: number;
  inBedMinutes: number;
  bedtime: string;
  wakeTime: string;
  /** Heeft de app fases geschreven (licht, diep, REM)? Zo'n nacht is gemeten (meestal een horloge). */
  hasStages: boolean;
  /** null = de app schrijft geen fases. */
  deepMinutes: number | null;
  lightMinutes: number | null;
  remMinutes: number | null;
  awakeMinutes: number | null;
};

/** Onderbrekingen tot zoveel tijd horen nog bij dezelfde nacht (de wakkere tijd zelf telt niet als slaap). */
const SLEEP_GAP_MS = 3 * 3_600_000;
/** Korter dan dit (tijd in bed) en begonnen overdag (NAP_DAY_START_HOUR tot NAP_DAY_END_HOUR, lokaal): een dutje. */
const NAP_MAX_MINUTES = 180;
const NAP_DAY_START_HOUR = 9;
const NAP_DAY_END_HOUR = 19;

/** Een dutje overdag (geen nachtrust): kort en begonnen tussen 09:00 en 19:00 lokale tijd. */
function isNap(night: SleepNight): boolean {
  const hour = new Date(night.bedtime).getHours();
  return night.inBedMinutes < NAP_MAX_MINUTES && hour >= NAP_DAY_START_HOUR && hour < NAP_DAY_END_HOUR;
}

/**
 * Is `a` een betere nacht voor dezelfde datum dan `b` (uit een andere app)? Eerst een nacht met fases
 * (gemeten door een horloge) boven een nacht zonder (een handmatige invoer of schatting van de telefoon
 * telt in Health Connect helemaal als slaap en zou anders altijd winnen); daarna de meeste slaap, dan
 * de langste tijd in bed.
 */
function betterNight(a: SleepNight, b: SleepNight): boolean {
  if (a.hasStages !== b.hasStages) return a.hasStages;
  if (a.asleepMinutes !== b.asleepMinutes) return a.asleepMinutes > b.asleepMinutes;
  return a.inBedMinutes > b.inBedMinutes;
}
/** Maximaal aantal slaapmetingen per sync (iOS geeft één meting per fase; Android één per nacht). */
const MAX_SLEEP_RECORDS = 20_000;

function sleepSegments(s: SleepSampleLike, platform: "android" | "ios"): SleepSegment[] {
  const start = Date.parse(s.startDate);
  const end = Date.parse(s.endDate);
  const out: SleepSegment[] = [];
  const push = (a: number, b: number, kind: string) => {
    if (Number.isFinite(a) && Number.isFinite(b) && b > a && SLEEP_KINDS.has(kind)) out.push({ start: a, end: b, kind: kind as SleepKind });
  };
  const stages = Array.isArray(s.stages) ? s.stages.filter((st) => st && SLEEP_KINDS.has(st.stage)) : [];
  if (stages.length) {
    for (const st of stages) push(Date.parse(st.startDate), Date.parse(st.endDate), st.stage);
  } else if (s.sleepState && SLEEP_KINDS.has(s.sleepState)) {
    push(start, end, s.sleepState);
  } else if (platform === "android") {
    // Health Connect-sessie zonder fases: de hele sessie geldt als slaap.
    push(start, end, "asleep");
  } else {
    // iOS: onbekende slaapwaarde; overslaan.
    return [];
  }
  // De sessie (Android) of de meting zelf (iOS) telt als tijd in bed.
  push(start, end, "inBed");
  return out;
}

/** Totale duur van de vereniging van intervallen (overlap telt één keer), in ms. */
function unionMs(segs: SleepSegment[]): number {
  if (!segs.length) return 0;
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = sorted[0].start;
  let curEnd = sorted[0].end;
  for (const s of sorted.slice(1)) {
    if (s.start > curEnd) {
      total += curEnd - curStart;
      curStart = s.start;
      curEnd = s.end;
    } else if (s.end > curEnd) {
      curEnd = s.end;
    }
  }
  return total + (curEnd - curStart);
}

const toMin = (ms: number) => Math.round(ms / 60_000);

function nightFrom(app: string, segs: SleepSegment[]): SleepNight {
  const of = (k: SleepKind) => segs.filter((s) => s.kind === k);
  const start = Math.min(...segs.map((s) => s.start));
  const end = Math.max(...segs.map((s) => s.end));
  const hasStages = segs.some((s) => s.kind === "light" || s.kind === "deep" || s.kind === "rem");
  const hasAwake = hasStages || segs.some((s) => s.kind === "awake");
  return {
    date: toISODate(new Date(end)),
    app,
    asleepMinutes: toMin(unionMs(segs.filter((s) => ASLEEP_KINDS.has(s.kind)))),
    inBedMinutes: toMin(unionMs(segs)),
    bedtime: new Date(start).toISOString(),
    wakeTime: new Date(end).toISOString(),
    hasStages,
    deepMinutes: hasStages ? toMin(unionMs(of("deep"))) : null,
    lightMinutes: hasStages ? toMin(unionMs(of("light"))) : null,
    remMinutes: hasStages ? toMin(unionMs(of("rem"))) : null,
    awakeMinutes: hasAwake ? toMin(unionMs(of("awake"))) : null,
  };
}

/**
 * Puur: slaapmetingen → per wakkerworddatum (uit `dates`) één nacht.
 * 1. Per app (sourceId) de metingen groeperen tot nachten: wat minder dan 3 uur uit elkaar ligt, hoort bij
 *    dezelfde nacht. Slaap = vereniging van de fases asleep/light/deep/rem (wakker en "in bed" tellen niet);
 *    een Android-sessie zonder fases telt helemaal als slaap. Tijd in bed = vereniging van alles.
 * 2. De nacht hoort bij de lokale datum van het einde (wakker worden). Dutjes overdag (korter dan 3 uur in
 *    bed en begonnen tussen 09:00 en 19:00) vallen weg, ook als er die dag niets anders is. Per app en datum
 *    telt daarna de langste nacht.
 * 3. Per datum één app (betterNight): eerst een nacht met fases (gemeten door een horloge), dan de meeste
 *    slaap. Apps worden NOOIT opgeteld: Samsung Health en een horloge-app schrijven vaak dezelfde nacht
 *    allebei (zelfde reden als bij stappen, zie dailyBest).
 */
export function buildSleepNights(samples: readonly SleepSampleLike[], dates: readonly string[], platform: "android" | "ios" = "android"): Map<string, SleepNight> {
  const wanted = new Set(dates);
  const byApp = new Map<string, SleepSegment[]>();
  for (const s of samples) {
    const segs = sleepSegments(s, platform);
    if (!segs.length) continue;
    const app = s.sourceId || s.sourceName || "onbekend";
    const list = byApp.get(app) ?? [];
    list.push(...segs);
    byApp.set(app, list);
  }

  const best = new Map<string, SleepNight>();
  for (const [app, segs] of byApp) {
    segs.sort((a, b) => a.start - b.start);
    const clusters: SleepSegment[][] = [];
    let cur: SleepSegment[] = [];
    let curEnd = -Infinity;
    for (const s of segs) {
      if (cur.length && s.start > curEnd + SLEEP_GAP_MS) {
        clusters.push(cur);
        cur = [];
        curEnd = -Infinity;
      }
      cur.push(s);
      curEnd = Math.max(curEnd, s.end);
    }
    if (cur.length) clusters.push(cur);

    // Per datum de langste nacht van deze app.
    const perDate = new Map<string, SleepNight>();
    for (const c of clusters) {
      const night = nightFrom(app, c);
      if (!wanted.has(night.date) || night.asleepMinutes <= 0 || isNap(night)) continue;
      const prev = perDate.get(night.date);
      if (!prev || night.asleepMinutes > prev.asleepMinutes) perDate.set(night.date, night);
    }
    // Per datum de beste app: gemeten (met fases) gaat voor, daarna de meeste slaap.
    for (const [date, night] of perDate) {
      const prev = best.get(date);
      if (!prev || betterNight(night, prev)) best.set(date, night);
    }
  }
  return best;
}

/** Leest de slaap rond `range` (plus de avond ervoor) en bouwt per wakkerworddatum één nacht. */
async function readSleepNights(range: DayRange[], platform: "android" | "ios"): Promise<Map<string, SleepNight>> {
  const { Health } = await withTimeout(healthPlugin(), 15_000, "laden");
  // Een dag eerder beginnen: de nacht van de eerste datum begon de avond ervoor.
  const start = new Date(range[0].start.getTime() - DAY_MS);
  const end = range[range.length - 1].end;
  const { samples } = await withTimeout(
    Health.readSamples({ dataType: "sleep", startDate: start.toISOString(), endDate: end.toISOString(), limit: MAX_SLEEP_RECORDS, ascending: true }),
    60_000,
    "slaap ophalen",
  );
  return buildSleepNights((samples ?? []) as SleepSampleLike[], range.map((d) => d.date), platform);
}

/** Een nacht binnen de grenzen van de server, of null (dan overslaan in plaats van de sync te laten mislukken). */
function sleepPayload(n: SleepNight): DailySleepPayload | null {
  const asleep = bounded(n.asleepMinutes, SLEEP_LIMITS.asleep);
  const inBed = bounded(n.inBedMinutes, SLEEP_LIMITS.inBed);
  const span = Date.parse(n.wakeTime) - Date.parse(n.bedtime);
  if (asleep == null || asleep < 1 || inBed == null || inBed < asleep || !(span > 0 && span <= DAY_MS)) return null;
  return {
    date: n.date,
    asleep_minutes: asleep,
    in_bed_minutes: inBed,
    bedtime: n.bedtime,
    wake_time: n.wakeTime,
    deep_minutes: n.deepMinutes == null ? null : bounded(n.deepMinutes, SLEEP_LIMITS.stage),
    light_minutes: n.lightMinutes == null ? null : bounded(n.lightMinutes, SLEEP_LIMITS.stage),
    rem_minutes: n.remMinutes == null ? null : bounded(n.remMinutes, SLEEP_LIMITS.stage),
    awake_minutes: n.awakeMinutes == null ? null : bounded(n.awakeMinutes, SLEEP_LIMITS.awake),
    source_apps: [n.app.slice(0, 100)],
  };
}

/**
 * Nachten van de wakkerworddatums in `range` uit Health Connect (of later Apple Health) in ÉÉN aanroep
 * naar upsert_daily_sleep. Nachten zonder data worden overgeslagen. Gooit bij een fout.
 */
async function syncSleep(range: DayRange[]): Promise<{ sent: number; nights: Map<string, SleepNight> }> {
  const platform = nativePlatform() === "ios" ? "ios" : "android";
  const nights = await readSleepNights(range, platform);
  const payload = range.map((d) => nights.get(d.date)).flatMap((n) => (n ? [sleepPayload(n)].filter((p): p is DailySleepPayload => !!p) : []));
  const sent = payload.length ? await upsertDailySleep(platform === "ios" ? "healthkit" : "health_connect", payload) : 0;
  return { sent, nights };
}

/**
 * ok: gelukt. no_permission: Spotter mag slaap niet lezen in Health Connect (niets gedaan).
 * needs_reconsent: toestemming in Spotter is van vóór slaap (ConsentSheet met reconsent tonen).
 * unavailable: upgrade-sleep.sql is nog niet gedraaid. error: iets anders mislukte (zie message).
 */
export type HealthSleepSyncStatus = "ok" | "no_permission" | "needs_reconsent" | "unavailable" | "error";

export type HealthSleepSyncResult = {
  status: HealthSleepSyncStatus;
  /** Aantal nachten dat de server heeft opgeslagen. */
  sent: number;
  /** Aantal wakkerworddatums dat bekeken is (0 zonder recht). */
  days: number;
  /** Nederlandse melding bij needs_reconsent, unavailable en error; anders null. */
  message: string | null;
};

// ─────────────── Synchroniseren (stappen, kcal en slaap) ───────────────

export type HealthSyncResult = {
  /** Aantal dagen dat de server heeft opgeslagen. */
  sent: number;
  /** Aantal dagen dat bekeken is. */
  days: number;
  at: string;
  /** Uitkomst van de slaap (los van stappen: mislukt slaap, dan is de sync toch geslaagd). */
  sleep: HealthSleepSyncResult;
};

let running: Promise<HealthSyncResult> | null = null;

/** De sync die nu loopt, of null. */
export function healthSyncInFlight(): Promise<HealthSyncResult> | null {
  return running;
}

/** Zo lang slaan automatische syncs slaap over nadat de server slaap weigerde omdat upgrade-sleep.sql ontbreekt. */
const SLEEP_BLOCKED_MS = 24 * 3_600_000;

export type HealthSyncOptions = {
  /** Aantal dagen (incl. vandaag), standaard HEALTH_SYNC_DAYS. */
  days?: number;
  /**
   * Mag slaap worden opgehaald volgens de toestemming in Spotter: toestemming gegeven voor de tekst die slaap
   * noemt (settings.consented && !settings.needsReconsent). Standaard false: dan wordt slaap niet gelezen en
   * niet verstuurd, ook als Health Connect het recht op slaap wel geeft.
   */
  sleepConsent?: boolean;
  /** Door de gebruiker gestart ("Nu synchroniseren"): ook slaap proberen als de server het eerder weigerde. */
  manual?: boolean;
};

/**
 * Haalt de dagtotalen van de laatste `days` dagen (incl. vandaag) uit Health Connect en slaat ze in
 * één aanroep op met bron "health_connect". Dagen zonder data worden overgeslagen. Opnieuw sturen
 * vervangt de waarden van die dag (nooit optellen). Eén sync tegelijk.
 *
 * Gooit als Health Connect er niet is, er niets te lezen valt (geen recht op stappen en geen bruikbaar
 * recht op slaap), het ophalen mislukt of de server weigert (bijv. geen toestemming in Spotter, of
 * upgrade-activity-native.sql nog niet gedraaid). Zonder recht op stappen wordt alleen slaap opgehaald.
 * Ontbreekt alleen het recht voor actieve kcal, dan gaan alleen stappen mee (active_kcal null). Mislukt
 * het ophalen van kcal terwijl het recht er wel is, dan mislukt de hele sync: de server vervangt alle
 * velden, dus null sturen zou al opgeslagen kcal wissen.
 *
 * Slaap: alleen met sleepConsent (toestemming in Spotter voor de tekst met slaap) én het recht in Health
 * Connect; dan dezelfde wakkerworddatums (30 als slaap nog nooit gelukt is) in één aanroep naar
 * upsert_daily_sleep. Zonder sleepConsent wordt er geen slaap gelezen of verstuurd (status needs_reconsent).
 * Een fout bij slaap gooit NIET: zie result.sleep.
 *
 * Werkt daarna alleen lastSyncAt bij als de koppeling nog bestaat; koppelen gebeurt nooit hier
 * (markHealthConnected). Zo maakt een sync die nog liep een ontkoppeling niet ongedaan.
 */
export function syncHealth(
  userId: string,
  { days = HEALTH_SYNC_DAYS, sleepConsent = false, manual = false }: HealthSyncOptions = {},
): Promise<HealthSyncResult> {
  if (running) return running;
  const job = (async () => {
    const before = getHealthLink(userId);
    const perms = await healthPermissions();
    const readSleep = perms.sleep && sleepConsent;
    if (!perms.steps && !readSleep) {
      throw new Error(
        perms.sleep
          ? "Spotter mag je stappen niet lezen, en voor je slaap is eerst opnieuw toestemming nodig."
          : "Spotter mag je stappen en slaap niet lezen. Geef toestemming in Health Connect.",
      );
    }
    // Na een nieuwe telmethode eenmalig alle 30 dagen opnieuw, zodat oude (dubbel getelde) dagen overschreven worden.
    const want = perms.steps && before.method < SYNC_METHOD ? HEALTH_FIRST_SYNC_DAYS : days;
    const n = Math.max(1, Math.min(HEALTH_FIRST_SYNC_DAYS, Math.round(want)));
    const range = localDays(n);

    // Stappen en kcal: alleen met het recht op stappen.
    let steps = new Map<string, DayBest>();
    let kcal = new Map<string, DayBest>();
    const payload: DailyActivityPayload[] = [];
    if (perms.steps) {
      steps = await dailyBest("steps", range);
      if (perms.calories) {
        try {
          kcal = await dailyBest("calories", range);
        } catch {
          // Eén keer opnieuw (tijdelijke fout); mislukt het weer, dan gooit dit en mislukt de sync.
          await new Promise((r) => setTimeout(r, 1500));
          kcal = await dailyBest("calories", range);
        }
      }
      for (const d of range) {
        const st = steps.get(d.date);
        const kc = kcal.get(d.date);
        const s = bounded(st?.value, ACTIVITY_LIMITS.steps);
        const k = bounded(kc?.value, ACTIVITY_LIMITS.activeKcal);
        if (s == null && k == null) continue;
        const apps = [...new Set([s != null ? st?.app : null, k != null ? kc?.app : null].filter((a): a is string => !!a))];
        payload.push({ date: d.date, steps: s, active_kcal: k, ...(apps.length ? { source_apps: apps.map((a) => a.slice(0, 100)) } : {}) });
      }
    }

    // Eén aanroep naar Supabase (ververst daarna zelf de activiteit in de cache).
    const sent = payload.length ? await upsertDailyActivity("health_connect", payload) : 0;

    // Slaap: los van stappen; een fout hier laat de sync niet mislukken.
    let sleep: HealthSleepSyncResult = { status: "no_permission", sent: 0, days: 0, message: null };
    let sleepPreview: HealthSleepPreview[] = [];
    const blockedAt = before.lastSleepBlockedAt ? Date.parse(before.lastSleepBlockedAt) : NaN;
    const blocked = !manual && Number.isFinite(blockedAt) && Date.now() - blockedAt < SLEEP_BLOCKED_MS;
    if (perms.sleep && !sleepConsent) {
      // Toestemming in Spotter is van vóór slaap: niets lezen en niets versturen.
      sleep = { status: "needs_reconsent", sent: 0, days: 0, message: "Geef opnieuw toestemming om ook je slaap op te slaan." };
    } else if (readSleep && blocked) {
      sleep = { status: "unavailable", sent: 0, days: 0, message: "Slaap bijhouden is nog niet ingeschakeld." };
    } else if (readSleep) {
      // Slaap nog nooit gelukt (recht net gegeven, of nieuw): 30 nachten.
      const sleepRange = before.lastSleepSyncAt ? range : localDays(HEALTH_FIRST_SYNC_DAYS);
      try {
        const r = await syncSleep(sleepRange);
        sleep = { status: "ok", sent: r.sent, days: sleepRange.length, message: null };
        sleepPreview = sleepRange
          .slice(-3)
          .reverse()
          .map((d) => {
            const night = r.nights.get(d.date);
            return {
              date: d.date,
              asleepMinutes: night ? night.asleepMinutes : null,
              bedtime: night?.bedtime ?? null,
              wakeTime: night?.wakeTime ?? null,
              app: night?.app ?? null,
            };
          });
      } catch (err) {
        if (isSleepUnavailable(err)) sleep = { status: "unavailable", sent: 0, days: sleepRange.length, message: sleepErrorMessage(err) };
        else if (isSleepReconsentError(err)) sleep = { status: "needs_reconsent", sent: 0, days: sleepRange.length, message: sleepErrorMessage(err) };
        else sleep = { status: "error", sent: 0, days: sleepRange.length, message: healthErrorMessage(err) };
      }
    }

    const at = new Date().toISOString();
    // Intussen ontkoppeld (of toestemming ingetrokken)? Dan niets terugzetten.
    const cur = getHealthLink(userId);
    const lastSyncPreview: HealthDayPreview[] = perms.steps
      ? range
          .slice(-3)
          .reverse()
          .map((d) => ({
            date: d.date,
            steps: bounded(steps.get(d.date)?.value, ACTIVITY_LIMITS.steps),
            kcal: bounded(kcal.get(d.date)?.value, ACTIVITY_LIMITS.activeKcal),
            app: steps.get(d.date)?.app ?? null,
          }))
      : [];
    // Slaap: gelukt = nieuwe stand; geen recht = vergeten (later weer 30 nachten); anders vorige stand houden.
    // Weigert de server slaap omdat het nog niet is ingeschakeld: automatische syncs slaan het 24 uur over.
    const sleepLink: Pick<HealthLink, "lastSleepSyncAt" | "lastSleepPreview" | "lastSleepBlockedAt"> =
      sleep.status === "ok"
        ? { lastSleepSyncAt: at, lastSleepPreview: sleepPreview, lastSleepBlockedAt: null }
        : sleep.status === "no_permission"
          ? { lastSleepSyncAt: null, lastSleepPreview: [], lastSleepBlockedAt: null }
          : {
              lastSleepSyncAt: cur.lastSleepSyncAt,
              lastSleepPreview: cur.lastSleepPreview,
              lastSleepBlockedAt: sleep.status === "unavailable" && !blocked ? at : cur.lastSleepBlockedAt,
            };
    if (cur.connected) {
      writeLink(userId, {
        ...cur,
        lastSyncAt: at,
        lastSyncDays: payload.length,
        lastSyncPreview,
        method: perms.steps ? SYNC_METHOD : cur.method,
        ...sleepLink,
      });
    }
    return { sent, days: n, at, sleep };
  })();
  running = job;
  job
    .finally(() => {
      if (running === job) running = null;
    })
    .catch(() => {});
  return job;
}
