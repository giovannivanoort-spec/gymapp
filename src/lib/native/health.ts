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
 * - healthPermissions() → { steps, calories } (zonder te vragen)
 * - requestHealthPermissions() → { steps, calories } (toont het rechtenscherm van Health Connect)
 * - openHealthConnectSettings()
 * - syncHealth(userId, { days }) → { sent, days, at } — dagtotalen van de laatste `days` lokale dagen
 *   (incl. vandaag) in ÉÉN aanroep naar upsert_daily_activity met bron "health_connect".
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
 * - requestAuthorization / checkAuthorization({ read: ["steps", "calories"] }) → readAuthorized[]
 *   ("calories" = ActiveCaloriesBurnedRecord = READ_ACTIVE_CALORIES_BURNED)
 * - queryAggregated({ dataType, startDate, endDate, bucket: "day", aggregation: "sum" }):
 *   Health Connect aggregateGroupByDuration (ontdubbeld volgens de app-prioriteit van de gebruiker).
 *   Datums als ISO met "Z" (Instant.parse). Emmers van precies 24 uur vanaf startDate; emmers zonder
 *   data worden weggelaten. Eenheden: "count" (stappen) en "kilocalorie".
 */

import { useMemo, useSyncExternalStore } from "react";
import { ACTIVITY_LIMITS, activityErrorMessage, upsertDailyActivity, type DailyActivityPayload } from "@/lib/activity";
import { toISODate } from "@/lib/dates";

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

/** Alleen lezen, alleen deze twee. Nooit schrijven. Gelijk aan de rechten in AndroidManifest.xml. */
const READ_TYPES = ["steps", "calories"] as const;

export type HealthPermissions = { steps: boolean; calories: boolean };

function toPermissions(readAuthorized: readonly string[] | undefined): HealthPermissions {
  const set = new Set(readAuthorized ?? []);
  return { steps: set.has("steps"), calories: set.has("calories") };
}

/** Huidige rechten, zonder iets te vragen. */
export async function healthPermissions(): Promise<HealthPermissions> {
  const { Health } = await withTimeout(healthPlugin(), 15_000, "laden");
  const r = await withTimeout(Health.checkAuthorization({ read: [...READ_TYPES], write: [] }), 10_000, "rechten");
  return toPermissions(r.readAuthorized);
}

/** Toont het rechtenscherm van Health Connect (stappen en actieve kcal, alleen lezen). */
export async function requestHealthPermissions(): Promise<HealthPermissions> {
  const { Health } = await withTimeout(healthPlugin(), 15_000, "laden");
  // Geen time-out: hier wacht de app op de keuze van de gebruiker in het rechtenscherm.
  const r = await Health.requestAuthorization({ read: [...READ_TYPES], write: [] });
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
};

/** 2: per dag de app met de meeste stappen (geen som over apps). Ophogen = iedereen haalt 30 dagen opnieuw op. */
const SYNC_METHOD = 2;

export type HealthDayPreview = { date: string; steps: number | null; kcal: number | null; /** Pakketnaam van de app waar de stappen vandaan komen. */ app?: string | null };

const EMPTY_LINK: HealthLink = { connected: false, connectedAt: null, lastSyncAt: null, lastSyncDays: 0, lastSyncPreview: [], method: 0 };

function parsePreview(v: unknown): HealthDayPreview[] {
  if (!Array.isArray(v)) return [];
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return v
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object" && typeof (d as { date?: unknown }).date === "string")
    .slice(0, 3)
    .map((d) => ({ date: d.date as string, steps: num(d.steps), kcal: num(d.kcal), app: typeof d.app === "string" ? d.app : null }));
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

export type HealthSyncResult = {
  /** Aantal dagen dat de server heeft opgeslagen. */
  sent: number;
  /** Aantal dagen dat bekeken is. */
  days: number;
  at: string;
};

let running: Promise<HealthSyncResult> | null = null;

/** De sync die nu loopt, of null. */
export function healthSyncInFlight(): Promise<HealthSyncResult> | null {
  return running;
}

/**
 * Haalt de dagtotalen van de laatste `days` dagen (incl. vandaag) uit Health Connect en slaat ze in
 * één aanroep op met bron "health_connect". Dagen zonder data worden overgeslagen. Opnieuw sturen
 * vervangt de waarden van die dag (nooit optellen). Eén sync tegelijk.
 *
 * Gooit als Health Connect er niet is, de rechten voor stappen ontbreken, het ophalen mislukt of de
 * server weigert (bijv. geen toestemming in Spotter, of upgrade-activity-native.sql nog niet gedraaid).
 * Ontbreekt alleen het recht voor actieve kcal, dan gaan alleen stappen mee (active_kcal null). Mislukt
 * het ophalen van kcal terwijl het recht er wel is, dan mislukt de hele sync: de server vervangt alle
 * velden, dus null sturen zou al opgeslagen kcal wissen.
 *
 * Werkt daarna alleen lastSyncAt bij als de koppeling nog bestaat; koppelen gebeurt nooit hier
 * (markHealthConnected). Zo maakt een sync die nog liep een ontkoppeling niet ongedaan.
 */
export function syncHealth(userId: string, { days = HEALTH_SYNC_DAYS }: { days?: number } = {}): Promise<HealthSyncResult> {
  if (running) return running;
  const job = (async () => {
    // Na een nieuwe telmethode eenmalig alle 30 dagen opnieuw, zodat oude (dubbel getelde) dagen overschreven worden.
    const want = getHealthLink(userId).method < SYNC_METHOD ? HEALTH_FIRST_SYNC_DAYS : days;
    const n = Math.max(1, Math.min(HEALTH_FIRST_SYNC_DAYS, Math.round(want)));
    const range = localDays(n);
    const perms = await healthPermissions();
    if (!perms.steps) throw new Error("Spotter mag je stappen niet lezen. Geef toestemming in Health Connect.");

    const steps = await dailyBest("steps", range);
    let kcal = new Map<string, DayBest>();
    if (perms.calories) {
      try {
        kcal = await dailyBest("calories", range);
      } catch {
        // Eén keer opnieuw (tijdelijke fout); mislukt het weer, dan gooit dit en mislukt de sync.
        await new Promise((r) => setTimeout(r, 1500));
        kcal = await dailyBest("calories", range);
      }
    }

    const payload: DailyActivityPayload[] = [];
    for (const d of range) {
      const st = steps.get(d.date);
      const kc = kcal.get(d.date);
      const s = bounded(st?.value, ACTIVITY_LIMITS.steps);
      const k = bounded(kc?.value, ACTIVITY_LIMITS.activeKcal);
      if (s == null && k == null) continue;
      const apps = [...new Set([s != null ? st?.app : null, k != null ? kc?.app : null].filter((a): a is string => !!a))];
      payload.push({ date: d.date, steps: s, active_kcal: k, ...(apps.length ? { source_apps: apps.map((a) => a.slice(0, 100)) } : {}) });
    }

    // Eén aanroep naar Supabase (ververst daarna zelf de activiteit in de cache).
    const sent = payload.length ? await upsertDailyActivity("health_connect", payload) : 0;
    const at = new Date().toISOString();
    // Intussen ontkoppeld (of toestemming ingetrokken)? Dan niets terugzetten.
    const cur = getHealthLink(userId);
    const lastSyncPreview: HealthDayPreview[] = range
      .slice(-3)
      .reverse()
      .map((d) => ({
        date: d.date,
        steps: bounded(steps.get(d.date)?.value, ACTIVITY_LIMITS.steps),
        kcal: bounded(kcal.get(d.date)?.value, ACTIVITY_LIMITS.activeKcal),
        app: steps.get(d.date)?.app ?? null,
      }));
    if (cur.connected) writeLink(userId, { ...cur, lastSyncAt: at, lastSyncDays: payload.length, lastSyncPreview, method: SYNC_METHOD });
    return { sent, days: n, at };
  })();
  running = job;
  job
    .finally(() => {
      if (running === job) running = null;
    })
    .catch(() => {});
  return job;
}
