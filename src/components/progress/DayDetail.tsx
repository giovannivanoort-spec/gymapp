"use client";

import Link from "next/link";
import { ChevronRightIcon } from "@/components/Icons";
import { formatDate, toISODate } from "@/lib/dates";
import { isTimed } from "@/lib/exercises";
import { nl, type HistorySet, type Session } from "@/lib/history";
import { exerciseName, isWeighted, sessionRecords } from "@/lib/progress/records";
import { estimate1RM } from "@/lib/ranks";

export type PlannedWorkout = { id: string; date: string; title: string; group: string | null };

/** Resultaten van één dag, per training en oefening, met records gemarkeerd. */
export function DayDetail({
  day,
  history,
  sessions,
  planned,
}: {
  day: string;
  history: HistorySet[];
  sessions: Map<string, Session[]>;
  /** Geplande groepstrainingen op deze dag. */
  planned: PlannedWorkout[];
}) {
  // Zelfde regel als de kalender en de maandcijfers: alleen sets met reps tellen.
  const sets = history.filter((s) => s.date === day && (s.reps ?? 0) > 0);
  const workouts = [...new Set(sets.map((s) => s.workoutId))];
  const isFuture = day > toISODate();
  const openPlans = planned.filter((p) => !workouts.includes(p.id));

  return (
    <>
      {/* Alleen een korte samenvatting aankondigen, niet alle tabellen van de dag. */}
      <p className="sr-only" aria-live="polite">
        {`${formatDate(day)}: ${
          sets.length
            ? `${workouts.length} ${workouts.length === 1 ? "training" : "trainingen"}, ${sets.length} ${sets.length === 1 ? "set" : "sets"}`
            : openPlans.length
              ? `${openPlans.length} gepland`
              : "geen training"
        }`}
      </p>
      <section key={day} className="animate-fade-up space-y-3" aria-labelledby="day-detail-heading">
        <h2 id="day-detail-heading" className="text-sm font-semibold uppercase tracking-wide text-muted">
          {formatDate(day)}
        </h2>
        {sets.length === 0 && openPlans.length === 0 && (
          <div className="card text-sm text-muted">{isFuture ? "Nog niets gepland op deze dag." : "Geen training op deze dag."}</div>
        )}

        {openPlans.map((p) => (
          <Link
            key={p.id}
            href={`/workouts/${p.id}`}
            className="card flex items-center justify-between gap-3 border-dashed hover:border-muted"
          >
            <div className="min-w-0">
              <p className="truncate font-bold">{p.title}</p>
              <p className="text-xs text-muted">
                {p.group ? `${p.group} · ` : ""}
                {isFuture || day === toISODate() ? "Gepland" : "Gepland, maar je hebt niets gelogd"}
              </p>
            </div>
            <ChevronRightIcon className="shrink-0 text-muted" />
          </Link>
        ))}

        {workouts.map((wid) => {
          const ws = sets.filter((s) => s.workoutId === wid);
          const byExercise = [...new Set(ws.map((s) => s.workoutExerciseId))]
            .map((weId) => ws.filter((s) => s.workoutExerciseId === weId).sort((a, b) => a.setNumber - b.setNumber))
            .sort((a, b) => a[0].position - b[0].position);
          return (
            <div key={wid} className="card space-y-4">
              <Link href={`/workouts/${wid}`} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold">{ws[0].workoutTitle}</p>
                  <p className="text-xs text-muted">
                    {ws[0].groupName ? `${ws[0].groupName} · ` : ""}
                    {ws.length} {ws.length === 1 ? "set" : "sets"}
                  </p>
                </div>
                <ChevronRightIcon className="shrink-0 text-muted" />
              </Link>
              {byExercise.map((exSets) => {
                const slug = exSets[0].slug;
                // Zelfde regels als "Recente records" en de maandcijfers (sessionRecords): een hogere
                // geschatte 1RM (zonder gewicht: meer reps), anders een rep-record. De eerste keer dat je
                // een oefening doet is geen record. Alleen de set die het record zette krijgt het label.
                const all = sessions.get(slug) ?? [];
                const weighted = isWeighted(all);
                const weId = exSets[0].workoutExerciseId;
                const sessionIndex = all.findIndex((s) => s.sets[0]?.workoutExerciseId === weId);
                const record = sessionIndex >= 0 ? sessionRecords(slug, all, weighted)[sessionIndex] : null;
                const prIndex = record ? exSets.findIndex((s) => s.setNumber === record.set.setNumber) : -1;
                const scores = exSets.map((s) => estimate1RM(s.weight ?? 0, s.reps ?? 0));
                return (
                  <div key={exSets[0].workoutExerciseId} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link href={`/exercises/${slug}`} className="min-w-0 truncate text-sm font-semibold hover:text-accent">
                        {exerciseName(slug)}
                      </Link>
                      <span className="shrink-0 text-xs text-muted">
                        doel {exSets[0].targetSets} × {exSets[0].targetReps}
                      </span>
                    </div>
                    <table className="w-full text-sm tabular-nums">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                          <th className="w-10 py-1 font-medium">Set</th>
                          <th className="py-1 font-medium">Kg</th>
                          <th className="py-1 font-medium">{isTimed(slug) ? "Sec" : "Reps"}</th>
                          <th className="py-1 text-right font-medium">{weighted ? "1RM" : <span className="sr-only">Record</span>}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {exSets.map((s, i) => {
                          const e = scores[i];
                          return (
                            <tr key={s.setNumber} className="border-t border-line">
                              <td className="py-1.5 text-muted">{s.setNumber}</td>
                              <td className="py-1.5">{s.weight != null ? nl(s.weight) : "–"}</td>
                              <td className="py-1.5">{s.reps ?? "–"}</td>
                              <td className="py-1.5 text-right">
                                {i === prIndex && record && (
                                  <span
                                    className="mr-2 rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent"
                                    title={
                                      record.kind === "rep"
                                        ? `Nieuw ${record.reps}RM-record: ${record.added ? "meeste extra gewicht" : "zwaarste gewicht"} voor minstens ${record.reps} reps`
                                        : weighted
                                          ? "Nieuw record (geschatte 1RM)"
                                          : isTimed(slug)
                                            ? "Nieuw record (seconden)"
                                            : "Nieuw record (reps)"
                                    }
                                  >
                                    {record.kind === "rep" ? `${record.reps}RM` : "PR"}
                                  </span>
                                )}
                                {e != null ? nl(e) : weighted ? <span className="text-muted">–</span> : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          );
        })}
      </section>
    </>
  );
}
