"use client";

import { useMemo, useState } from "react";
import { analyzePlan } from "@/lib/analysis";
import type { HistorySet } from "@/lib/history";
import { GROUP_BY_ID, MUSCLE_BY_ID, type MuscleGroupId } from "@/lib/muscles";
import {
  WEEKLY_SETS_MAX,
  WEEKLY_SETS_MIN,
  formatWeekRange,
  setsInRange,
  setsToPlan,
  volumeStatus,
  weekRange,
  type VolumeStatus,
} from "@/lib/week";
import { ChevronRightIcon } from "./Icons";

const STATUS: Record<VolumeStatus, { label: string; text: string; bar: string }> = {
  low: { label: "te weinig", text: "text-muted", bar: "bg-muted/70" },
  good: { label: "goed", text: "text-accent", bar: "bg-accent" },
  high: { label: "veel", text: "text-warn", bar: "bg-warn" },
};

/**
 * Effectieve sets per spiergroep in een week, afgezet tegen het bereik van 10–20 sets.
 * Een spier die meehelpt telt als een halve set (zie analyzePlan).
 */
export function WeeklyVolume({ history }: { history: HistorySet[] }) {
  const [offset, setOffset] = useState<0 | -1>(0);
  const [open, setOpen] = useState<MuscleGroupId | null>(null);

  const range = useMemo(() => weekRange(offset), [offset]);
  const { rows, totalSets, scale } = useMemo(() => {
    const sets = setsInRange(history, range.from, range.to);
    const { groups } = analyzePlan(setsToPlan(sets));
    const rows = groups
      .filter((g) => g.sets > 0 || GROUP_BY_ID[g.id].major)
      .sort((a, b) => b.sets - a.sets);
    // Vaste schaal met wat ruimte boven de 20, zodat het bereik altijd goed zichtbaar is.
    const scale = Math.max(25, Math.ceil(Math.max(0, ...rows.map((g) => g.sets)) / 5) * 5);
    return { rows, totalSets: sets.length, scale };
  }, [history, range]);

  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const inBand = rows.filter((g) => volumeStatus(g.sets) === "good").length;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Volume per spiergroep</h2>
        <div className="flex rounded-xl border border-line bg-surface-2 p-0.5 text-xs font-semibold" role="group" aria-label="Kies week">
          {([0, -1] as const).map((o) => (
            <button
              key={o}
              onClick={() => {
                setOffset(o);
                setOpen(null);
              }}
              aria-pressed={offset === o}
              className={`rounded-[10px] px-2.5 py-1.5 transition ${
                offset === o ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {o === 0 ? "Deze week" : "Vorige week"}
            </button>
          ))}
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="font-bold">{formatWeekRange(range)}</p>
            <p className="text-xs text-muted">
              {totalSets === 0
                ? offset === 0
                  ? "Nog geen sets gelogd deze week."
                  : "Geen sets gelogd die week."
                : `${totalSets} ${totalSets === 1 ? "set" : "sets"} gelogd`}
            </p>
          </div>
          {totalSets > 0 && (
            <p className="shrink-0 text-right text-xs text-muted">
              <span className="text-base font-extrabold tabular-nums text-ink">{inBand}</span> / {rows.length} in bereik
            </p>
          )}
        </div>

        <div>
          {/* As met de grenzen van het bereik, uitgelijnd met de balken eronder. */}
          <div className="relative ml-6 h-4 text-[10px] font-medium tabular-nums text-muted" aria-hidden>
            <span className="absolute -translate-x-1/2" style={{ left: pct(WEEKLY_SETS_MIN) }}>
              {WEEKLY_SETS_MIN}
            </span>
            <span className="absolute -translate-x-1/2" style={{ left: pct(WEEKLY_SETS_MAX) }}>
              {WEEKLY_SETS_MAX}
            </span>
          </div>

          <ul className="divide-y divide-line/60">
            {rows.map((g, i) => {
              const status = volumeStatus(g.sets);
              const s = STATUS[status];
              const empty = g.sets === 0;
              const isOpen = open === g.id;
              return (
                <li key={g.id} className="animate-fade-up" style={{ "--i": i } as React.CSSProperties}>
                  <button
                    onClick={() => setOpen(isOpen ? null : g.id)}
                    disabled={empty}
                    aria-expanded={empty ? undefined : isOpen}
                    className="block w-full py-2.5 text-left disabled:cursor-default"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <ChevronRightIcon
                        size={14}
                        className={`shrink-0 text-muted transition-transform duration-200 ${isOpen ? "rotate-90" : ""} ${empty ? "opacity-0" : ""}`}
                      />
                      <span className={`min-w-0 flex-1 truncate font-medium ${empty ? "text-muted" : ""}`}>
                        {GROUP_BY_ID[g.id].name}
                      </span>
                      <span className={`tabular-nums font-semibold ${empty ? "text-muted" : ""}`}>{fmt(g.sets)}</span>
                      <span className={`w-16 shrink-0 text-right text-[11px] font-semibold ${empty ? "text-muted/70" : s.text}`}>
                        {s.label}
                      </span>
                    </span>
                    <span className="mt-1.5 block pl-6">
                      <Track value={pct(g.sets)} bar={empty ? "" : s.bar} band={[pct(WEEKLY_SETS_MIN), pct(WEEKLY_SETS_MAX)]} />
                    </span>
                  </button>
                  {isOpen && (
                    <ul className="animate-fade-in mb-3 ml-6 space-y-1.5 border-l border-line pl-3">
                      {g.muscles.map((m) => (
                        <li key={m.id} className="grid grid-cols-[minmax(0,8rem)_1fr_2rem] items-center gap-2 text-xs">
                          <span className={`truncate ${m.sets > 0 ? "" : "text-muted"}`} title={MUSCLE_BY_ID[m.id].name}>
                            {MUSCLE_BY_ID[m.id].short}
                          </span>
                          <Track value={pct(m.sets)} bar={m.sets > 0 ? STATUS[volumeStatus(m.sets)].bar : ""} thin />
                          <span className="text-right tabular-nums text-muted">{fmt(m.sets)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex items-start gap-2 border-t border-line pt-3 text-xs text-muted">
          <span className="mt-0.5 h-3 w-5 shrink-0 rounded-[3px] border border-accent/30 bg-accent/10" aria-hidden />
          <p>
            {WEEKLY_SETS_MIN}–{WEEKLY_SETS_MAX} sets per spiergroep per week is het bereik waarin de meeste spiergroei zit. Een spier
            die meehelpt telt als een halve set. Tik op een groep voor de losse spieren.
          </p>
        </div>
      </div>
    </section>
  );
}

function Track({ value, bar, band, thin }: { value: string; bar: string; band?: [string, string]; thin?: boolean }) {
  return (
    <span className={`relative block overflow-hidden rounded-full bg-surface-2 ${thin ? "h-1.5" : "h-2.5"}`}>
      {band && (
        <span
          className="absolute inset-y-0 border-x border-accent/30 bg-accent/10"
          style={{ left: band[0], width: `calc(${band[1]} - ${band[0]})` }}
        />
      )}
      {bar && (
        <span className={`relative block h-full rounded-full transition-[width] duration-500 ease-out ${bar}`} style={{ width: value }} />
      )}
    </span>
  );
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}
