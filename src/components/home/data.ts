"use client";

import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { sessionsBySlug, type HistorySet, type Session } from "@/lib/history";
import { supabase } from "@/lib/supabase";
import type { Role, Workout } from "@/lib/types";

/** Fetchers voor Home. Ze gooien bij een fout, zodat de cache nooit goede data door een lege lijst vervangt. */

export type UpcomingWorkout = Workout & { groups: { name: string } | null; workout_exercises: { count: number }[] };

export const exerciseCount = (w: UpcomingWorkout) => w.workout_exercises[0]?.count ?? 0;
export const exercisesLabel = (n: number) => (n === 0 ? "Nog geen oefeningen" : `${n} ${n === 1 ? "oefening" : "oefeningen"}`);

/** Trainingen van je eigen groepen vanaf `from` (groups!inner: niet die van vrienden). */
export async function fetchUpcoming(from: string): Promise<UpcomingWorkout[]> {
  const { data, error } = await supabase
    .from("workouts")
    .select("*, groups!inner(name), workout_exercises(count)")
    .gte("date", from)
    .order("date")
    .order("created_at")
    .limit(12);
  if (error) throw error;
  return (data ?? []) as UpcomingWorkout[];
}

// ───────────────────────── Training van vandaag ─────────────────────────

export type TodayLog = { user_id: string; workout_exercise_id: string; reps: number | null; weight: number | null };
export type TodayMember = { user_id: string; role: Role; name: string };

/** Voortgang van één persoon: aantal oefeningen met minstens één set, sets en volume. */
export function progressOf(logs: TodayLog[], userId: string) {
  const mine = logs.filter((l) => l.user_id === userId && (l.reps ?? 0) > 0);
  return {
    exercises: new Set(mine.map((l) => l.workout_exercise_id)).size,
    sets: mine.length,
    volume: mine.reduce((v, l) => v + (l.weight ?? 0) * (l.reps ?? 0), 0),
  };
}

// ───────────────────────── Vrienden (licht) ─────────────────────────

type FriendRow = {
  user_id: string;
  reps: number | null;
  weight: number | null;
  created_at: string;
  workout_exercise_id: string;
  workout_exercises: { exercise_slug: string; workout_id: string; workouts: { date: string; title: string } };
};

export type FriendSession = {
  userId: string;
  workoutId: string;
  title: string;
  date: string;
  exercises: number;
  sets: number;
  volume: number;
  lastAt: string;
};

export type FriendsRecent = {
  /** Per vriend: getrainde dagen in de opgehaalde periode. */
  days: Record<string, string[]>;
  sessions: FriendSession[];
};

/**
 * Eén query voor de recente sets van alle vrienden (sinds `sinceISO`), in plaats van per vriend de
 * hele geschiedenis. Genoeg voor "x/y deze week" en een activiteitenoverzicht.
 */
export async function fetchFriendsRecent(ids: string[], sinceISO: string): Promise<FriendsRecent> {
  const out: FriendsRecent = { days: {}, sessions: [] };
  if (!ids.length) return out;
  const rows: FriendRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("set_logs")
      .select(
        "user_id, reps, weight, created_at, workout_exercise_id, workout_exercises!inner(exercise_slug, workout_id, workouts!inner(date, title))",
      )
      .in("user_id", ids)
      .gt("reps", 0)
      .gte("created_at", sinceISO)
      .order("created_at")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as FriendRow[]));
    if (!data || data.length < PAGE) break;
  }

  const sessions = new Map<string, FriendSession & { we: Set<string> }>();
  const days = new Map<string, Set<string>>();
  for (const r of rows) {
    const we = r.workout_exercises;
    const date = we.workouts.date;
    if (!days.has(r.user_id)) days.set(r.user_id, new Set());
    days.get(r.user_id)!.add(date);
    const key = `${r.user_id}|${we.workout_id}`;
    let s = sessions.get(key);
    if (!s) {
      s = { userId: r.user_id, workoutId: we.workout_id, title: we.workouts.title, date, exercises: 0, sets: 0, volume: 0, lastAt: r.created_at, we: new Set() };
      sessions.set(key, s);
    }
    s.we.add(r.workout_exercise_id);
    s.sets++;
    s.volume += (r.weight != null ? Number(r.weight) : 0) * (r.reps ?? 0);
    if (r.created_at > s.lastAt) s.lastAt = r.created_at;
  }
  for (const [id, set] of days) out.days[id] = [...set].sort();
  out.sessions = [...sessions.values()]
    .map(({ we, ...s }) => ({ ...s, exercises: we.size }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.lastAt.localeCompare(a.lastAt));
  return out;
}

/** Korte, stabiele hash (voor een cachesleutel die verandert als je vriendenlijst verandert). */
export function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ───────────────────────── Records ─────────────────────────

export type PersonalRecord = {
  slug: string;
  name: string;
  date: string;
  workoutId: string;
  unit: "kg" | "reps";
  value: number;
  delta: number;
};

/** Sessies die een record waren ten opzichte van alles daarvoor (een eerste keer telt niet). */
export function findRecords(history: HistorySet[], filter: (s: Session) => boolean): PersonalRecord[] {
  const out: PersonalRecord[] = [];
  for (const [slug, list] of sessionsBySlug(history)) {
    list.forEach((s, i) => {
      if (!filter(s)) return;
      const prior = list.slice(0, i).filter((p) => p.date < s.date);
      if (!prior.length) return;
      if (s.best1RM != null) {
        const prev = Math.max(0, ...prior.map((p) => p.best1RM ?? 0));
        if (prev > 0 && s.best1RM > prev) {
          out.push({ slug, name: EXERCISE_BY_SLUG[slug]?.name ?? slug, date: s.date, workoutId: s.workoutId, unit: "kg", value: s.best1RM, delta: s.best1RM - prev });
        }
      } else if (!s.sets.some((x) => (x.weight ?? 0) > 0)) {
        const bw = prior.filter((p) => p.best1RM == null);
        const prev = Math.max(0, ...bw.map((p) => p.maxReps));
        if (bw.length && prev > 0 && s.maxReps > prev) {
          out.push({ slug, name: EXERCISE_BY_SLUG[slug]?.name ?? slug, date: s.date, workoutId: s.workoutId, unit: "reps", value: s.maxReps, delta: s.maxReps - prev });
        }
      }
    });
  }
  // Per oefening alleen het hoogste record.
  const best = new Map<string, PersonalRecord>();
  for (const r of out) {
    const cur = best.get(r.slug);
    if (!cur || r.value > cur.value) best.set(r.slug, r);
  }
  return [...best.values()].sort((a, b) => b.date.localeCompare(a.date) || b.delta - a.delta);
}

export const kg = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("nl-NL")} kg`;
