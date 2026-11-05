"use client";

import { useState } from "react";
import { focusLabel, type Analysis } from "@/lib/analysis";
import type { Exercise } from "@/lib/exercise-types";
import { GROUP_BY_ID, MUSCLE_BY_ID, REGION_COLOR, REGION_LABEL, type MuscleGroupId, type MuscleRegion } from "@/lib/muscles";
import { BodyMap, BodyMapLegend } from "./BodyMap";
import { CheckIcon, ChevronRightIcon, PlusIcon } from "./Icons";

const REGIONS: MuscleRegion[] = ["push", "pull", "legs", "core"];

export function MuscleAnalysis({
  analysis,
  onAdd,
  mode = "workout",
}: {
  analysis: Analysis;
  onAdd?: (exercise: Exercise) => void;
  /** Voor de kop: "deze training" of "dit schema". */
  mode?: "workout" | "template";
}) {
  const { loads, groups, regions, totalSets, focus, suggestions } = analysis;
  const [open, setOpen] = useState<MuscleGroupId | null>(null);
  const max = Math.max(4, ...loads.map((l) => l.sets));
  const trained = groups.filter((g) => g.sets > 0).sort((a, b) => b.sets - a.sets);
  const regionTotal = REGIONS.reduce((s, r) => s + regions[r], 0) || 1;
  const subject = mode === "template" ? "dit schema" : "deze training";

  if (totalSets === 0) {
    return (
      <div className="card text-sm text-muted">
        Voeg oefeningen toe om te zien welke spieren je in {subject} traint.
      </div>
    );
  }

  return (
    <section className="card space-y-5" aria-label={`Spieranalyse van ${subject}`}>
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="font-bold">Spieren in {subject}</h3>
          <span className="text-xs text-muted">{totalSets} sets</span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          {REGIONS.map((r) =>
            regions[r] > 0 ? (
              <div
                key={r}
                className="h-full transition-[width] duration-300"
                style={{ width: `${(regions[r] / regionTotal) * 100}%`, background: REGION_COLOR[r] }}
              />
            ) : null,
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {REGIONS.filter((r) => regions[r] > 0).map((r) => (
            <span key={r} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: REGION_COLOR[r] }} aria-hidden />
              {REGION_LABEL[r]} {Math.round((regions[r] / regionTotal) * 100)}%
            </span>
          ))}
        </div>
        {focus && <p className="mt-2 text-xs text-muted">{focusLabel(focus)}</p>}
      </div>

      <div className="space-y-2">
        <BodyMap intensity={Object.fromEntries(loads.map((l) => [l.id, l.sets / max]))} className="mx-auto w-full max-w-xs" />
        <BodyMapLegend heat />
      </div>

      <ul className="space-y-0.5">
        {trained.map((g) => {
          const isOpen = open === g.id;
          return (
            <li key={g.id}>
              <button
                onClick={() => setOpen(isOpen ? null : g.id)}
                className="-mx-2 grid min-h-11 w-[calc(100%+1rem)] grid-cols-[1rem_minmax(0,8.5rem)_1fr_2.25rem] items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors hover:bg-surface-2/60"
                aria-expanded={isOpen}
                aria-label={`${GROUP_BY_ID[g.id].name}: ${fmt(g.sets)} sets. ${isOpen ? "Verberg" : "Toon"} losse spieren`}
              >
                <ChevronRightIcon size={14} className={`text-muted transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
                <span className="truncate font-medium">{GROUP_BY_ID[g.id].name}</span>
                <Bar value={g.sets / max} />
                <span className="text-right text-xs tabular-nums text-muted">{fmt(g.sets)}</span>
              </button>
              {isOpen && (
                <ul className="animate-fade-in mb-2 ml-6 space-y-1.5 border-l border-line py-1 pl-3">
                  {g.muscles.map((m) => (
                    <li key={m.id} className="grid grid-cols-[minmax(0,7.5rem)_1fr_2.25rem] items-center gap-2 text-xs">
                      <span className={`truncate ${m.sets > 0 ? "" : "text-muted"}`} title={MUSCLE_BY_ID[m.id].name}>
                        {MUSCLE_BY_ID[m.id].short}
                      </span>
                      <Bar value={m.sets / max} thin />
                      <span className="text-right tabular-nums text-muted">{fmt(m.sets)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">
        Tik op een groep voor de losse spieren. Getal = effectieve sets; een spier die meehelpt telt als een halve set.
      </p>

      {suggestions.length > 0 ? (
        <div className="space-y-3 border-t border-line pt-4">
          <h3 className="font-bold">Tips om toe te voegen</h3>
          {suggestions.map((s, i) => (
            <div key={i} className="rounded-xl bg-surface-2 p-3">
              <p className="text-sm">
                <span className={`font-semibold ${s.kind === "volume" ? "text-warn" : "text-accent"}`}>{LABEL[s.kind]}</span>
                {s.text}
              </p>
              {s.exercises.length > 0 && onAdd && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.exercises.map((e) => (
                    <button
                      key={e.slug}
                      onClick={() => onAdd(e)}
                      aria-label={`${e.name} toevoegen`}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-xs font-medium transition hover:border-accent hover:text-accent active:scale-95"
                    >
                      <PlusIcon size={14} /> {e.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="flex items-center gap-2 border-t border-line pt-4 text-sm text-accent">
          <CheckIcon size={16} /> Mooi gebalanceerd.
        </p>
      )}
    </section>
  );
}

/** Volume-balk: altijd in het accent, net als de hoofdspieren op de spierkaart. */
function Bar({ value, thin }: { value: number; thin?: boolean }) {
  return (
    <div className={`${thin ? "h-1.5" : "h-2"} overflow-hidden rounded-full bg-surface-2`} aria-hidden>
      <div
        className={`h-full rounded-full bg-accent transition-[width] duration-300 ${thin ? "opacity-70" : ""}`}
        style={{ width: `${Math.min(100, value * 100)}%` }}
      />
    </div>
  );
}

const LABEL = {
  missing: "Mist: ",
  detail: "Detail: ",
  balance: "Balans: ",
  volume: "Let op: ",
};

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
