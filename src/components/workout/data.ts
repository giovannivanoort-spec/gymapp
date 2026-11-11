"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchCached, getCached, useCached } from "@/lib/cache";
import { errorMessage, isMissingSchemaError, supabase } from "@/lib/supabase";
import { PUBLIC_PROFILE_COLUMNS, PUBLIC_PROFILE_COLUMNS_NO_PHOTO, type Comment, type GroupMember, type SetLog } from "@/lib/types";
import { normalizeLog, type FullWorkout, type HistRow, type WorkoutBundle } from "./logic";

export type CommentWithAuthor = Comment & { profiles: { display_name: string } | null };

export const workoutKey = (id: string) => `wo:workout:${id}`;
export const logsKey = (id: string) => `wo:logs:${id}`;
export const commentsKey = (id: string) => `wo:comments:${id}`;
/** Voorvoegsel van alle eerdere-sets-sleutels van één training (om ze samen te vergeten). */
export const histPrefix = (workoutId: string) => `wo:hist:${workoutId}:`;
const histKey = (workoutId: string, uid: string) => `${histPrefix(workoutId)}${uid}`;

function fail(error: { message: string }): never {
  throw new Error(error.message);
}

/** Training + groepsleden. `null` = bestaat niet (of geen toegang); een fout wordt gegooid. */
export async function fetchWorkout(id: string): Promise<WorkoutBundle | null> {
  const { data, error } = await supabase
    .from("workouts")
    .select("*, groups(name), workout_exercises(*)")
    .eq("id", id)
    .maybeSingle();
  // 22P02 = geen geldig id: behandelen als "niet gevonden".
  if (error && error.code === "22P02") return null;
  if (error) fail(error);
  if (!data) return null;
  const members = (cols: string) =>
    supabase.from("group_members").select(`*, profiles(${cols})`).eq("group_id", data.group_id).order("joined_at");
  let { data: m, error: e2 } = await members(PUBLIC_PROFILE_COLUMNS);
  // upgrade-avatars.sql nog niet gedraaid: zonder profielfoto opnieuw.
  if (e2 && isMissingSchemaError(e2)) ({ data: m, error: e2 } = await members(PUBLIC_PROFILE_COLUMNS_NO_PHOTO));
  if (e2) fail(e2);
  return { workout: data as FullWorkout, members: (m as unknown as GroupMember[] | null) ?? [] };
}

/** Alle sets van alle personen in deze training. */
export async function fetchLogs(workoutId: string): Promise<SetLog[]> {
  const { data, error } = await supabase
    .from("set_logs")
    .select("id, workout_exercise_id, user_id, set_number, reps, weight, created_at, workout_exercises!inner(workout_id)")
    .eq("workout_exercises.workout_id", workoutId);
  if (error) fail(error);
  return (data ?? []).map((r) => normalizeLog(r as unknown as Record<string, unknown>));
}

export async function fetchComments(workoutId: string): Promise<CommentWithAuthor[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("*, profiles(display_name)")
    .eq("workout_id", workoutId)
    .order("created_at");
  if (error) fail(error);
  return (data as CommentWithAuthor[]) ?? [];
}

type HistQueryRow = {
  set_number: number;
  weight: number | null;
  reps: number | null;
  created_at: string;
  workout_exercise_id: string;
  workout_exercises: { exercise_slug: string; workouts: { date: string } };
};

/** Eerdere sets van één persoon voor deze oefeningen, uit andere trainingen. */
async function fetchHistory(uid: string, slugs: string[], workoutId: string): Promise<HistRow[]> {
  const out: HistRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("set_logs")
      .select("set_number, weight, reps, created_at, workout_exercise_id, workout_exercises!inner(exercise_slug, workout_id, workouts!inner(date))")
      .eq("user_id", uid)
      .in("workout_exercises.exercise_slug", slugs)
      .neq("workout_exercises.workout_id", workoutId)
      .order("created_at")
      .range(from, from + PAGE - 1);
    if (error) fail(error);
    const rows = (data ?? []) as unknown as HistQueryRow[];
    for (const r of rows) {
      out.push({
        s: r.workout_exercises.exercise_slug,
        x: r.workout_exercise_id,
        d: r.workout_exercises.workouts.date,
        n: r.set_number,
        w: r.weight == null ? null : Number(r.weight),
        r: r.reps,
        t: r.created_at,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Cache-gebaseerd laden met een zichtbare foutstatus: toont direct wat er bewaard is (ook
 * offline), ververst op de achtergrond en onthoudt of het laatste verzoek mislukte.
 */
export function useLoad<T>(key: string | null, fetcher: () => Promise<T>, opts: { persist?: boolean; maxAge?: number } = {}) {
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const wrapped = async () => {
    try {
      const data = await fetcher();
      setError((e) => (e?.key === key ? null : e));
      return data;
    } catch (e) {
      if (key) setError({ key, message: errorMessage(e) });
      throw e;
    }
  };
  const data = useCached<T>(key, wrapped, opts);
  /**
   * Opnieuw ophalen (een verzoek dat al loopt, wordt gedeeld). Geeft het resultaat, of undefined
   * als het mislukte; de fout staat dan in `error`.
   */
  const retry = (): Promise<T | undefined> =>
    key ? fetchCached(key, wrapped, opts.persist).catch(() => undefined) : Promise.resolve(undefined);
  return { data, error: error && error.key === key ? error.message : null, retry };
}

/**
 * Eerdere sets per persoon (voor "vorige keer", advies en records). Eén verzoek per persoon per
 * training; het resultaat blijft bewaard zodat het ook offline werkt.
 */
export function useHistories(workoutId: string, uids: string[], slugs: string[]): Record<string, HistRow[] | undefined> {
  const slugKey = [...new Set(slugs)].sort().join(",");
  const uidKey = [...new Set(uids)].sort().join(",");
  const [loaded, setLoaded] = useState<Record<string, HistRow[]>>({});

  useEffect(() => {
    if (!slugKey || !uidKey) return;
    let cancelled = false;
    for (const uid of uidKey.split(",")) {
      const key = `${histKey(workoutId, uid)}:${slugKey}`;
      fetchCached(key, () => fetchHistory(uid, slugKey.split(","), workoutId), true)
        .then((rows) => {
          if (!cancelled) setLoaded((s) => ({ ...s, [key]: rows }));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [workoutId, uidKey, slugKey]);

  return useMemo(() => {
    const out: Record<string, HistRow[] | undefined> = {};
    if (!slugKey) return out;
    for (const uid of uidKey ? uidKey.split(",") : []) {
      const key = `${histKey(workoutId, uid)}:${slugKey}`;
      // Eerst wat er net is opgehaald, anders de bewaarde versie (ook offline beschikbaar).
      out[uid] = loaded[key] ?? getCached<HistRow[]>(key);
    }
    return out;
  }, [loaded, workoutId, uidKey, slugKey]);
}
