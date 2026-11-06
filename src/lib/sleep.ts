"use client";

/**
 * Slaap: per nacht hoe lang je sliep (handmatig, Health Connect via de Android-app, later Apple Health
 * via de iOS-app). Database: supabase/upgrade-sleep.sql. Native sync: lib/native/health.ts (syncHealth).
 *
 * Eén nacht hoort bij de LOKALE datum waarop je wakker werd: de nacht van zondag op maandag is "maandag".
 * Per dag telt één bron (telefoon/horloge gaat voor handmatig) en binnen Health Connect één app: nooit
 * optellen. Dutjes overdag tellen niet mee (alleen de hoofdslaap van die dag).
 *
 * Privacy: slaap valt onder de toestemming voor activiteit (lib/activity.ts), versie
 * ACTIVITY_CONSENT_VERSION v2 of later. Met toestemming voor v1 (needsReconsent) weigert de server slaap
 * met "Geef opnieuw toestemming…" (isSleepReconsentError). Slaap wordt NIET gedeeld met vrienden of groepen;
 * er is geen functie om andermans slaap te lezen. De AI-coach (tool get_sleep) leest hem alleen met een aparte
 * keuze (activity_settings.coach_sleep, upgrade-sleep-settings.sql, components/sleep/settings.ts). Intrekken van de toestemming wist alle
 * slaap op de server (save_activity_settings) en op dit toestel (forgetActivityData roept ook de
 * slaapcache weg); deleteAllActivity wist ook slaap.
 *
 * Werkt ook als upgrade-sleep.sql nog niet is gedraaid: lezen geeft dan [] en fetchSleepAvailable() false
 * (toon "nog niet ingeschakeld"), schrijven gooit een SleepUnavailableError.
 *
 * ── Publieke API ────────────────────────────────────────────────────────────────────────────────
 *
 * Typen en constanten
 * - SleepSource ("manual" | "health_connect" | "healthkit"), SLEEP_SOURCES
 * - DailySleep: één effectieve nacht (view daily_sleep_effective), minuten als getallen, tijden als ISO.
 * - DailySleepPayload: contract voor schrijven (web en native apps).
 * - ManualSleepEntry: { date, asleep_minutes, in_bed_minutes?, bedtime?, wake_time? }.
 * - SLEEP_LIMITS (gelijk aan de server), MANUAL_SLEEP_DAYS_BACK (7), DEVICE_SLEEP_DAYS_BACK (30),
 *   DEFAULT_SLEEP_GOAL_MINUTES (480, alleen voor weergave; het instelbare slaapdoel staat in
 *   components/sleep/settings.ts, useSleepGoal).
 *
 * Cache-sleutels (lib/cache) — alles begint met "sleep:"
 * - sleepRangeKey(userId, from, to) = "sleep:days:<userId>:<from>:<to>", sleepAvailableKey
 * - invalidateSleep(userId?) — na elke wijziging; zonder userId alles.
 * - forgetSleepData(userId) — slaap van dit toestel wissen (ook gedaan door forgetActivityData).
 *
 * Lezen
 * - fetchMySleep(userId, from, to) → DailySleep[] (oplopend op datum; [] zonder schema).
 * - fetchSleepAvailable() → boolean (false = upgrade-sleep.sql nog niet gedraaid).
 *
 * Hooks (useCachedState: { data, error, refreshing, stale, offline, retry, updatedAt }; bewaard op het toestel)
 * - useMySleep(userId, from, to)
 * - useRecentSleep(userId, days = 7) → + { from, to } — de laatste `days` wakkerworddatums t/m vandaag
 * - useSleepNight(userId, date) → + { night: DailySleep | null }
 * - useLatestSleep(userId) → + { night } — de nacht van vandaag, anders gisteren (voor een kaart/widget)
 * - useSleepAvailable()
 *
 * Schrijven (gooit bij een fout; toon sleepErrorMessage(err))
 * - upsertDailySleep(source, nights) → aantal opgeslagen nachten (ENIGE schrijfroute; ook voor de apps)
 * - saveManualSleep(userId, entry) / clearManualSleep(userId, date)
 * - deleteAllSleep(userId) → al je slaap wissen (toestemming en activiteit blijven staan)
 * - validateManualSleep(entry, now?) → Nederlandse foutmelding of null (zelfde grenzen als de server)
 * - manualSleepDates(now?) → de 7 kiesbare datums (vandaag eerst)
 * - manualSleepFromTimes(date, "23:15", "07:05", asleepMinutes?) → ManualSleepEntry (bedtijd op de avond
 *   ervoor als die later is dan de wektijd; slaap = tijd in bed als asleepMinutes ontbreekt)
 *
 * Weergave en rekenwerk (puur)
 * - formatSleepDuration(min) → "7 u 24 min", "8 u", "45 min", "–" voor null
 * - formatSleepHours(min) → "7,4 u" (compact, bijv. voor een widget)
 * - formatClockTime(iso) → "23:15" (lokale tijd)
 * - sleepSourceLine(night) → "Health Connect · Samsung Health" / "Handmatig ingevoerd"
 * - sleepStages(night) → [{ key, label, minutes }] (diep, licht, rem, wakker) of null zonder fases
 * - sleepAverage(nights) → { avgMinutes, nights } over nachten met data
 * - weeklySleepAverage(nights, weekOffset?) → { from, to, avgMinutes, nights } (maandag t/m zondag)
 * - latestNight(nights, today?) → nacht van vandaag, anders gisteren, anders null
 * - isSleepUnavailable(err), isSleepReconsentError(err), sleepErrorMessage(err)
 */

import { appLabel } from "./activity";
import { invalidate, purgeServiceWorkerHealthData, removeCached, useCachedState, type CachedState } from "./cache";
import { toISODate } from "./dates";
import { errorMessage, isMissingSchemaError, supabase } from "./supabase";
import { addDays, parseISODate, weekRange } from "./week";

// ─────────────── Typen en constanten ───────────────

export type SleepSource = "manual" | "health_connect" | "healthkit";
export const SLEEP_SOURCES: readonly SleepSource[] = ["manual", "health_connect", "healthkit"];

/** Eén effectieve nacht (view daily_sleep_effective): bronnen worden nooit opgeteld. */
export type DailySleep = {
  user_id: string;
  /** Lokale datum van wakker worden, YYYY-MM-DD. */
  date: string;
  source: SleepSource;
  /** Echt geslapen (zonder wakker liggen). Altijd gevuld. */
  asleep_minutes: number;
  /** Van begin tot einde van de nacht, zonder lange onderbrekingen; null als onbekend. */
  in_bed_minutes: number | null;
  /** Begin van de nacht (ISO, UTC); null als onbekend. */
  bedtime: string | null;
  /** Einde van de nacht (ISO, UTC); null als onbekend. */
  wake_time: string | null;
  /** Slaapfases; null = niet gemeten (bijv. handmatig of een app zonder fases). */
  deep_minutes: number | null;
  light_minutes: number | null;
  rem_minutes: number | null;
  awake_minutes: number | null;
  /** Pakketnaam van de app die de nacht leverde, bv. com.sec.android.app.shealth. */
  source_apps: string[];
  synced_at: string;
};

/** Wat een client per nacht stuurt. asleep_minutes null = (handmatig) die nacht wissen; anders overgeslagen. */
export type DailySleepPayload = {
  /** Lokale datum van wakker worden. */
  date: string;
  asleep_minutes: number | null;
  in_bed_minutes?: number | null;
  bedtime?: string | null;
  wake_time?: string | null;
  deep_minutes?: number | null;
  light_minutes?: number | null;
  rem_minutes?: number | null;
  awake_minutes?: number | null;
  source_apps?: string[];
};

/** Gelijk aan de checks in upgrade-sleep.sql (minuten). */
export const SLEEP_LIMITS = {
  asleep: { min: 0, max: 1080 },
  inBed: { min: 0, max: 1440 },
  stage: { min: 0, max: 1080 },
  awake: { min: 0, max: 720 },
} as const;
/** Handmatig invullen kan tot zoveel nachten terug (server: vandaag − 7 t/m vandaag + 1). */
export const MANUAL_SLEEP_DAYS_BACK = 7;
/** Telefoon/horloge: hooguit zoveel dagen terug (server). */
export const DEVICE_SLEEP_DAYS_BACK = 30;
/** Standaard slaapdoel (8 uur), alleen voor weergave. Instelbaar: useSleepGoal in components/sleep/settings.ts. */
export const DEFAULT_SLEEP_GOAL_MINUTES = 480;

// ─────────────── Fouten ───────────────

/** Schrijven terwijl upgrade-sleep.sql nog niet is gedraaid. */
export class SleepUnavailableError extends Error {
  constructor() {
    super("Slaap bijhouden is nog niet ingeschakeld.");
    this.name = "SleepUnavailableError";
  }
}

/** Ontbreekt het slaapschema (script nog niet gedraaid)? */
export function isSleepUnavailable(err: unknown): boolean {
  return err instanceof SleepUnavailableError || isMissingSchemaError(err);
}

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") return (err as { message: string }).message;
  return "";
}

/** Toestemming gegeven voor een oude tekstversie (zonder slaap): toon ConsentSheet met reconsent. */
export function isSleepReconsentError(err: unknown): boolean {
  return /opnieuw toestemming/i.test(rawMessage(err));
}

/** Korte Nederlandse melding voor in een toast. Meldingen van de server zijn al Nederlands. */
export function sleepErrorMessage(err: unknown): string {
  if (isSleepUnavailable(err)) return "Slaap bijhouden is nog niet ingeschakeld.";
  return errorMessage(err);
}

function rethrow(err: unknown): never {
  if (isMissingSchemaError(err)) throw new SleepUnavailableError();
  throw err;
}

// ─────────────── Cache-sleutels ───────────────

/** Let op: forgetActivityData in lib/activity.ts gebruikt dit voorvoegsel ook ("sleep:days:<userId>:"). */
export const sleepRangeKey = (userId: string, from: string, to: string) => `sleep:days:${userId}:${from}:${to}`;
export const sleepAvailableKey = "sleep:available";

/** Slaap van deze gebruiker vergeten: uit het geheugen EN van het toestel. */
export function forgetSleepData(userId: string) {
  removeCached(`sleep:days:${userId}:`);
  // Ook een kopie in Cache Storage (oudere service worker) mag niet achterblijven.
  purgeServiceWorkerHealthData();
}

/** Na een wijziging: slaap (van iedereen, of van deze gebruiker) opnieuw ophalen. */
export function invalidateSleep(userId?: string) {
  invalidate(userId ? `sleep:days:${userId}:` : "sleep:");
}

// ─────────────── Lezen ───────────────

const NIGHT_COLUMNS =
  "user_id, date, source, asleep_minutes, in_bed_minutes, bedtime, wake_time, deep_minutes, light_minutes, rem_minutes, awake_minutes, source_apps, synced_at";

const numOrNull = (v: unknown) => (v == null ? null : Number(v));

function normalizeNight(r: DailySleep): DailySleep {
  return {
    ...r,
    asleep_minutes: Number(r.asleep_minutes) || 0,
    in_bed_minutes: numOrNull(r.in_bed_minutes),
    deep_minutes: numOrNull(r.deep_minutes),
    light_minutes: numOrNull(r.light_minutes),
    rem_minutes: numOrNull(r.rem_minutes),
    awake_minutes: numOrNull(r.awake_minutes),
    bedtime: r.bedtime ?? null,
    wake_time: r.wake_time ?? null,
    source_apps: Array.isArray(r.source_apps) ? r.source_apps : [],
  };
}

/** Je eigen nachten met wakkerworddatum in [from, to] (YYYY-MM-DD, inclusief), oplopend. [] zonder schema. */
export async function fetchMySleep(userId: string, from: string, to: string): Promise<DailySleep[]> {
  const { data, error } = await supabase
    .from("daily_sleep_effective")
    .select(NIGHT_COLUMNS)
    .eq("user_id", userId)
    .gte("date", from)
    .lte("date", to)
    .order("date");
  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
  return ((data ?? []) as DailySleep[]).map(normalizeNight);
}

/** Is upgrade-sleep.sql gedraaid? (RLS: de proef leest hooguit één eigen rij.) */
export async function fetchSleepAvailable(): Promise<boolean> {
  const { error } = await supabase.from("daily_sleep_effective").select("date").limit(1);
  if (error) {
    if (isMissingSchemaError(error)) return false;
    throw error;
  }
  return true;
}

// ─────────────── Schrijven ───────────────

function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

const roundOrNull = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v));

/**
 * Nachten opslaan voor een bron. De ENIGE schrijfroute (ook voor de native sync). Elke nacht vervangt
 * de bestaande waarden voor die bron en datum (nooit optellen). Geeft het aantal opgeslagen nachten
 * terug en ververst daarna de slaap in de cache. Hooguit 62 nachten per aanroep.
 */
export async function upsertDailySleep(source: SleepSource, nights: DailySleepPayload[]): Promise<number> {
  if (!nights.length) return 0;
  const { data, error } = await supabase.rpc("upsert_daily_sleep", {
    p_source: source,
    p_days: nights.map((d) => ({
      date: d.date,
      asleep_minutes: roundOrNull(d.asleep_minutes),
      in_bed_minutes: roundOrNull(d.in_bed_minutes),
      bedtime: d.bedtime ?? null,
      wake_time: d.wake_time ?? null,
      deep_minutes: roundOrNull(d.deep_minutes),
      light_minutes: roundOrNull(d.light_minutes),
      rem_minutes: roundOrNull(d.rem_minutes),
      awake_minutes: roundOrNull(d.awake_minutes),
      ...(d.source_apps ? { source_apps: d.source_apps.slice(0, 10).map((a) => a.slice(0, 100)) } : {}),
    })),
    p_tz: deviceTimeZone(),
  });
  if (error) rethrow(error);
  invalidate("sleep:days:");
  return Number(data) || 0;
}

/** Al je slaap verwijderen (alle bronnen en nachten). Toestemming en activiteit blijven staan. */
export async function deleteAllSleep(userId: string): Promise<void> {
  const { error } = await supabase.from("daily_sleep").delete().eq("user_id", userId);
  if (error) rethrow(error);
  forgetSleepData(userId);
}

export type ManualSleepEntry = {
  /** Lokale datum van wakker worden. */
  date: string;
  asleep_minutes: number | null;
  in_bed_minutes?: number | null;
  /** ISO-tijdstippen (bijv. uit manualSleepFromTimes). */
  bedtime?: string | null;
  wake_time?: string | null;
};

/** De 7 wakkerworddatums die je handmatig mag invullen: vandaag, gisteren, … (nieuwste eerst). */
export function manualSleepDates(now: Date = new Date()): string[] {
  return Array.from({ length: MANUAL_SLEEP_DAYS_BACK }, (_, i) => toISODate(addDays(now, -i)));
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * Handmatige nacht uit klokkentijden. `date` is de dag van wakker worden; ligt de bedtijd later op de
 * klok dan de wektijd (23:15 → 07:05), dan was dat de avond ervoor. Zonder `asleepMinutes` geldt de
 * hele tijd in bed als slaap. Ongeldige tijden → null.
 */
export function manualSleepFromTimes(date: string, bed: string, wake: string, asleepMinutes?: number | null): ManualSleepEntry | null {
  const b = HHMM.exec(bed.trim());
  const w = HHMM.exec(wake.trim());
  if (!b || !w || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const day = parseISODate(date);
  const wakeAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(w[1]), Number(w[2]));
  let bedAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(b[1]), Number(b[2]));
  if (bedAt.getTime() >= wakeAt.getTime()) bedAt = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1, Number(b[1]), Number(b[2]));
  const inBed = Math.round((wakeAt.getTime() - bedAt.getTime()) / 60_000);
  return {
    date,
    asleep_minutes: asleepMinutes == null ? inBed : Math.round(asleepMinutes),
    in_bed_minutes: inBed,
    bedtime: bedAt.toISOString(),
    wake_time: wakeAt.toISOString(),
  };
}

/** Zelfde controles als de server. Nederlandse foutmelding, of null als het klopt. */
export function validateManualSleep(e: ManualSleepEntry, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return "Kies een datum.";
  const min = toISODate(addDays(now, -MANUAL_SLEEP_DAYS_BACK));
  const max = toISODate(addDays(now, 1));
  if (e.date < min || e.date > max) return "Je kunt alleen de afgelopen 7 nachten handmatig invullen.";
  if (e.asleep_minutes == null) return "Vul in hoe lang je hebt geslapen.";
  if (!Number.isFinite(e.asleep_minutes) || e.asleep_minutes < SLEEP_LIMITS.asleep.min || e.asleep_minutes > SLEEP_LIMITS.asleep.max) {
    return "Slaap moet tussen 0 en 18 uur liggen.";
  }
  if (e.in_bed_minutes != null) {
    if (!Number.isFinite(e.in_bed_minutes) || e.in_bed_minutes < SLEEP_LIMITS.inBed.min || e.in_bed_minutes > SLEEP_LIMITS.inBed.max) {
      return "Tijd in bed moet tussen 0 en 24 uur liggen.";
    }
    if (Math.round(e.in_bed_minutes) < Math.round(e.asleep_minutes)) return "Tijd in bed kan niet korter zijn dan je slaap.";
  }
  if (e.bedtime && e.wake_time) {
    const span = Date.parse(e.wake_time) - Date.parse(e.bedtime);
    if (!Number.isFinite(span) || span <= 0 || span > 86_400_000) return "Je wektijd moet na je bedtijd liggen, hooguit 24 uur later.";
  }
  return null;
}

/** Handmatige nacht opslaan (vervangt een eerdere handmatige invoer voor die datum). */
export async function saveManualSleep(userId: string, e: ManualSleepEntry): Promise<void> {
  const msg = validateManualSleep(e);
  if (msg) throw new Error(msg);
  await upsertDailySleep("manual", [
    {
      date: e.date,
      asleep_minutes: e.asleep_minutes,
      in_bed_minutes: e.in_bed_minutes ?? null,
      bedtime: e.bedtime ?? null,
      wake_time: e.wake_time ?? null,
    },
  ]);
  invalidateSleep(userId);
}

/** Handmatige nacht van een datum wissen (nachten van een toestel blijven staan). */
export async function clearManualSleep(userId: string, date: string): Promise<void> {
  await upsertDailySleep("manual", [{ date, asleep_minutes: null }]);
  invalidateSleep(userId);
}

// ─────────────── Weergave en rekenwerk ───────────────

/** "7 u 24 min", "8 u", "45 min"; "–" zonder waarde. */
export function formatSleepDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "–";
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest} min`;
  return rest ? `${h} u ${rest} min` : `${h} u`;
}

/** Compact: "7,4 u" (één decimaal); "–" zonder waarde. */
export function formatSleepHours(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "–";
  return `${(Math.max(0, minutes) / 60).toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} u`;
}

/** Lokale kloktijd "23:15"; "–" zonder (geldige) tijd. */
export function formatClockTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

const SLEEP_SOURCE_LABELS: Record<SleepSource, string> = {
  manual: "Handmatig",
  health_connect: "Health Connect",
  healthkit: "Apple Health",
};

/** Bijv. "Health Connect · Samsung Health" of "Handmatig ingevoerd". */
export function sleepSourceLine(night: Pick<DailySleep, "source" | "source_apps">): string {
  if (night.source === "manual") return "Handmatig ingevoerd";
  const label = SLEEP_SOURCE_LABELS[night.source] ?? "Onbekende bron";
  const apps = [...new Set((night.source_apps ?? []).map(appLabel))].filter((a) => a !== label);
  return [label, ...apps].join(" · ");
}

export type SleepStageKey = "deep" | "light" | "rem" | "awake";
export type SleepStageInfo = { key: SleepStageKey; label: string; minutes: number };

/** Fases om te tonen (diep, licht, rem, wakker), of null als de nacht geen fases heeft. */
export function sleepStages(
  night: Pick<DailySleep, "deep_minutes" | "light_minutes" | "rem_minutes" | "awake_minutes"> | null | undefined,
): SleepStageInfo[] | null {
  if (!night || (night.deep_minutes == null && night.light_minutes == null && night.rem_minutes == null)) return null;
  const out: SleepStageInfo[] = [
    { key: "deep", label: "Diep", minutes: night.deep_minutes ?? 0 },
    { key: "light", label: "Licht", minutes: night.light_minutes ?? 0 },
    { key: "rem", label: "REM", minutes: night.rem_minutes ?? 0 },
  ];
  if (night.awake_minutes != null) out.push({ key: "awake", label: "Wakker", minutes: night.awake_minutes });
  return out;
}

/** Gemiddelde over nachten met data (afgerond op hele minuten); avgMinutes null zonder nachten. */
export function sleepAverage(nights: Pick<DailySleep, "asleep_minutes">[]): { avgMinutes: number | null; nights: number } {
  const vals = nights.map((n) => n.asleep_minutes).filter((v) => Number.isFinite(v) && v > 0);
  if (!vals.length) return { avgMinutes: null, nights: 0 };
  return { avgMinutes: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), nights: vals.length };
}

/** Gemiddelde van een week (maandag t/m zondag, op wakkerworddatum). weekOffset 0 = deze week. */
export function weeklySleepAverage(
  nights: Pick<DailySleep, "date" | "asleep_minutes">[],
  weekOffset = 0,
  now: Date = new Date(),
): { from: string; to: string; avgMinutes: number | null; nights: number } {
  const { from, to } = weekRange(weekOffset, now);
  return { from, to, ...sleepAverage(nights.filter((n) => n.date >= from && n.date <= to)) };
}

/** De nacht van vandaag (wakker geworden vandaag), anders die van gisteren, anders null. */
export function latestNight<T extends Pick<DailySleep, "date">>(nights: T[] | undefined, today: string = toISODate()): T | null {
  if (!nights?.length) return null;
  const yesterday = toISODate(addDays(parseISODate(today), -1));
  return nights.find((n) => n.date === today) ?? nights.find((n) => n.date === yesterday) ?? null;
}

// ─────────────── Hooks ───────────────

/** Je nachten met wakkerworddatum in [from, to]. */
export function useMySleep(userId: string | null, from: string, to: string): CachedState<DailySleep[]> {
  return useCachedState(userId ? sleepRangeKey(userId, from, to) : null, () => fetchMySleep(userId!, from, to), {
    persist: true,
    maxAge: 60_000,
  });
}

/** De laatste `days` wakkerworddatums t/m vandaag (bijv. 7 balkjes op een kaart). */
export function useRecentSleep(userId: string | null, days = 7): CachedState<DailySleep[]> & { from: string; to: string } {
  const to = toISODate();
  const from = toISODate(addDays(parseISODate(to), -(days - 1)));
  return { ...useMySleep(userId, from, to), from, to };
}

/** Eén nacht (wakkerworddatum). */
export function useSleepNight(userId: string | null, date: string): CachedState<DailySleep[]> & { night: DailySleep | null } {
  const state = useMySleep(userId, date, date);
  return { ...state, night: state.data?.find((d) => d.date === date) ?? null };
}

/**
 * De meest recente nacht: vandaag, anders gisteren (voor een kaart of widget). Deelt de cache met
 * useRecentSleep(userId, 7).
 */
export function useLatestSleep(userId: string | null): CachedState<DailySleep[]> & { from: string; to: string; night: DailySleep | null } {
  const state = useRecentSleep(userId, 7);
  return { ...state, night: latestNight(state.data, state.to) };
}

/** false = upgrade-sleep.sql nog niet gedraaid ("nog niet ingeschakeld"). */
export function useSleepAvailable(): CachedState<boolean> {
  return useCachedState(sleepAvailableKey, fetchSleepAvailable, { persist: true, maxAge: 10 * 60_000 });
}
