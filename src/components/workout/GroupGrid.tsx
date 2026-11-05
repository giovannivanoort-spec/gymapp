"use client";

import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import type { GroupMember, WorkoutExercise } from "@/lib/types";
import { isDone, type LogRow } from "./logic";

type Cell = { done: number; planned: number };

/** Per persoon en oefening: hoeveel sets af zijn van hoeveel gepland (meer gelogd = meer gepland). */
function cellsFor(exercises: WorkoutExercise[], logs: LogRow[], uid: string): Cell[] {
  return exercises.map((we) => {
    let done = 0;
    let maxN = 0;
    for (const l of logs) {
      if (l.workout_exercise_id !== we.id || l.user_id !== uid || !isDone(l)) continue;
      done++;
      maxN = Math.max(maxN, l.set_number);
    }
    return { done, planned: Math.max(we.target_sets, maxN) };
  });
}

/**
 * Overzicht in groepsmodus: wie staat waar? Rijen zijn personen, kolommen oefeningen. Zo zie je in
 * één oogopslag wie achterloopt; tik op een vakje om naar die oefening en persoon te springen.
 */
export function GroupGrid({
  exercises,
  members,
  logs,
  userId,
  loading,
  onJump,
}: {
  exercises: WorkoutExercise[];
  members: GroupMember[];
  logs: LogRow[];
  userId: string;
  loading?: boolean;
  onJump: (we: WorkoutExercise, uid: string) => void;
}) {
  if (!exercises.length || members.length < 2) return null;
  if (loading) return <div className="skeleton h-28" aria-busy="true" aria-label="Overzicht laden" />;

  const rows = members.map((m) => {
    const cells = cellsFor(exercises, logs, m.user_id);
    const done = cells.reduce((s, c) => s + c.done, 0);
    const planned = cells.reduce((s, c) => s + c.planned, 0);
    return { m, cells, done, planned, pct: planned ? done / planned : 0 };
  });
  const minPct = Math.min(...rows.map((r) => r.pct));
  const maxPct = Math.max(...rows.map((r) => r.pct));

  return (
    <section className="card animate-fade-in space-y-2 p-3" aria-labelledby="group-grid-title">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 id="group-grid-title" className="text-sm font-bold">
          Overzicht groep
        </h2>
        <p className="text-xs text-muted">Tik om te springen</p>
      </div>
      <div className="-mx-3 overflow-x-auto px-3 [scrollbar-width:none]">
        <table className="w-max min-w-full border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th scope="col" className="sr-only">
                Persoon
              </th>
              {exercises.map((we, i) => (
                <th
                  key={we.id}
                  scope="col"
                  className="w-10 text-center font-medium text-muted"
                  title={EXERCISE_BY_SLUG[we.exercise_slug]?.name ?? we.exercise_slug}
                >
                  <span aria-hidden>{i + 1}</span>
                  <span className="sr-only">{EXERCISE_BY_SLUG[we.exercise_slug]?.name ?? we.exercise_slug}</span>
                </th>
              ))}
              <th scope="col" className="w-10 text-right font-medium text-muted">
                <span className="sr-only">Totaal</span>
                <span aria-hidden>%</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, cells, done, planned, pct }) => {
              const name = m.user_id === userId ? "Jij" : (m.profiles?.display_name ?? "Onbekend");
              // Alleen markeren als er echt verschil is tussen de personen.
              const behind = maxPct - minPct >= 0.15 && pct === minPct;
              return (
                <tr key={m.user_id}>
                  <th scope="row" className="max-w-24 pr-1 text-left font-semibold">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{name}</span>
                      {behind && (
                        <span className="shrink-0 rounded-full bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold text-warn">achter</span>
                      )}
                    </span>
                  </th>
                  {cells.map((c, i) => {
                    const we = exercises[i];
                    const full = c.planned > 0 && c.done >= c.planned;
                    const part = c.done > 0 && !full;
                    const exName = EXERCISE_BY_SLUG[we.exercise_slug]?.name ?? we.exercise_slug;
                    return (
                      <td key={we.id} className="p-0">
                        <button
                          type="button"
                          onClick={() => onJump(we, m.user_id)}
                          aria-label={`${name}, ${exName}: ${c.done} van ${c.planned} sets`}
                          className={`flex h-10 w-10 items-center justify-center rounded-lg font-semibold tabular-nums transition active:scale-95 ${
                            full
                              ? "bg-accent text-accent-ink"
                              : part
                                ? "bg-accent/20 text-ink ring-1 ring-inset ring-accent/40"
                                : "bg-surface-2 text-muted"
                          }`}
                        >
                          {c.done}/{c.planned}
                        </button>
                      </td>
                    );
                  })}
                  <td className="text-right tabular-nums text-muted">
                    <span className="sr-only">
                      {done} van {planned} sets,{" "}
                    </span>
                    {Math.round(pct * 100)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
