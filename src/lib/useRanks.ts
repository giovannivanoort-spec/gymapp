"use client";

import { useMemo } from "react";
import type { HistorySet } from "./history";
import { useHistoryState } from "./history";
import { aggregateRanks, rankExercise, type ExerciseRank, type GroupRank, type LogLike, type OverallRank, type Sex } from "./ranks";
import { supabase } from "./supabase";

type LogRow = { weight: number | null; reps: number | null; workout_exercises: { exercise_slug: string } };

/**
 * Alle gelogde sets van één persoon, per oefening (in pagina's, want Supabase geeft max. 1000 rijen terug).
 * Gooit een fout als één van de pagina's mislukt: een half resultaat zou iemand ten onrechte
 * lagere ranks geven (en in de cache terechtkomen).
 */
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
      // Vaste volgorde bij gelijke tijdstippen, zodat er over paginagrenzen niets dubbel gaat of wegvalt.
      .order("id")
      .range(from, from + PAGE - 1);
    if (slugs?.length) q = q.in("workout_exercises.exercise_slug", slugs);
    const { data, error } = await q;
    if (error) throw error;
    if (!data) break;
    for (const row of data as unknown as LogRow[]) {
      const slug = row.workout_exercises.exercise_slug;
      let list = map.get(slug);
      if (!list) map.set(slug, (list = []));
      list.push({ weight: row.weight != null ? Number(row.weight) : null, reps: row.reps });
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

export type RanksData = {
  logs: Map<string, LogLike[]>;
  ranks: ExerciseRank[];
  groups: GroupRank[];
  overall: OverallRank | null;
  /** De onderliggende trainingsgeschiedenis (bijv. voor de rang-tijdlijn). */
  history: HistorySet[];
};

/**
 * Eén berekening per (geschiedenis, gewicht, geslacht, leeftijd), gedeeld door alle componenten die
 * dezelfde ranks tonen (Progressie, Ranks, Oefeningen, vriendkaarten). De cache hangt aan het
 * geschiedenis-array zelf: een nieuwe stand uit de cache is een nieuw array, en het oude valt
 * vanzelf weg (WeakMap).
 */
const memo = new WeakMap<HistorySet[], Map<string, RanksData>>();

export function computeRanks(history: HistorySet[], bodyweight: number | null, sex: Sex | null, age?: number | null): RanksData {
  const key = `${bodyweight ?? ""}|${sex ?? ""}|${age ?? ""}`;
  let byParams = memo.get(history);
  if (!byParams) memo.set(history, (byParams = new Map()));
  const hit = byParams.get(key);
  if (hit) return hit;
  const result = computeRanksUncached(history, bodyweight, sex, age);
  byParams.set(key, result);
  return result;
}

function computeRanksUncached(history: HistorySet[], bodyweight: number | null, sex: Sex | null, age?: number | null): RanksData {
  const logs = new Map<string, LogLike[]>();
  for (const s of history) {
    let list = logs.get(s.slug);
    if (!list) logs.set(s.slug, (list = []));
    list.push({ weight: s.weight, reps: s.reps });
  }
  const ranks = rankAll(logs, bodyweight, sex, age);
  return { logs, ranks, history, ...aggregateRanks(ranks) };
}

/**
 * Ranks van één persoon; `null` zolang er geladen wordt. Gebruikt de gedeelde (gecachete)
 * trainingsgeschiedenis, zodat Home, Profiel, Oefeningen en Ranks niet elk opnieuw laden.
 */
export function useRanks(userId: string | null, bodyweight: number | null, sex: Sex | null, age?: number | null): RanksData | null {
  return useRanksState(userId, bodyweight, sex, age).data;
}

export type RanksState = {
  status: "idle" | "loading" | "error" | "ready";
  /** null zolang er (nog) niets geladen is. */
  data: RanksData | null;
  /** Fout van de laatste poging (ook als er oudere data is). */
  error: unknown;
  /** Bezig met (opnieuw) ophalen. */
  refreshing: boolean;
  /** Direct opnieuw proberen. */
  retry: () => void;
  /** Wanneer de onderliggende geschiedenis is opgehaald (ms), of null. */
  updatedAt: number | null;
};

/**
 * Als useRanks, maar met laad- en foutstatus: bij een mislukte eerste fetch krijg je
 * `status: "error"` (voor een foutkaart met "Opnieuw") in plaats van eindeloos laden.
 * `userId = null` geeft `status: "idle"`.
 */
export function useRanksState(userId: string | null, bodyweight: number | null, sex: Sex | null, age?: number | null): RanksState {
  const { data: history, error, refreshing, retry, updatedAt } = useHistoryState(userId);
  const data = useMemo(() => (history ? computeRanks(history, bodyweight, sex, age) : null), [history, bodyweight, sex, age]);
  const status: RanksState["status"] = !userId ? "idle" : data ? "ready" : error ? "error" : "loading";
  return { status, data, error, refreshing, retry, updatedAt };
}
