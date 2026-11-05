"use client";

import { useMemo, useState } from "react";
import { alternativesFor } from "@/lib/analysis";
import { EXERCISES, EXERCISE_BY_SLUG } from "@/lib/exercises";
import type { Exercise } from "@/lib/exercise-types";
import type { Session } from "@/lib/history";
import { ExerciseFilter } from "../ExerciseFilter";
import { MuscleChips } from "../MuscleChips";
import { Sheet } from "../Sheet";
import { ExerciseInfoSheet, InfoButton } from "./ExerciseInfo";

/** Alternatieven voor een oefening (zelfde hoofdspier), bijv. als het apparaat bezet is. */
export function SwapSheet({
  slug,
  onClose,
  onPick,
  lastBySlug,
}: {
  /** Oefening die vervangen wordt; `null` = dicht. */
  slug: string | null;
  onClose: () => void;
  onPick: (e: Exercise) => void;
  lastBySlug?: Map<string, Session>;
}) {
  const [all, setAll] = useState(false);
  const [info, setInfo] = useState<Exercise | null>(null);
  const [prevSlug, setPrevSlug] = useState(slug);
  if (slug !== prevSlug) {
    setPrevSlug(slug);
    setAll(false);
    setInfo(null);
  }
  const current = slug ? EXERCISE_BY_SLUG[slug] : undefined;
  const alternatives = useMemo(() => (current ? alternativesFor(current) : []), [current]);
  const source = all || alternatives.length === 0 ? EXERCISES.filter((e) => e.slug !== current?.slug) : alternatives;

  return (
    <Sheet open={!!slug} onClose={onClose} title="Oefening wisselen">
      {current && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            In plaats van <span className="font-semibold text-ink">{current.name}</span>. Sets, reps en notitie blijven staan.
          </p>
          <div className="flex rounded-xl border border-line bg-surface-2 p-0.5 text-xs font-semibold" role="group" aria-label="Welke oefeningen">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                onClick={() => setAll(v)}
                aria-pressed={all === v}
                className={`min-h-11 flex-1 rounded-[10px] px-2.5 transition ${all === v ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
              >
                {v ? "Alle oefeningen" : `Zelfde spieren (${alternatives.length})`}
              </button>
            ))}
          </div>
          <ExerciseFilter key={String(all)} exercises={source} muscleFilters={all} placeholder="Zoek alternatief">
            {(list) => (
              <ul className="divide-y divide-line">
                {list.map((e) => (
                  <li key={e.slug} className="flex items-center gap-1" style={{ contentVisibility: "auto", containIntrinsicSize: "auto 68px" }}>
                    <button
                      onClick={() => onPick(e)}
                      className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left transition active:bg-surface-2"
                      aria-label={`Wissel naar ${e.name}`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="font-medium leading-tight">{e.name}</p>
                        <MuscleChips primary={e.primary} secondary={e.secondary} limit={4} />
                      </div>
                      <span className="flex h-9 shrink-0 items-center rounded-full bg-surface-2 px-3 text-xs font-semibold text-muted" aria-hidden>
                        Kies
                      </span>
                    </button>
                    <InfoButton label={`Uitleg over ${e.name}`} onClick={() => setInfo(e)} />
                  </li>
                ))}
              </ul>
            )}
          </ExerciseFilter>
        </div>
      )}
      <ExerciseInfoSheet
        exercise={info}
        onClose={() => setInfo(null)}
        last={info ? lastBySlug?.get(info.slug) : undefined}
        action={{
          label: "Kies deze",
          run: (e) => {
            setInfo(null);
            onPick(e);
          },
        }}
      />
    </Sheet>
  );
}
