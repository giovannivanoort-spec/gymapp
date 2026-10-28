"use client";

import { estimate1RM } from "./ranks";
import { supabase } from "./supabase";

/** Eén gelogde set met de training en oefening waar hij bij hoort. */
export type HistorySet = {
  date: string;
  workoutId: string;
  workoutTitle: string;
  groupName: string | null;
  workoutExerciseId: string;
  slug: string;
  position: number;
  targetSets: number;
  targetReps: string;
  setNumber: number;
  weight: number | null;
  reps: number | null;
};

type Row = {
  set_number: number;
  weight: number | null;
  reps: number | null;
  workout_exercise_id: string;
  workout_exercises: {
    exercise_slug: string;
    position: number;
    target_sets: number;
    target_reps: string;
    workout_id: string;
    workouts: { date: string; title: string; groups: { name: string } | null };
  };
};

/** Alle gelogde sets van één persoon (in pagina's, Supabase geeft max. 1000 rijen terug). */
export async function fetchHistory(userId: string): Promise<HistorySet[]> {
  const out: HistorySet[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("set_logs")
      .select(
        "set_number, weight, reps, workout_exercise_id, workout_exercises!inner(exercise_slug, position, target_sets, target_reps, workout_id, workouts!inner(date, title, groups(name)))",
      )
      .eq("user_id", userId)
      .not("reps", "is", null)
      .order("created_at")
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const r of data as unknown as Row[]) {
      const we = r.workout_exercises;
      out.push({
        date: we.workouts.date,
        workoutId: we.workout_id,
        workoutTitle: we.workouts.title,
        groupName: we.workouts.groups?.name ?? null,
        workoutExerciseId: r.workout_exercise_id,
        slug: we.exercise_slug,
        position: we.position,
        targetSets: we.target_sets,
        targetReps: we.target_reps,
        setNumber: r.set_number,
        weight: r.weight != null ? Number(r.weight) : null,
        reps: r.reps,
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

/** Samenvatting van één oefening in één training. */
export type Session = {
  date: string;
  workoutId: string;
  workoutTitle: string;
  sets: HistorySet[];
  /** Beste geschatte 1RM (kg), of null als er geen gewicht/geldige reps zijn. */
  best1RM: number | null;
  /** Set met de hoogste geschatte 1RM, anders de set met de meeste reps. */
  bestSet: HistorySet;
  maxReps: number;
  /** Totaal kg × reps. */
  volume: number;
};

/** Per oefening: sessies op datum (oud → nieuw). */
export function sessionsBySlug(history: HistorySet[]): Map<string, Session[]> {
  const byWe = new Map<string, HistorySet[]>();
  for (const s of history) byWe.set(s.workoutExerciseId, [...(byWe.get(s.workoutExerciseId) ?? []), s]);

  const bySlug = new Map<string, Session[]>();
  for (const sets of byWe.values()) {
    sets.sort((a, b) => a.setNumber - b.setNumber);
    const scored = sets.map((s) => ({ s, e: estimate1RM(s.weight ?? 0, s.reps ?? 0) }));
    const withE = scored.filter((x) => x.e != null);
    const best = withE.length ? withE.reduce((a, b) => (b.e! > a.e! ? b : a)) : null;
    const session: Session = {
      date: sets[0].date,
      workoutId: sets[0].workoutId,
      workoutTitle: sets[0].workoutTitle,
      sets,
      best1RM: best ? Math.round(best.e! * 10) / 10 : null,
      bestSet: best?.s ?? sets.reduce((a, b) => ((b.reps ?? 0) > (a.reps ?? 0) ? b : a)),
      maxReps: Math.max(...sets.map((s) => s.reps ?? 0)),
      volume: sets.reduce((v, s) => v + (s.weight ?? 0) * (s.reps ?? 0), 0),
    };
    const slug = sets[0].slug;
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), session]);
  }
  for (const list of bySlug.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return bySlug;
}

export function formatSet(s: { weight: number | null; reps: number | null }): string {
  const w = s.weight ? `${s.weight.toLocaleString("nl-NL")} kg × ` : "";
  return `${w}${s.reps ?? "–"}${s.weight ? "" : " reps"}`;
}

export const nl = (n: number, digits = 1) => n.toLocaleString("nl-NL", { maximumFractionDigits: digits });
