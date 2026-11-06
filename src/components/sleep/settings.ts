"use client";

/**
 * Slaapinstellingen: slaapdoel en "slaap gebruiken door de AI-coach". Opgeslagen in activity_settings
 * (supabase/upgrade-sleep-settings.sql) via save_sleep_settings.
 *
 * Werkt ook zonder dat script: het slaapdoel wordt dan alleen op dit toestel bewaard (localStorage) en de
 * coach-keuze voor slaap is niet beschikbaar (sleepCoachAvailable false).
 *
 * - useSleepGoal(userId) → { goal (minuten), synced (op de server bewaard) }
 * - saveSleepSettings(userId, { goalMinutes?, coachSleep? }) → werkt de gecachete instellingen bij
 * - sleepCoachAvailable(settings) / sleepCoachOn(settings)
 * - SLEEP_GOAL_LIMITS (4 tot 12 uur, stappen van 15 minuten)
 */

import { useSyncExternalStore } from "react";
import { activitySettingsKey, useActivitySettings, type ActivitySettingsState } from "@/lib/activity";
import { getCached, setCached } from "@/lib/cache";
import { isMissingSchemaError, supabase } from "@/lib/supabase";
import { DEFAULT_SLEEP_GOAL_MINUTES } from "@/lib/sleep";

/** Gelijk aan de check in upgrade-sleep-settings.sql. */
export const SLEEP_GOAL_LIMITS = { min: 240, max: 720, step: 15 } as const;

/** activity_settings met de kolommen uit upgrade-sleep-settings.sql (ontbreken als dat nog niet is gedraaid). */
type WithSleep = ActivitySettingsState & { sleep_goal_minutes?: number | null; coach_sleep?: boolean | null };

const validGoal = (n: unknown): number | null => {
  const v = Number(n);
  return Number.isFinite(v) && v >= SLEEP_GOAL_LIMITS.min && v <= SLEEP_GOAL_LIMITS.max ? Math.round(v) : null;
};

// ── Slaapdoel op dit toestel (alleen als de kolom op de server nog ontbreekt) ──
const LOCAL_KEY = (uid: string) => `spotter:sleep-goal:${uid}`;
const listeners = new Set<() => void>();
const memoryGoal = new Map<string, number>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function readLocalGoal(uid: string | null): number | null {
  if (!uid) return null;
  try {
    return validGoal(window.localStorage.getItem(LOCAL_KEY(uid))) ?? memoryGoal.get(uid) ?? null;
  } catch {
    return memoryGoal.get(uid) ?? null;
  }
}

function writeLocalGoal(uid: string, minutes: number) {
  memoryGoal.set(uid, minutes);
  try {
    window.localStorage.setItem(LOCAL_KEY(uid), String(minutes));
  } catch {
    // privévenster of geblokkeerde opslag: alleen voor deze sessie
  }
  listeners.forEach((cb) => cb());
}

/** Staat de kolom op de server (upgrade-sleep-settings.sql gedraaid)? Onbekend zonder rij: null. */
function serverGoal(settings: ActivitySettingsState | undefined): number | null {
  return validGoal((settings as WithSleep | undefined)?.sleep_goal_minutes);
}

/** Kan "slaap gebruiken door de AI-coach" worden ingesteld (kolom bestaat)? */
export function sleepCoachAvailable(settings: ActivitySettingsState | undefined): boolean {
  return !!settings && typeof (settings as WithSleep).coach_sleep === "boolean";
}

/** Mag de AI-coach je slaap lezen (alle voorwaarden, zelfde als de server)? */
export function sleepCoachOn(settings: ActivitySettingsState | undefined): boolean {
  return !!settings && settings.consented && !settings.needsReconsent && settings.coach_activity && (settings as WithSleep).coach_sleep === true;
}

/** Je slaapdoel in minuten (server, anders dit toestel, anders 8 uur). */
export function useSleepGoal(userId: string | null): { goal: number; synced: boolean } {
  const st = useActivitySettings(userId);
  const local = useSyncExternalStore(
    subscribe,
    () => readLocalGoal(userId),
    () => null,
  );
  const server = serverGoal(st.data);
  return { goal: server ?? local ?? DEFAULT_SLEEP_GOAL_MINUTES, synced: server != null };
}

/**
 * Slaapdoel en/of slaap-voor-de-coach opslaan. Zonder upgrade-sleep-settings.sql: het doel alleen op dit
 * toestel; de coach-keuze geeft dan een fout. Gooit bij andere fouten (Nederlandse melding van de server).
 */
export async function saveSleepSettings(userId: string, patch: { goalMinutes?: number; coachSleep?: boolean }): Promise<void> {
  const goal = patch.goalMinutes == null ? null : validGoal(patch.goalMinutes);
  if (patch.goalMinutes != null && goal == null) throw new Error("Je slaapdoel moet tussen 4 en 12 uur liggen.");
  const { data, error } = await supabase.rpc("save_sleep_settings", {
    p_goal_minutes: goal,
    p_coach_sleep: patch.coachSleep ?? null,
  });
  if (error) {
    if (isMissingSchemaError(error)) {
      if (patch.coachSleep !== undefined) throw new Error("Slaap delen met de AI-coach is nog niet ingeschakeld.");
      if (goal != null) writeLocalGoal(userId, goal);
      return;
    }
    throw error;
  }
  if (goal != null) writeLocalGoal(userId, goal);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  const key = activitySettingsKey(userId);
  const current = getCached<ActivitySettingsState>(key);
  if (row && current) {
    // Alleen de slaapvelden overnemen; toestemming en de rest komen uit fetchActivitySettings.
    setCached(
      key,
      { ...current, sleep_goal_minutes: row.sleep_goal_minutes, coach_sleep: row.coach_sleep, updated_at: row.updated_at } as WithSleep,
      true,
    );
  }
}
