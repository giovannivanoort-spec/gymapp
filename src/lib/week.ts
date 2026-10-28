import { toISODate } from "./dates";
import { supabase } from "./supabase";
import type { PlannedExercise } from "./types";

/**
 * Weekrekenwerk (maandag t/m zondag, lokale tijd).
 * Datums zijn overal YYYY-MM-DD-strings, net als in de database.
 */

/** Wetenschappelijk onderbouwd bereik: 10–20 harde sets per spiergroep per week. */
export const WEEKLY_SETS_MIN = 10;
export const WEEKLY_SETS_MAX = 20;

export type VolumeStatus = "low" | "good" | "high";

export function volumeStatus(sets: number): VolumeStatus {
  if (sets < WEEKLY_SETS_MIN) return "low";
  if (sets > WEEKLY_SETS_MAX) return "high";
  return "good";
}

/** YYYY-MM-DD → lokale Date om middernacht. */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Maandag (00:00 lokaal) van de week waarin `d` valt. */
export function startOfWeek(d: Date = new Date()): Date {
  const day = (d.getDay() + 6) % 7; // ma = 0 … zo = 6
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
}

/** Sleutel van een week: de maandag als YYYY-MM-DD. */
export function weekKey(date: string | Date): string {
  return toISODate(startOfWeek(typeof date === "string" ? parseISODate(date) : date));
}

/** Eerste en laatste dag van een week; `offset` 0 = deze week, -1 = vorige week. */
export function weekRange(offset = 0, now: Date = new Date()): { from: string; to: string; days: string[] } {
  const monday = addDays(startOfWeek(now), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => toISODate(addDays(monday, i)));
  return { from: days[0], to: days[6], days };
}

/** Bijv. "27 okt – 2 nov". */
export function formatWeekRange(range: { from: string; to: string }): string {
  const f = (iso: string) => parseISODate(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  return `${f(range.from)} – ${f(range.to)}`;
}

/** Alleen sets met herhalingen tellen als gedaan. */
const isDone = (s: { reps: number | null }) => (s.reps ?? 0) > 0;

/** Gedane sets binnen [from, to] (inclusief). */
export function setsInRange<T extends { date: string; reps: number | null }>(sets: T[], from: string, to: string): T[] {
  return sets.filter((s) => s.date >= from && s.date <= to && isDone(s));
}

/** Gelogde sets → "plan" (aantal sets per oefening) zodat analyzePlan het volume per spier kan berekenen. */
export function setsToPlan(sets: { slug: string; reps: number | null }[]): PlannedExercise[] {
  const count = new Map<string, number>();
  for (const s of sets) if (isDone(s)) count.set(s.slug, (count.get(s.slug) ?? 0) + 1);
  return [...count].map(([slug, n]) => ({ slug, sets: n, reps: "" }));
}

/** Aantal verschillende getrainde dagen per week (sleutel = maandag). */
export function trainedDaysPerWeek(days: Iterable<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of new Set(days)) {
    const k = weekKey(d);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/**
 * Aantal weken op rij waarin het doel (getrainde dagen) gehaald is. Telt vanaf deze week als die al
 * gehaald is, anders vanaf vorige week (de huidige week is dan nog niet verloren).
 */
export function weekStreak(perWeek: Map<string, number>, goal: number, now: Date = new Date()): number {
  let monday = startOfWeek(now);
  if ((perWeek.get(toISODate(monday)) ?? 0) < goal) monday = addDays(monday, -7);
  let streak = 0;
  while ((perWeek.get(toISODate(monday)) ?? 0) >= goal) {
    streak++;
    monday = addDays(monday, -7);
  }
  return streak;
}

/** Alle dagen (YYYY-MM-DD) waarop iemand minstens één set met herhalingen heeft gelogd. */
export async function fetchTrainedDays(userId: string): Promise<Set<string>> {
  const days = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("set_logs")
      .select("id, workout_exercises!inner(workouts!inner(date))")
      .eq("user_id", userId)
      .gt("reps", 0)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const r of data as unknown as { workout_exercises: { workouts: { date: string } } }[]) {
      days.add(r.workout_exercises.workouts.date);
    }
    if (data.length < PAGE) break;
  }
  return days;
}
