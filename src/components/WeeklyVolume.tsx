"use client";

import { useMemo, useState } from "react";
import { analyzePlan } from "@/lib/analysis";
import type { HistorySet } from "@/lib/history";
import { GROUP_BY_ID, MUSCLE_BY_ID, type MuscleGroupId } from "@/lib/muscles";
import {
  WEEKLY_SETS_MAX,
  WEEKLY_SETS_MIN,
  formatWeekRange,
  parseISODate,
  setsInRange,
  setsToPlan,
  volumeStatus,
  weekKey,
  weekRange,
  type VolumeStatus,
} from "@/lib/week";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";

const TREND_WEEKS = 6;

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
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<MuscleGroupId | null>(null);

  // Terugbladeren kan tot de week van je eerste gelogde set (minstens de trendperiode).
  const minOffset = useMemo(() => {
    let first: string | null = null;
    for (const s of history) if ((s.reps ?? 0) > 0 && (!first || s.date < first)) first = s.date;
    if (!first) return -(TREND_WEEKS - 1);
    const weeks = Math.round((parseISODate(weekKey(new Date())).getTime() - parseISODate(weekKey(first)).getTime()) / (7 * 86_400_000));
    return -Math.max(TREND_WEEKS - 1, weeks);
  }, [history]);

  const go = (next: number) => {
    setOffset(Math.min(0, Math.max(minOffset, next)));
    setOpen(null);
  };

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

  // Effectieve sets per spiergroep in de 6 weken tot en met de gekozen week (oud → nieuw).
  const trend = useMemo(() => {
    const out = new Map<MuscleGroupId, { from: string; sets: number }[]>();
    for (let o = offset - (TREND_WEEKS - 1); o <= offset; o++) {
      const r = weekRange(o);
      const { groups } = analyzePlan(setsToPlan(setsInRange(history, r.from, r.to)));
      for (const g of groups) {
        let list = out.get(g.id);
        if (!list) out.set(g.id, (list = []));
        list.push({ from: r.from, sets: g.sets });
      }
    }
    return out;
  }, [history, offset]);

  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const inBand = rows.filter((g) => volumeStatus(g.sets) === "good").length;

  return (
    <section className="space-y-3" aria-label="Volume per spiergroep">
      <div className="flex items-center gap-2" role="group" aria-label="Kies week">
        <button
          type="button"
          onClick={() => go(offset - 1)}
          disabled={offset <= minOffset}
          className="btn-ghost h-10 w-10 shrink-0 p-0 disabled:opacity-40"
          aria-label="Vorige week"
        >
          <ChevronLeftIcon size={18} />
        </button>
        <div className="min-w-0 flex-1 text-center" aria-live="polite">
          <p className="truncate font-bold tabular-nums">{formatWeekRange(range)}</p>
          <p className="text-xs text-muted">{weekLabel(offset)}</p>
        </div>
        {offset < 0 ? (
          <button
            type="button"
            onClick={() => go(offset + 1)}
            className="btn-ghost h-10 w-10 shrink-0 p-0"
            aria-label="Volgende week"
          >
            <ChevronRightIcon size={18} />
          </button>
        ) : (
          <span className="h-10 w-10 shrink-0" aria-hidden />
        )}
      </div>
      {offset < -1 && (
        <div className="-mt-1 flex justify-center">
          <button type="button" onClick={() => go(0)} className="animate-fade-in text-xs font-semibold text-accent">
            Naar deze week
          </button>
        </div>
      )}

      <div key={range.from} className="card animate-fade-in space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Effectieve sets per spiergroep</p>
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
              const weeks = trend.get(g.id) ?? [];
              const expandable = !empty || weeks.some((w) => w.sets > 0);
              const isOpen = open === g.id;
              return (
                <li key={g.id} className="animate-fade-up" style={{ "--i": i } as React.CSSProperties}>
                  <button
                    onClick={() => setOpen(isOpen ? null : g.id)}
                    disabled={!expandable}
                    aria-expanded={expandable ? isOpen : undefined}
                    className="block w-full py-2.5 text-left disabled:cursor-default"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <ChevronRightIcon
                        size={14}
                        className={`shrink-0 text-muted transition-transform duration-200 ${isOpen ? "rotate-90" : ""} ${expandable ? "" : "opacity-0"}`}
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
                    <div className="animate-fade-in mb-3 ml-6 space-y-3 border-l border-line pl-3">
                      <WeekTrend weeks={weeks} selected={range.from} />
                      <ul className="space-y-1.5">
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
                    </div>
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
            die meehelpt telt als een halve set. Tik op een groep voor de losse spieren en het verloop over {TREND_WEEKS} weken.
          </p>
        </div>
      </div>
    </section>
  );
}

function weekLabel(offset: number): string {
  if (offset === 0) return "Deze week";
  if (offset === -1) return "Vorige week";
  return `${-offset} weken geleden`;
}

/** Kleine staafjes: effectieve sets per week voor één spiergroep, met het 10–20-bereik als band. */
function WeekTrend({ weeks, selected }: { weeks: { from: string; sets: number }[]; selected: string }) {
  const max = Math.max(WEEKLY_SETS_MAX + 5, ...weeks.map((w) => w.sets));
  const h = (v: number) => `${(v / max) * 100}%`;
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">Verloop over {weeks.length} weken</p>
      <div className="relative h-12">
        <span
          className="absolute inset-x-0 border-y border-accent/30 bg-accent/10"
          style={{ bottom: h(WEEKLY_SETS_MIN), height: `calc(${h(WEEKLY_SETS_MAX)} - ${h(WEEKLY_SETS_MIN)})` }}
          aria-hidden
        />
        <ol className="relative flex h-full items-end gap-1.5" aria-label="Effectieve sets per week">
          {weeks.map((w) => (
            <li
              key={w.from}
              className="flex h-full flex-1 items-end justify-center"
              aria-label={`Week van ${parseISODate(w.from).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}: ${fmt(w.sets)} sets`}
            >
              <span
                className={`block w-full max-w-6 rounded-t-[4px] ${w.sets === 0 ? "bg-surface-2" : STATUS[volumeStatus(w.sets)].bar} ${
                  w.from === selected ? "" : "opacity-60"
                }`}
                style={{ height: w.sets ? h(w.sets) : "3px" }}
              />
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-1 flex gap-1.5 text-center text-[10px] tabular-nums text-muted" aria-hidden>
        {weeks.map((w) => (
          <span key={w.from} className={`flex-1 ${w.from === selected ? "font-bold text-ink" : ""}`}>
            {fmt(w.sets)}
          </span>
        ))}
      </div>
    </div>
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
