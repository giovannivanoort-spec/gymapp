"use client";

import { useState } from "react";
import { focusLabel, type Analysis } from "@/lib/analysis";
import type { Exercise } from "@/lib/exercise-types";
import { GROUP_BY_ID, MUSCLE_BY_ID, REGION_LABEL, type MuscleGroupId, type MuscleRegion } from "@/lib/muscles";
import { BodyMap } from "./BodyMap";
import { CheckIcon, ChevronRightIcon } from "./Icons";

const REGIONS: MuscleRegion[] = ["push", "pull", "legs", "core"];

export function MuscleAnalysis({
  analysis,
  onAdd,
}: {
  analysis: Analysis;
  onAdd?: (exercise: Exercise) => void;
}) {
  const { loads, groups, regions, totalSets, focus, suggestions } = analysis;
  const [open, setOpen] = useState<MuscleGroupId | null>(null);
  const max = Math.max(4, ...loads.map((l) => l.sets));
  const trained = groups.filter((g) => g.sets > 0).sort((a, b) => b.sets - a.sets);
  const regionTotal = REGIONS.reduce((s, r) => s + regions[r], 0) || 1;

  if (totalSets === 0) {
    return (
      <div className="card text-sm text-muted">
        Voeg oefeningen toe om te zien welke spieren je traint.
      </div>
    );
  }

  return (
    <div className="card space-y-5">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="font-bold">Spieren in deze training</h3>
          <span className="text-xs text-muted">{totalSets} sets</span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
          {REGIONS.map((r) =>
            regions[r] > 0 ? (
              <div key={r} className={REGION_COLOR[r]} style={{ width: `${(regions[r] / regionTotal) * 100}%` }} />
            ) : null,
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {REGIONS.map((r) => (
            <span key={r} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${REGION_COLOR[r]}`} />
              {REGION_LABEL[r]} {Math.round((regions[r] / regionTotal) * 100)}%
            </span>
          ))}
        </div>
        {focus && <p className="mt-2 text-xs text-muted">{focusLabel(focus)}</p>}
      </div>

      <BodyMap intensity={Object.fromEntries(loads.map((l) => [l.id, l.sets / max]))} className="mx-auto w-full max-w-xs" />

      <ul className="space-y-1">
        {trained.map((g) => {
          const isOpen = open === g.id;
          const color = REGION_COLOR[GROUP_BY_ID[g.id].region];
          return (
            <li key={g.id}>
              <button
                onClick={() => setOpen(isOpen ? null : g.id)}
                className="grid w-full grid-cols-[1rem_8rem_1fr_2.5rem] items-center gap-2 py-1 text-left text-sm"
                aria-expanded={isOpen}
              >
                <ChevronRightIcon size={14} className={`text-muted transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
                <span className="truncate font-medium">{GROUP_BY_ID[g.id].name}</span>
                <Bar value={g.sets / max} color={color} />
                <span className="text-right text-xs tabular-nums text-muted">{fmt(g.sets)}</span>
              </button>
              {isOpen && (
                <ul className="mb-2 ml-6 space-y-1 border-l border-line pl-3">
                  {g.muscles.map((m) => (
                    <li key={m.id} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-2 text-xs">
                      <span className={`truncate ${m.sets > 0 ? "" : "text-muted"}`} title={MUSCLE_BY_ID[m.id].name}>
                        {MUSCLE_BY_ID[m.id].short}
                      </span>
                      <Bar value={m.sets / max} color={color} thin />
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
                <span className={s.kind === "volume" ? "text-warn" : "text-accent"}>{LABEL[s.kind]}</span>
                {s.text}
              </p>
              {s.exercises.length > 0 && onAdd && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.exercises.map((e) => (
                    <button
                      key={e.slug}
                      onClick={() => onAdd(e)}
                      className="rounded-full border border-line px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
                    >
                      + {e.name}
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
    </div>
  );
}

function Bar({ value, color, thin }: { value: number; color: string; thin?: boolean }) {
  return (
    <div className={`${thin ? "h-1.5" : "h-2"} overflow-hidden rounded-full bg-surface-2`}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  );
}

const LABEL = {
  missing: "Mist: ",
  detail: "Detail: ",
  balance: "Balans: ",
  volume: "Let op: ",
};

const REGION_COLOR: Record<MuscleRegion, string> = {
  push: "bg-accent",
  pull: "bg-sky-400",
  legs: "bg-orange-400",
  core: "bg-fuchsia-400",
};

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
