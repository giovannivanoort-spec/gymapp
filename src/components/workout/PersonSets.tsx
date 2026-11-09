"use client";

import { useMemo, useState } from "react";
import { ArrowUpIcon, CheckIcon, PlusIcon, TrophyIcon } from "@/components/Icons";
import { formatDate } from "@/lib/dates";
import type { Exercise } from "@/lib/exercise-types";
import { suggestNext } from "@/lib/progression";
import type { WorkoutExercise } from "@/lib/types";
import { beats, bestOf, describeBest, fmtSet, isDone, type Best, type LogRow, type PrevSession } from "./logic";
import { SET_GRID, SET_GRID_PREV, SetRow, type SaveResult } from "./SetRow";

export type FillSet = { n: number; weight: number | null; reps: number };

/** Id van een setrij in de pagina (om er vanuit een melding naartoe te springen). */
export const setAnchorId = (wex: string, uid: string, n: number) => `set-${wex}-${uid}-${n}`;

/** Alle sets van één persoon voor één oefening, met advies, record en snelle acties. */
export function PersonSets({
  we,
  ex,
  uid,
  name,
  logs,
  prev,
  best,
  compact,
  readOnly,
  plateWeight,
  onSave,
  onDelete,
  onUncomplete,
  onFill,
  onCompleted,
}: {
  we: WorkoutExercise;
  ex?: Exercise;
  /** Voor wie deze sets zijn (voor het id van elke set, om ernaartoe te springen). */
  uid?: string;
  /** Naam boven de sets (groepsmodus); leeg in de gewone weergave. */
  name?: string;
  logs: LogRow[];
  prev?: PrevSession;
  /** Beste prestatie ooit (andere trainingen), of null als die er niet is. */
  best: Best | null;
  compact?: boolean;
  readOnly?: boolean;
  plateWeight: number | null;
  onSave: (n: number, weight: string, reps: string) => Promise<SaveResult>;
  onDelete: (n: number, log: LogRow) => void;
  /** Afvinken ongedaan maken zonder de getallen te wissen. */
  onUncomplete?: (n: number, log: LogRow) => void;
  onFill: (sets: FillSet[]) => void;
  /** Set n is bewust afgerond en opgeslagen (voor om de beurt trainen); `startedAt` zoals in SetRow. */
  onCompleted?: (n: number, startedAt: number) => void;
}) {
  // Gewenst aantal rijen na "+ Set" (een gelogde extra set geeft dus niet vanzelf nog een lege rij).
  const [wanted, setWanted] = useState(0);
  const exerciseName = ex?.name ?? we.exercise_slug;
  const perHand = ex?.equipment === "dumbbell" || ex?.equipment === "kettlebell";
  const weightLabel = perHand ? "Kg p/db" : ex?.equipment === "bodyweight" ? "+Kg" : "Kg";

  const byN = useMemo(() => new Map(logs.map((l) => [l.set_number, l])), [logs]);
  const maxLogged = logs.reduce((m, l) => Math.max(m, l.set_number), 0);
  const baseRows = Math.max(we.target_sets, maxLogged);
  const rows = Math.max(baseRows, wanted);
  const done = logs.filter(isDone);
  const suggestion = ex && prev ? suggestNext(prev.sets, we.target_reps, we.target_sets, ex.equipment, { timed: !!ex.timed }) : null;

  // Record-markering: de beste set van vandaag, als die je oude record verslaat.
  const sessionBest = bestOf(done, we.exercise_slug)?.set ?? null;

  function hintFor(n: number) {
    const adv = suggestion?.perSet[n - 1] ?? suggestion?.perSet.at(-1);
    const prevSame = prev?.sets.find((p) => p.set_number === n) ?? prev?.sets.at(-1);
    const before = byN.get(n - 1);
    // Zelfde gewicht als je vorige set vandaag: dat is meestal je werkgewicht.
    const lastDone = before && isDone(before) ? before : undefined;
    return {
      weight: plateWeight ?? lastDone?.weight ?? adv?.weight ?? prevSame?.weight ?? null,
      reps: adv?.reps ?? prevSame?.reps ?? lastDone?.reps ?? null,
    };
  }

  const fillable: FillSet[] = [];
  for (let n = 1; n <= baseRows; n++) {
    const log = byN.get(n);
    if (isDone(log)) continue;
    const h = hintFor(n);
    // Een al ingevuld gewicht (zonder reps) gaat voor de voorinvulling.
    if (h.reps != null && h.reps > 0) fillable.push({ n, weight: log?.weight ?? h.weight, reps: h.reps });
  }
  const lastRowEmpty = rows > baseRows && !byN.get(rows);
  const bestText = describeBest(best, we.exercise_slug);
  // Kolom "Vorige" per set (niet in de compacte groepsweergave: daar staat het in één regel).
  const showPrev = !compact && !!prev?.sets.some((p) => p.reps != null || p.weight != null);
  const prevByN = new Map(prev?.sets.map((p) => [p.set_number, p]) ?? []);

  return (
    <div className="space-y-2">
      {name && (
        <div className="flex items-baseline justify-between gap-2 pt-1">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className={`shrink-0 text-xs tabular-nums ${done.length >= we.target_sets ? "text-accent" : "text-muted"}`}>
            {done.length}/{baseRows} sets
          </p>
        </div>
      )}

      {compact
        ? (suggestion || prev) && (
            <p className="text-xs text-muted">
              {suggestion ? (
                <>
                  <span className="font-medium text-accent">Advies: {suggestion.headline}</span>
                  {prev && <span> · vorige keer {prev.sets.map((s) => fmtSet(s, we.exercise_slug)).join(", ")}</span>}
                </>
              ) : (
                prev && <>Vorige keer: {prev.sets.map((s) => fmtSet(s, we.exercise_slug)).join(", ")}</>
              )}
            </p>
          )
        : (prev || bestText) && (
            <div className="space-y-2 rounded-xl bg-surface-2 px-3 py-2.5">
              {prev && (
                <p className="text-xs text-muted">
                  Vorige keer ({formatDate(prev.date, { weekday: undefined, month: "short" })}):{" "}
                  <span className="text-ink">{prev.sets.map((s) => fmtSet(s, we.exercise_slug)).join(" · ")}</span>
                </p>
              )}
              {suggestion && !readOnly && (
                <div className="flex items-start gap-2 border-t border-line pt-2">
                  <ArrowUpIcon size={14} className="mt-0.5 shrink-0 text-accent" />
                  <p className="text-xs">
                    <span className="font-semibold text-accent">Advies vandaag: {suggestion.headline}</span>
                    <span className="block text-muted">{suggestion.reason}</span>
                  </p>
                </div>
              )}
              {bestText && (
                <div className="flex items-center gap-2 border-t border-line pt-2 text-xs">
                  <TrophyIcon size={14} className="shrink-0 text-muted" />
                  <p className="text-muted">
                    Record: <span className="text-ink">{bestText}</span>
                  </p>
                </div>
              )}
            </div>
          )}

      <div className="space-y-1.5">
        <div className={`${showPrev ? SET_GRID_PREV : SET_GRID} px-0 text-[11px] font-medium uppercase tracking-wide text-muted`} aria-hidden>
          <span className="text-center">Set</span>
          {showPrev && <span className="text-center">Vorige</span>}
          <span className="text-center" title={perHand ? "Gewicht per dumbbell" : ex?.equipment === "bodyweight" ? "Extra gewicht" : undefined}>
            {weightLabel}
          </span>
          <span className="text-center" title={ex?.timed ? "Seconden" : undefined}>
            {ex?.timed ? "Sec" : "Reps"}
          </span>
          <span />
        </div>
        {Array.from({ length: rows }, (_, i) => i + 1).map((n) => {
          const log = byN.get(n);
          return (
            <SetRow
              key={n}
              setNumber={n}
              log={log}
              hint={hintFor(n)}
              prev={prevByN.get(n) ?? null}
              showPrev={showPrev}
              anchorId={uid ? setAnchorId(we.id, uid, n) : undefined}
              exerciseName={exerciseName}
              personName={name}
              isRecord={!!log && log === sessionBest && beats(log, best)}
              readOnly={readOnly}
              timed={!!ex?.timed}
              onSave={(w, r) => onSave(n, w, r)}
              onDelete={() => log && onDelete(n, log)}
              onUncomplete={onUncomplete ? () => log && onUncomplete(n, log) : undefined}
              onCompleted={onCompleted ? (startedAt) => onCompleted(n, startedAt) : undefined}
            />
          );
        })}
      </div>

      {!readOnly && (
        <div className="flex gap-2">
          <button
            className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-sm text-muted transition hover:text-ink active:scale-[0.98]"
            onClick={() => setWanted(rows + 1)}
          >
            <PlusIcon size={15} /> Set
          </button>
          {lastRowEmpty && (
            <button
              className="inline-flex h-10 items-center justify-center rounded-xl border border-dashed border-line px-3 text-sm text-muted transition hover:text-ink active:scale-[0.98]"
              onClick={() => setWanted(rows - 1)}
              aria-label={`Lege set ${rows} weghalen`}
            >
              Weghalen
            </button>
          )}
          {fillable.length > 0 && (
            <button
              className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface-2 px-2 text-sm font-medium text-ink transition hover:border-muted active:scale-[0.98]"
              onClick={() => onFill(fillable)}
              title="Rondt de open sets af met het gewicht en de reps die als voorinvulling staan"
            >
              <CheckIcon size={15} className="text-accent" />
              {done.length === 0 ? "Alles afronden" : `Rest afronden (${fillable.length})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
