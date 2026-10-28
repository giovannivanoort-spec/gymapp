"use client";

import { useEffect, useMemo, useState } from "react";
import { aggregateRanks, rankExercise, type ExerciseRank, type LogLike, type Sex } from "./ranks";
import { supabase } from "./supabase";

type LogRow = { weight: number | null; reps: number | null; workout_exercises: { exercise_slug: string } };

/** Alle gelogde sets van één persoon, per oefening (in pagina's, want Supabase geeft max. 1000 rijen terug). */
export async function fetchLogsBySlug(userId: string, slugs?: string[]): Promise<Map<string, LogLike[]>> {
  const map = new Map<string, LogLike[]>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("set_logs")
      .select("weight, reps, workout_exercises!inner(exercise_slug)")
      .eq("user_id", userId)
      .not("reps", "is", null)
      .order("created_at")
      .range(from, from + PAGE - 1);
    if (slugs?.length) q = q.in("workout_exercises.exercise_slug", slugs);
    const { data, error } = await q;
    if (error || !data) break;
    for (const row of data as unknown as LogRow[]) {
      const slug = row.workout_exercises.exercise_slug;
      map.set(slug, [...(map.get(slug) ?? []), { weight: row.weight != null ? Number(row.weight) : null, reps: row.reps }]);
    }
    if (data.length < PAGE) break;
  }
  return map;
}

export function rankAll(logs: Map<string, LogLike[]>, bodyweight: number | null, sex: Sex | null, age?: number | null): ExerciseRank[] {
  return [...logs]
    .map(([slug, l]) => rankExercise(slug, l, bodyweight, sex, age))
    .filter((r): r is ExerciseRank => r !== null)
    .sort((a, b) => b.score - a.score);
}

/** Ranks van één persoon; `null` zolang er geladen wordt. */
export function useRanks(userId: string | null, bodyweight: number | null, sex: Sex | null, age?: number | null) {
  const [logs, setLogs] = useState<Map<string, LogLike[]> | null>(null);

  useEffect(() => {
    if (!userId) return;
    fetchLogsBySlug(userId).then(setLogs);
  }, [userId]);

  return useMemo(() => {
    if (!logs) return null;
    const ranks = rankAll(logs, bodyweight, sex, age);
    return { logs, ranks, ...aggregateRanks(ranks) };
  }, [logs, bodyweight, sex, age]);
}
