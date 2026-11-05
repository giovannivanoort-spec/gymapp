"use client";

/**
 * Activiteit: dagelijkse stappen en actieve kcal (handmatig; later ook Health Connect / Apple Health
 * via de Android- en iOS-app). Database: supabase/upgrade-activity.sql.
 *
 * Werkt ook als dat script nog niet is gedraaid: lezen geeft dan `available: false` / lege lijsten
 * (toon een rustige "nog niet ingeschakeld"-melding), schrijven gooit een ActivityUnavailableError.
 *
 * ── Publieke API ────────────────────────────────────────────────────────────────────────────────
 *
 * Typen en constanten
 * - ActivitySource, ACTIVITY_SOURCES, DailyActivity (één effectieve rij per dag), DailyActivityPayload
 *   (contract voor schrijven, ook voor de native apps), ActivitySettings, ActivitySettingsState
 *   (= settings + `available` + `consented` + `needsReconsent`), ActivitySettingsPatch, StepsLeaderboard(Entry), LeaderboardScope.
 * - ACTIVITY_CONSENT_VERSION (gelijk aan de server), DEFAULT_STEP_GOAL (7000), LEADERBOARD_DAY_GOAL (7000),
 *   ACTIVITY_LIMITS (stappen/kcal/stappendoel), MANUAL_DAYS_BACK (7), BURN_CREDIT_OPTIONS ([0,25,50,75,100]).
 *
 * Cache-sleutels (lib/cache) — alles begint met "activity:"
 * - activitySettingsKey(userId), activityRangeKey(userId, from, to), leaderboardKey(scope, userId, weekFrom)
 * - invalidateActivity(userId?) — na elke wijziging; zonder userId alles.
 * - forgetActivityData(userId) — dagen en ranglijsten ook van het toestel wissen (na intrekken of verwijderen).
 *
 * Lezen
 * - fetchActivitySettings(userId) → ActivitySettingsState (standaardwaarden als er nog geen rij is).
 * - fetchMyActivity(userId, from, to) → DailyActivity[] (effectief per dag, oplopend op datum; [] zonder schema).
 * - fetchWeekSteps(userIds, from, to) → DailyActivity[] (alleen stappen; van anderen alleen als jij én zij delen).
 * - fetchStepsLeaderboard(scope, userId, weekOffset?) → StepsLeaderboard (ids, data, profielen, rangorde).
 *
 * Hooks (useCachedState: { data, error, refreshing, stale, offline, retry, updatedAt })
 * - useActivitySettings(userId)
 * - useMyActivity(userId, from, to)
 * - useRecentActivity(userId, days = 7) → de laatste `days` dagen t/m vandaag
 * - useActivityDay(userId, date) → { ...state, day: DailyActivity | null }
 * - useStepsLeaderboard(scope, userId, weekOffset = 0)
 *
 * Schrijven (gooit bij een fout; toon activityErrorMessage(err))
 * - saveActivitySettings(userId, patch) → ActivitySettingsState  (store/share/coach/stepGoal/burnCreditPct)
 * - upsertDailyActivity(source, days) → aantal opgeslagen dagen (ENIGE schrijfroute; "manual" en, na
 *   supabase/upgrade-activity-native.sql, ook "health_connect" en "healthkit" uit de apps; zie lib/native/health.ts)
 * - saveManualActivity(userId, { date, steps, active_kcal }) / clearManualActivity(userId, date)
 * - deleteAllActivity(userId) → al je dagen wissen (toestemming blijft staan)
 * - validateManualEntry(entry) → Nederlandse foutmelding of null (zelfde grenzen als de server)
 * - manualEntryDates(now?) → de 7 kiesbare datums (vandaag eerst)
 *
 * Weergave en rekenwerk (puur)
 * - SOURCE_LABELS, sourceLabel(source), appLabel(pkg), sourceLine(day) ("Health Connect · Garmin Connect")
 * - effectiveSteps(day) (0 stappen van Apple Health = geen data), isDeviceSource(source)
 * - activityCredit(targets, activeKcal, pct), applyCredit(targets, credit), expectedActiveKcal(targets)
 * - buildLeaderboard(rows, profiles, meId, days) (los te testen)
 * - isActivityUnavailable(err), activityErrorMessage(err)
 */

import { invalidate, removeCached, setCached, useCachedState, type CachedState } from "./cache";
import { toISODate } from "./dates";
import { errorMessage, isMissingSchemaError, supabase } from "./supabase";
import { PUBLIC_PROFILE_COLUMNS, PUBLIC_PROFILE_COLUMNS_NO_PHOTO, type PublicProfile } from "./types";
import { addDays, parseISODate, weekRange } from "./week";

// ─────────────── Typen en constanten ───────────────

export type ActivitySource = "manual" | "health_connect" | "healthkit" | "garmin" | "shortcut";
export const ACTIVITY_SOURCES: readonly ActivitySource[] = ["manual", "health_connect", "healthkit", "garmin", "shortcut"];

/** Eén effectieve dag (view daily_activity_effective): bronnen worden nooit opgeteld. */
export type DailyActivity = {
  user_id: string;
  /** Lokale kalenderdag, YYYY-MM-DD. */
  date: string;
  source: ActivitySource;
  steps: number | null;
  /** Kcal door beweging (zonder ruststofwisseling); een schatting. */
  active_kcal: number | null;
  /** Kcal inclusief ruststofwisseling; optioneel. Niet gebruiken voor doelen of ranglijsten. */
  total_kcal: number | null;
  /** Pakketnamen van de apps die de data leverden, bv. com.garmin.android.apps.connectmobile. */
  source_apps: string[];
  synced_at: string;
};

/** Wat een client per dag stuurt (web en native apps). Stuur alleen dagen met data, geen nullen voor lege dagen. */
export type DailyActivityPayload = {
  date: string;
  steps?: number | null;
  active_kcal?: number | null;
  total_kcal?: number | null;
  source_apps?: string[];
};

export type ActivitySettings = {
  user_id: string | null;
  /** null = geen toestemming om activiteit op te slaan. */
  health_consent_at: string | null;
  consent_version: string | null;
  share_activity: boolean;
  share_activity_at: string | null;
  coach_activity: boolean;
  coach_activity_at: string | null;
  step_goal: number;
  /** 0, 25, 50, 75 of 100. */
  burn_credit_pct: number;
  updated_at: string | null;
};

export type ActivitySettingsState = ActivitySettings & {
  /** false = supabase/upgrade-activity.sql is nog niet gedraaid ("nog niet ingeschakeld"). */
  available: boolean;
  /** Toestemming om activiteit op te slaan is gegeven. */
  consented: boolean;
  /**
   * Toestemming gegeven voor een oudere versie van de tekst (ACTIVITY_CONSENT_VERSION is opgehoogd):
   * toon ConsentSheet opnieuw. Opnieuw toestemming geven wist niets.
   */
  needsReconsent: boolean;
};

/** Alleen meegegeven velden worden gewijzigd. */
export type ActivitySettingsPatch = {
  /** true = toestemming geven; false = intrekken (verwijdert direct alle activiteit). */
  store?: boolean;
  share?: boolean;
  coach?: boolean;
  stepGoal?: number;
  burnCreditPct?: number;
};

/** Versie van de toestemmingstekst; gelijk aan v_version in save_activity_settings. Samen ophogen. */
export const ACTIVITY_CONSENT_VERSION = "activiteit-v1-2026-11";
export const DEFAULT_STEP_GOAL = 7000;
/** Vaste grens voor "dagen gehaald" op de ranglijst (andermans stappendoel is privé). */
export const LEADERBOARD_DAY_GOAL = 7000;
/** Handmatig invullen kan tot zoveel dagen terug (server: vandaag − 7 t/m vandaag + 1). */
export const MANUAL_DAYS_BACK = 7;
export const BURN_CREDIT_OPTIONS = [0, 25, 50, 75, 100] as const;
/** Gelijk aan de checks in upgrade-activity.sql. */
export const ACTIVITY_LIMITS = {
  steps: { min: 0, max: 100_000 },
  activeKcal: { min: 0, max: 10_000 },
  totalKcal: { min: 0, max: 15_000 },
  stepGoal: { min: 1000, max: 50_000, step: 500 },
} as const;

const DEFAULT_SETTINGS: ActivitySettings = {
  user_id: null,
  health_consent_at: null,
  consent_version: null,
  share_activity: false,
  share_activity_at: null,
  coach_activity: false,
  coach_activity_at: null,
  step_goal: DEFAULT_STEP_GOAL,
  burn_credit_pct: 0,
  updated_at: null,
};

function toState(row: Partial<ActivitySettings> | null, available: boolean): ActivitySettingsState {
  const s: ActivitySettings = { ...DEFAULT_SETTINGS, ...(row ?? {}) };
  s.step_goal = Number(s.step_goal) || DEFAULT_STEP_GOAL;
  s.burn_credit_pct = Number(s.burn_credit_pct) || 0;
  const consented = available && !!s.health_consent_at;
  return { ...s, available, consented, needsReconsent: consented && s.consent_version !== ACTIVITY_CONSENT_VERSION };
}

// ─────────────── Fouten ───────────────

/** Schrijven terwijl upgrade-activity.sql nog niet is gedraaid. */
export class ActivityUnavailableError extends Error {
  constructor() {
    super("Activiteit bijhouden is nog niet ingeschakeld.");
    this.name = "ActivityUnavailableError";
  }
}

/** Ontbreekt het activiteitsschema (script nog niet gedraaid)? */
export function isActivityUnavailable(err: unknown): boolean {
  return err instanceof ActivityUnavailableError || isMissingSchemaError(err);
}

/** Korte Nederlandse melding voor in een toast. Meldingen van de server zijn al Nederlands. */
export function activityErrorMessage(err: unknown): string {
  if (isActivityUnavailable(err)) return "Activiteit bijhouden is nog niet ingeschakeld.";
  return errorMessage(err);
}

function rethrow(err: unknown): never {
  if (isMissingSchemaError(err)) throw new ActivityUnavailableError();
  throw err;
}

// ─────────────── Cache-sleutels ───────────────

export type LeaderboardScope = { scope: "friends" } | { scope: "group"; groupId: string };

export const activitySettingsKey = (userId: string) => `activity:settings:${userId}`;
export const activityRangeKey = (userId: string, from: string, to: string) => `activity:days:${userId}:${from}:${to}`;
export const leaderboardKey = (s: LeaderboardScope, userId: string, weekFrom: string) =>
  s.scope === "group" ? `activity:board:group:${s.groupId}:${userId}:${weekFrom}` : `activity:board:friends:${userId}:${weekFrom}`;

/**
 * Activiteit van deze gebruiker helemaal vergeten: uit het geheugen EN van het toestel (localStorage /
 * IndexedDB). Na intrekken van de toestemming of "alles verwijderen" mag er geen kopie achterblijven.
 */
export function forgetActivityData(userId: string) {
  removeCached(`activity:days:${userId}:`);
  removeCached("activity:board:");
}

/** Na een wijziging: alles van activiteit (of alleen van deze gebruiker + ranglijsten) opnieuw ophalen. */
export function invalidateActivity(userId?: string) {
  if (!userId) {
    invalidate("activity:");
    return;
  }
  invalidate(`activity:settings:${userId}`);
  invalidate(`activity:days:${userId}:`);
  invalidate("activity:board:");
}

// ─────────────── Lezen ───────────────

const DAY_COLUMNS = "user_id, date, source, steps, active_kcal, total_kcal, source_apps, synced_at";

function normalizeDay(r: DailyActivity): DailyActivity {
  return {
    ...r,
    steps: r.steps == null ? null : Number(r.steps),
    active_kcal: r.active_kcal == null ? null : Number(r.active_kcal),
    total_kcal: r.total_kcal == null ? null : Number(r.total_kcal),
    source_apps: Array.isArray(r.source_apps) ? r.source_apps : [],
  };
}

/** Je instellingen; standaardwaarden als er nog geen rij is, `available: false` zonder schema. */
export async function fetchActivitySettings(userId: string): Promise<ActivitySettingsState> {
  const { data, error } = await supabase.from("activity_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) return toState(null, false);
    throw error;
  }
  return toState((data as ActivitySettings | null) ?? { user_id: userId }, true);
}

/** Je eigen effectieve dagen in [from, to] (YYYY-MM-DD, inclusief), oplopend. [] zonder schema. */
export async function fetchMyActivity(userId: string, from: string, to: string): Promise<DailyActivity[]> {
  const { data, error } = await supabase
    .from("daily_activity_effective")
    .select(DAY_COLUMNS)
    .eq("user_id", userId)
    .gte("date", from)
    .lte("date", to)
    .order("date");
  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
  return ((data ?? []) as DailyActivity[]).map(normalizeDay);
}

/**
 * Stappen per dag van meerdere gebruikers in [from, to] (hooguit 31 dagen), via de server-functie
 * activity_steps_for. Je krijgt altijd je eigen dagen; van een vriend of groepsgenoot alleen als jij
 * en die ander allebei delen. Alleen stappen en bron: kcal, apps en tijdzone blijven privé (die
 * velden zijn hier null / leeg). [] zonder schema.
 */
export async function fetchWeekSteps(userIds: string[], from: string, to: string): Promise<DailyActivity[]> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return [];
  const out: DailyActivity[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await supabase.rpc("activity_steps_for", { p_user_ids: ids.slice(i, i + 500), p_from: from, p_to: to });
    if (error) {
      if (isMissingSchemaError(error)) return [];
      throw error;
    }
    for (const r of (data ?? []) as { user_id: string; date: string; source: ActivitySource; steps: number | null }[]) {
      out.push(normalizeDay({ ...r, active_kcal: null, total_kcal: null, source_apps: [], synced_at: "" }));
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ─────────────── Schrijven ───────────────

/** Instellingen of toestemmingen wijzigen (alleen via de server-functie). Werkt de cache direct bij. */
export async function saveActivitySettings(userId: string, patch: ActivitySettingsPatch): Promise<ActivitySettingsState> {
  const { data, error } = await supabase.rpc("save_activity_settings", {
    p_store: patch.store ?? null,
    p_share: patch.share ?? null,
    p_coach: patch.coach ?? null,
    p_step_goal: patch.stepGoal ?? null,
    p_burn_credit_pct: patch.burnCreditPct ?? null,
  });
  if (error) rethrow(error);
  const row = (Array.isArray(data) ? data[0] : data) as ActivitySettings | null;
  const state = toState(row ?? { user_id: userId }, true);
  // Ook de bewaarde kopie op het toestel bijwerken, anders toont een herstart de oude stand.
  setCached(activitySettingsKey(userId), state, true);
  if (patch.store === false) {
    // Intrekken wist alles op de server: ook geen kopie op dit toestel laten staan.
    forgetActivityData(userId);
  } else if (patch.store !== undefined || patch.share !== undefined) {
    // Delen verandert de ranglijsten.
    invalidate(`activity:days:${userId}:`);
    invalidate("activity:board:");
  }
  return state;
}

function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Dagtotalen opslaan voor een bron. De ENIGE schrijfroute (ook voor native sync later).
 * Elke dag vervangt de bestaande waarden voor die bron (nooit optellen). Geeft het aantal opgeslagen
 * dagen terug. Ververst daarna de activiteit in de cache (niet de instellingen).
 */
export async function upsertDailyActivity(source: ActivitySource, days: DailyActivityPayload[]): Promise<number> {
  if (!days.length) return 0;
  const { data, error } = await supabase.rpc("upsert_daily_activity", {
    p_source: source,
    p_days: days.map((d) => ({
      date: d.date,
      steps: d.steps ?? null,
      active_kcal: d.active_kcal ?? null,
      total_kcal: d.total_kcal ?? null,
      ...(d.source_apps ? { source_apps: d.source_apps.slice(0, 10) } : {}),
    })),
    p_tz: deviceTimeZone(),
  });
  if (error) rethrow(error);
  invalidate("activity:days:");
  invalidate("activity:board:");
  return Number(data) || 0;
}

/**
 * Al je opgeslagen activiteit verwijderen (alle bronnen en dagen). De toestemming blijft staan;
 * voor stoppen met bijhouden: saveActivitySettings(userId, { store: false }).
 */
export async function deleteAllActivity(userId: string): Promise<void> {
  const { error } = await supabase.from("daily_activity").delete().eq("user_id", userId);
  if (error) rethrow(error);
  forgetActivityData(userId);
}

/** De 7 datums die je handmatig mag invullen: vandaag, gisteren, … (YYYY-MM-DD, nieuwste eerst). */
export function manualEntryDates(now: Date = new Date()): string[] {
  return Array.from({ length: MANUAL_DAYS_BACK }, (_, i) => toISODate(addDays(now, -i)));
}

export type ManualEntry = { date: string; steps: number | null; active_kcal?: number | null };

/** Zelfde controles als de server. Nederlandse foutmelding, of null als het klopt. */
export function validateManualEntry(e: ManualEntry, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return "Kies een datum.";
  const min = toISODate(addDays(now, -MANUAL_DAYS_BACK));
  const max = toISODate(addDays(now, 1));
  if (e.date < min || e.date > max) return "Je kunt alleen de afgelopen 7 dagen handmatig invullen.";
  const check = (v: number | null | undefined, lim: { min: number; max: number }, label: string) => {
    if (v == null) return null;
    if (!Number.isFinite(v) || v < lim.min || v > lim.max) {
      return `${label} moeten tussen ${lim.min.toLocaleString("nl-NL")} en ${lim.max.toLocaleString("nl-NL")} liggen.`;
    }
    return null;
  };
  const err = check(e.steps, ACTIVITY_LIMITS.steps, "Stappen") ?? check(e.active_kcal, ACTIVITY_LIMITS.activeKcal, "Actieve kcal");
  if (err) return err;
  if (e.steps == null && e.active_kcal == null) return "Vul je stappen in.";
  return null;
}

/** Handmatige invoer opslaan (vervangt een eerdere handmatige invoer voor die dag). */
export async function saveManualActivity(userId: string, e: ManualEntry): Promise<void> {
  const msg = validateManualEntry(e);
  if (msg) throw new Error(msg);
  await upsertDailyActivity("manual", [
    { date: e.date, steps: e.steps == null ? null : Math.round(e.steps), active_kcal: e.active_kcal == null ? null : Math.round(e.active_kcal) },
  ]);
  invalidate(`activity:days:${userId}:`);
}

/** Handmatige invoer van een dag wissen (gegevens van een toestel blijven staan). */
export async function clearManualActivity(userId: string, date: string): Promise<void> {
  await upsertDailyActivity("manual", [{ date, steps: null, active_kcal: null, total_kcal: null }]);
  invalidate(`activity:days:${userId}:`);
}

// ─────────────── Bronnen (weergave) ───────────────

export const SOURCE_LABELS: Record<ActivitySource, string> = {
  manual: "Handmatig",
  health_connect: "Health Connect",
  healthkit: "Apple Health",
  garmin: "Garmin",
  shortcut: "Snelkoppeling",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source as ActivitySource] ?? "Onbekende bron";
}

/** Komt van een telefoon of horloge (niet handmatig ingevoerd). */
export function isDeviceSource(source: string): boolean {
  return source !== "manual";
}

const APP_LABELS: Record<string, string> = {
  "com.garmin.android.apps.connectmobile": "Garmin Connect",
  "com.sec.android.app.shealth": "Samsung Health",
  "com.google.android.apps.fitness": "Google Health",
  "com.fitbit.FitbitMobile": "Fitbit",
  "com.mi.health": "Mi Fitness",
  "com.xiaomi.wearable": "Mi Fitness",
  "com.huami.watch.hmwatchmanager": "Zepp",
  "com.zepp.life": "Zepp Life",
  "com.xiaomi.hm.health": "Zepp Life",
  "com.google.android.apps.healthdata": "Health Connect",
  "com.apple.health": "Apple Health",
};

/** Leesbare naam van een app-pakket; onbekend wordt "Andere app". */
export function appLabel(pkg: string): string {
  return APP_LABELS[pkg] ?? "Andere app";
}

/** Bijv. "Health Connect · Garmin Connect" of "Handmatig ingevoerd". */
export function sourceLine(day: Pick<DailyActivity, "source" | "source_apps">): string {
  if (day.source === "manual") return "Handmatig ingevoerd";
  const apps = [...new Set((day.source_apps ?? []).map(appLabel))].filter((a) => a !== SOURCE_LABELS[day.source as ActivitySource]);
  return [sourceLabel(day.source), ...apps].join(" · ");
}

/**
 * Stappen om te tonen. Apple Health meldt 0 als er niets gemeten is (bijv. telefoon niet bij je):
 * dat telt als "geen data" (null), niet als nul stappen.
 */
export function effectiveSteps(day: Pick<DailyActivity, "source" | "steps"> | null | undefined): number | null {
  if (!day || day.steps == null) return null;
  if (day.source === "healthkit" && day.steps === 0) return null;
  return day.steps;
}

// ─────────────── Calorieën terugverdienen (voeding) ───────────────

/**
 * Extra kcal voor het voedingsdoel. Het doel (BMR × activiteitsfactor) rekent al met beweging, dus
 * alleen actieve kcal BOVEN wat het doel verwacht tellen mee, en daarvan `pct` procent.
 * credit = clamp(afgerond op 10(pct% × (actief − verwacht)), 0, 1000), met verwacht = TDEE − 1,1 × BMR.
 * Voorbeeld: TDEE 2635, BMR 1700, actief 1200, 50% → 220 kcal. Gebruik nooit total_kcal.
 */
export function activityCredit(
  t: { bmr: number | null; tdee: number | null } | null | undefined,
  activeKcal: number | null | undefined,
  pct: number,
): number {
  if (!t?.bmr || !t?.tdee || !activeKcal || activeKcal <= 0 || !(pct > 0)) return 0;
  const expected = Math.max(0, t.tdee - t.bmr * 1.1);
  const credit = Math.round(((activeKcal - expected) * Math.min(pct, 100)) / 100 / 10) * 10;
  return Math.max(0, Math.min(1000, credit));
}

/**
 * Hoeveel actieve kcal per dag je voedingsdoel al verwacht door je gekozen activiteitsniveau
 * (zelfde formule als in activityCredit). null als BMR of TDEE onbekend is. Afgerond op 10.
 */
export function expectedActiveKcal(t: { bmr: number | null; tdee: number | null } | null | undefined): number | null {
  if (!t?.bmr || !t?.tdee) return null;
  return Math.round(Math.max(0, t.tdee - t.bmr * 1.1) / 10) * 10;
}

/** Doelen met de extra kcal erbij; de extra energie gaat naar koolhydraten. */
export function applyCredit<T extends { kcal: number; carbs: number }>(targets: T, credit: number): T {
  if (!(credit > 0)) return targets;
  return { ...targets, kcal: targets.kcal + credit, carbs: targets.carbs + Math.round(credit / 4) };
}

// ─────────────── Ranglijst stappen (week) ───────────────

export type StepsLeaderboardEntry = {
  user_id: string;
  profile: PublicProfile | null;
  /** 1 = meeste stappen; gelijke totalen delen een plek. */
  rank: number;
  isMe: boolean;
  totalSteps: number;
  /** Gemiddelde over dagen met data (afgerond). */
  avgSteps: number;
  daysWithData: number;
  /** Dagen met minstens LEADERBOARD_DAY_GOAL stappen. */
  daysGoalMet: number;
  /** Minstens één dag deze week kwam uit handmatige invoer. */
  manual: boolean;
  /** Stappen per dag (YYYY-MM-DD → stappen of null), voor alle 7 dagen. */
  perDay: Record<string, number | null>;
};

export type StepsLeaderboard = {
  /** false = upgrade-activity.sql nog niet gedraaid. */
  available: boolean;
  week: { from: string; to: string; days: string[] };
  /** Alleen wie deelt (en jijzelf als je data hebt); gesorteerd op totaal. */
  entries: StepsLeaderboardEntry[];
};

/** Puur: rijen + profielen → gesorteerde ranglijst. Alleen op stappen, nooit op kcal. */
export function buildLeaderboard(
  rows: DailyActivity[],
  profiles: Map<string, PublicProfile>,
  meId: string | null,
  days: string[],
): StepsLeaderboardEntry[] {
  const byUser = new Map<string, DailyActivity[]>();
  for (const r of rows) {
    if (!days.includes(r.date)) continue;
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }
  const entries: StepsLeaderboardEntry[] = [];
  for (const [uid, list] of byUser) {
    const perDay: Record<string, number | null> = Object.fromEntries(days.map((d) => [d, null]));
    let total = 0;
    let withData = 0;
    let met = 0;
    let manual = false;
    for (const r of list) {
      const s = effectiveSteps(r);
      if (s == null) continue;
      perDay[r.date] = s;
      total += s;
      withData++;
      if (s >= LEADERBOARD_DAY_GOAL) met++;
      if (r.source === "manual") manual = true;
    }
    if (!withData) continue;
    entries.push({
      user_id: uid,
      profile: profiles.get(uid) ?? null,
      rank: 0,
      isMe: uid === meId,
      totalSteps: total,
      avgSteps: Math.round(total / withData),
      daysWithData: withData,
      daysGoalMet: met,
      manual,
      perDay,
    });
  }
  entries.sort(
    (a, b) =>
      b.totalSteps - a.totalSteps ||
      (a.profile?.display_name ?? "").localeCompare(b.profile?.display_name ?? "", "nl"),
  );
  entries.forEach((e, i) => {
    e.rank = i > 0 && e.totalSteps === entries[i - 1].totalSteps ? entries[i - 1].rank : i + 1;
  });
  return entries;
}

async function leaderboardUserIds(s: LeaderboardScope, userId: string): Promise<string[]> {
  if (s.scope === "group") {
    const { data, error } = await supabase.from("group_members").select("user_id").eq("group_id", s.groupId);
    if (error) throw error;
    return [...new Set([userId, ...(data ?? []).map((r) => (r as { user_id: string }).user_id)])];
  }
  // RLS geeft alleen je eigen vriendschappen terug.
  const { data, error } = await supabase.from("friendships").select("requester, addressee").eq("status", "accepted");
  if (error) throw error;
  const ids = (data ?? []).map((r) => {
    const f = r as { requester: string; addressee: string };
    return f.requester === userId ? f.addressee : f.requester;
  });
  return [...new Set([userId, ...ids])];
}

async function fetchProfiles(ids: string[]): Promise<Map<string, PublicProfile>> {
  const out = new Map<string, PublicProfile>();
  if (!ids.length) return out;
  const query = (cols: string) => supabase.from("profiles").select(cols).in("id", ids);
  let { data, error } = await query(PUBLIC_PROFILE_COLUMNS);
  // upgrade-avatars.sql nog niet gedraaid: zonder profielfoto opnieuw.
  if (error && isMissingSchemaError(error)) ({ data, error } = await query(PUBLIC_PROFILE_COLUMNS_NO_PHOTO));
  if (error) throw error;
  for (const p of (data ?? []) as unknown as PublicProfile[]) out.set(p.id, p);
  return out;
}

/**
 * Ranglijst stappen voor een week (maandag t/m zondag), voor je vrienden (+ jijzelf) of een groep.
 * `weekOffset` 0 = deze week, -1 = vorige week. Wie niet deelt, staat er niet in (server).
 */
export async function fetchStepsLeaderboard(s: LeaderboardScope, userId: string, weekOffset = 0): Promise<StepsLeaderboard> {
  const week = weekRange(weekOffset);
  const probe = await supabase.from("daily_activity_effective").select("user_id").limit(1);
  if (probe.error) {
    if (isMissingSchemaError(probe.error)) return { available: false, week, entries: [] };
    throw probe.error;
  }
  const ids = await leaderboardUserIds(s, userId);
  const rows = await fetchWeekSteps(ids, week.from, week.to);
  const profiles = await fetchProfiles([...new Set(rows.map((r) => r.user_id))]);
  return { available: true, week, entries: buildLeaderboard(rows, profiles, userId, week.days) };
}

// ─────────────── Hooks ───────────────

export function useActivitySettings(userId: string | null): CachedState<ActivitySettingsState> {
  return useCachedState(userId ? activitySettingsKey(userId) : null, () => fetchActivitySettings(userId!), {
    persist: true,
    maxAge: 60_000,
  });
}

/** Je effectieve dagen in [from, to]. */
export function useMyActivity(userId: string | null, from: string, to: string): CachedState<DailyActivity[]> {
  return useCachedState(userId ? activityRangeKey(userId, from, to) : null, () => fetchMyActivity(userId!, from, to), {
    persist: true,
    maxAge: 60_000,
  });
}

/** De laatste `days` dagen t/m vandaag (voor de kaart op Home: 7 dagbalkjes). */
export function useRecentActivity(userId: string | null, days = 7): CachedState<DailyActivity[]> & { from: string; to: string } {
  const to = toISODate();
  const from = toISODate(addDays(parseISODate(to), -(days - 1)));
  return { ...useMyActivity(userId, from, to), from, to };
}

/** Eén dag (bijv. de dag die op de voedingspagina bekeken wordt). */
export function useActivityDay(userId: string | null, date: string): CachedState<DailyActivity[]> & { day: DailyActivity | null } {
  const state = useMyActivity(userId, date, date);
  return { ...state, day: state.data?.find((d) => d.date === date) ?? null };
}

export function useStepsLeaderboard(s: LeaderboardScope, userId: string | null, weekOffset = 0): CachedState<StepsLeaderboard> {
  const weekFrom = weekRange(weekOffset).from;
  const valid = !!userId && (s.scope === "friends" || !!s.groupId);
  return useCachedState(valid ? leaderboardKey(s, userId!, weekFrom) : null, () => fetchStepsLeaderboard(s, userId!, weekOffset), {
    maxAge: 60_000,
  });
}
