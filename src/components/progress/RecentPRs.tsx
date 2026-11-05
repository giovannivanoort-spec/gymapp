"use client";

import { ChevronRightIcon, TrophyIcon } from "@/components/Icons";
import { relativeDay } from "@/lib/dates";
import { isTimed } from "@/lib/exercises";
import { formatSet, nl } from "@/lib/history";
import { exerciseName, type RecentPR } from "@/lib/progress/records";

/** Nieuwe records van de laatste twee weken, met de verbetering ten opzichte van het vorige record. */
export function RecentPRs({ prs, onOpen }: { prs: RecentPR[]; onOpen: (slug: string) => void }) {
  if (prs.length === 0) return null;
  const shown = prs.slice(0, 5);
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recente records</h2>
        <span className="text-xs text-muted">laatste 14 dagen</span>
      </div>
      <ul className="card divide-y divide-line overflow-hidden p-0">
        {shown.map((pr, i) => {
          const gain = pr.value - pr.previous;
          const pct = pr.previous > 0 ? (gain / pr.previous) * 100 : 0;
          return (
            <li key={pr.slug} className="animate-fade-up" style={{ "--i": i } as React.CSSProperties}>
              <button
                type="button"
                onClick={() => onOpen(pr.slug)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2 active:bg-surface-2"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
                  <TrophyIcon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{exerciseName(pr.slug)}</span>
                  <span className="block truncate text-xs text-muted">
                    {relativeDay(pr.date)} · {formatSet(pr.bestSet)}
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className="block text-sm font-bold">
                    {nl(pr.value)} {pr.weighted ? "kg" : isTimed(pr.slug) ? "s" : "reps"}
                  </span>
                  <span className="block text-xs font-semibold text-accent">
                    +{nl(gain)} {pr.weighted ? "kg" : isTimed(pr.slug) ? "s" : gain === 1 ? "rep" : "reps"}
                    {pr.weighted && pct > 0 ? ` (${nl(pct)}%)` : ""}
                  </span>
                </span>
                <ChevronRightIcon size={14} className="shrink-0 text-muted" />
              </button>
            </li>
          );
        })}
      </ul>
      {prs.length > shown.length && (
        <p className="text-center text-xs text-muted">en nog {prs.length - shown.length} andere records</p>
      )}
    </section>
  );
}
