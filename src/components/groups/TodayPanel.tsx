"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { CheckIcon, ChevronRightIcon } from "@/components/Icons";
import { fetchCached, invalidate, useCached } from "@/lib/cache";
import { timeAgo } from "@/lib/dates";
import { supabase } from "@/lib/supabase";
import type { GroupMember } from "@/lib/types";
import { memberName, type GroupWorkout } from "./groupData";
import { useMinuteTick } from "./useMinuteTick";

type TodayLive = {
  /** Oefeningen van de training met het geplande aantal sets. */
  exercises: { id: string; target: number }[];
  /** Gelogde sets (alleen met reps). */
  logs: { id: string; user_id: string; workout_exercise_id: string; created_at: string }[];
};

const todayKey = (workoutId: string) => `group-today:${workoutId}`;

async function fetchTodayLive(workoutId: string): Promise<TodayLive> {
  const [ex, logs] = await Promise.all([
    supabase.from("workout_exercises").select("id, target_sets").eq("workout_id", workoutId),
    supabase
      .from("set_logs")
      .select("id, user_id, workout_exercise_id, created_at, workout_exercises!inner(workout_id)")
      .eq("workout_exercises.workout_id", workoutId)
      .gt("reps", 0),
  ]);
  if (ex.error) throw ex.error;
  if (logs.error) throw logs.error;
  return {
    exercises: (ex.data ?? []).map((e) => ({ id: e.id as string, target: Math.max(1, Number(e.target_sets) || 1) })),
    logs: (logs.data ?? []).map((l) => ({
      id: l.id as string,
      user_id: l.user_id as string,
      workout_exercise_id: l.workout_exercise_id as string,
      created_at: l.created_at as string,
    })),
  };
}

type Progress = { done: number; planned: number; exercisesDone: number; last: string | null; finished: boolean };

function progressOf(live: TodayLive, uid: string): Progress {
  const perExercise = new Map<string, number>();
  let last: string | null = null;
  for (const l of live.logs) {
    if (l.user_id !== uid) continue;
    perExercise.set(l.workout_exercise_id, (perExercise.get(l.workout_exercise_id) ?? 0) + 1);
    if (!last || l.created_at > last) last = l.created_at;
  }
  let done = 0;
  let planned = 0;
  let exercisesDone = 0;
  for (const e of live.exercises) {
    const n = perExercise.get(e.id) ?? 0;
    planned += e.target;
    // Extra sets tellen niet boven het plan uit, zodat de balk echt "hoe ver" laat zien.
    done += Math.min(n, e.target);
    if (n >= e.target) exercisesDone++;
  }
  return { done, planned, exercisesDone, last, finished: planned > 0 && done >= planned };
}

/**
 * Live overzicht van de training van vandaag: per lid hoe ver diegene is. Handig als trainer
 * die meerdere vrienden tegelijk traint: je ziet in één oogopslag wie achterloopt.
 */
export function TodayPanel({
  workout,
  members,
  userId,
  isTrainer = false,
}: {
  workout: GroupWorkout;
  members: GroupMember[];
  userId: string;
  /** Trainers krijgen de tip dat een naam de training op die persoon opent. */
  isTrainer?: boolean;
}) {
  const key = todayKey(workout.id);
  const [failed, setFailed] = useState(false);
  const fetcher = useCallback(
    () =>
      fetchTodayLive(workout.id).then(
        (d) => {
          setFailed(false);
          return d;
        },
        (e: unknown) => {
          setFailed(true);
          throw e;
        },
      ),
    [workout.id],
  );
  const live = useCached(key, fetcher, { maxAge: 10_000 });
  useMinuteTick();

  // Ids van de getoonde sets: een DELETE (niet te filteren) telt alleen als het één daarvan is.
  const shownIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    shownIds.current = live ? new Set(live.logs.map((l) => l.id)) : null;
  }, [live]);

  // Live: verversen zodra er in deze training een set gelogd of gewist wordt (even bundelen).
  const exerciseIds = live?.exercises.map((e) => e.id).join(",") ?? "";
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => invalidate(key), 500);
    };
    const filter = exerciseIds && exerciseIds.split(",").length <= 100 ? `workout_exercise_id=in.(${exerciseIds})` : undefined;
    const channel = supabase
      .channel(`group-today-${workout.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "set_logs", ...(filter ? { filter } : {}) }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "set_logs", ...(filter ? { filter } : {}) }, refresh)
      // DELETE kan niet gefilterd worden (alleen de primary key komt mee): zelf controleren.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "set_logs" }, (payload) => {
        const removed = (payload.old as { id?: string } | null)?.id;
        const known = shownIds.current;
        if (!removed || !known || known.has(removed)) refresh();
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [workout.id, key, exerciseIds]);

  const rows = useMemo(
    () => (live ? members.map((m) => ({ member: m, p: progressOf(live, m.user_id) })) : []),
    [live, members],
  );
  const started = rows.filter((r) => r.p.done > 0).length;
  const finished = rows.filter((r) => r.p.finished).length;

  return (
    <section
      aria-labelledby={`today-${workout.id}`}
      className="animate-fade-up relative overflow-hidden rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/15 via-accent/5 to-transparent"
    >
      <Link href={`/workouts/${workout.id}`} className="flex items-center gap-3 px-4 pb-2 pt-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            Vandaag live
          </p>
          <h3 id={`today-${workout.id}`} className="mt-1 truncate text-lg font-bold">
            {workout.title}
          </h3>
          <p className="text-xs text-muted">
            {live
              ? started === 0
                ? "Nog niemand begonnen"
                : `${started} van ${members.length} bezig${finished ? ` · ${finished} klaar` : ""}`
              : failed
                ? "Voortgang niet geladen"
                : "Voortgang laden…"}
          </p>
        </div>
        <span className="btn-primary pointer-events-none min-h-10 px-3 text-xs">
          Open
          <ChevronRightIcon size={14} />
        </span>
      </Link>

      {!live ? (
        failed ? (
          <div className="px-4 pb-4">
            <button className="btn-ghost min-h-11 w-full" onClick={() => fetchCached(key, fetcher).catch(() => {})}>
              Opnieuw proberen
            </button>
          </div>
        ) : (
          <div className="space-y-2 px-4 pb-4" aria-busy aria-label="Voortgang laden">
            {members.slice(0, 4).map((m) => (
              <div key={m.user_id} className="flex items-center gap-3 py-1">
                <div className="skeleton h-8 w-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="skeleton h-3 w-1/3" />
                  <div className="skeleton h-1.5 w-full rounded-full" />
                </div>
              </div>
            ))}
          </div>
        )
      ) : live.exercises.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">Deze training heeft nog geen oefeningen.</p>
      ) : (
        <ul className="px-2 pb-2" aria-label="Voortgang per lid">
          {rows.map(({ member: m, p }) => {
            const name = memberName(m);
            const pct = p.planned ? Math.round((p.done / p.planned) * 100) : 0;
            const status = p.finished
              ? "Klaar"
              : p.done > 0
                ? `Bezig${p.last ? ` · laatste set ${timeAgo(p.last)}` : ""}`
                : "Nog niet begonnen";
            return (
              <li key={m.user_id}>
                <Link
                  // Trainer tikt op een vriend: de training opent meteen op diegene, klaar om te loggen.
                  href={m.user_id === userId ? `/workouts/${workout.id}` : `/workouts/${workout.id}?lid=${m.user_id}`}
                  className="flex min-h-12 items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-surface-2/60 active:scale-[0.99]"
                  aria-label={`${name}: ${p.done} van ${p.planned} sets, ${status.toLowerCase()}${
                    isTrainer && m.user_id !== userId ? `. Open om voor ${name} te loggen` : ""
                  }`}
                >
                  <span className="relative shrink-0">
                    <Avatar id={m.user_id} name={name} src={m.profiles?.avatar_url} size={32} />
                    {p.finished && (
                      <span className="animate-pop absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-ink ring-2 ring-surface">
                        <CheckIcon size={10} strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">
                        {name}
                        {m.user_id === userId && <span className="font-normal text-muted"> (jij)</span>}
                      </p>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">
                        {p.done}/{p.planned} sets
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                      <div
                        className={`h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none ${
                          p.finished ? "bg-accent" : p.done > 0 ? "bg-accent/70" : "bg-transparent"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className={`mt-1 truncate text-[11px] ${p.finished ? "font-semibold text-accent" : "text-muted"}`}>{status}</p>
                  </div>
                </Link>
              </li>
            );
          })}
          {isTrainer && members.length > 1 && (
            <li className="px-2 pb-1 pt-1 text-[11px] text-muted">Tik op een naam om de training voor diegene te openen.</li>
          )}
        </ul>
      )}
    </section>
  );
}
