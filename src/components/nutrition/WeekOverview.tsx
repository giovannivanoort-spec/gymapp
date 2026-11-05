"use client";

import { useMemo } from "react";
import type { CachedState } from "@/lib/cache";
import { formatDate, toISODate } from "@/lib/dates";
import { fmt } from "@/lib/nutrition/format";
import type { FoodLog } from "@/lib/nutrition/log";
import type { Targets } from "@/lib/nutrition/targets";
import { sumMacros } from "@/lib/nutrition/types";
import { DataStatus } from "../platform/DataStatus";
import { MACRO_COLORS } from "./MacroSummary";

export function shiftDate(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return toISODate(new Date(y, m - 1, d + days));
}

/**
 * Calorieën per dag (7 dagen tot en met `end`) tegen het doel, plus gemiddelden.
 * Tik op een staaf om naar die dag te gaan. Vandaag telt niet mee in de gemiddelden (de dag is nog bezig).
 */
export function WeekOverview({
  logs,
  targets,
  end,
  selected,
  onSelect,
  error = false,
  onRetry,
  state,
  credits,
}: {
  /** Bevestigde logs in de periode, of undefined tijdens het laden. */
  logs: FoodLog[] | undefined;
  targets: Targets | null;
  end: string;
  selected: string;
  onSelect: (date: string) => void;
  /** Laden mislukt en er is nog niets bekend: geen eindeloze skeleton, maar een melding. */
  error?: boolean;
  onRetry?: () => void;
  /** Laadstatus van de week: toont "Offline, bijgewerkt om …" als de getoonde week mogelijk oud is. */
  state?: Pick<CachedState<unknown>, "data" | "error" | "refreshing" | "updatedAt" | "stale" | "offline" | "retry">;
  /**
   * "Calorieën terugverdienen": extra kcal per dag (YYYY-MM-DD → kcal) bovenop `targets.kcal`. Een dag
   * telt pas als "boven doel" boven zijn eigen doel (basis + beweging), net als in de dagsamenvatting.
   */
  credits?: Record<string, number>;
}) {
  const today = toISODate();
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => shiftDate(end, i - 6)).map((d) => {
        const items = (logs ?? []).filter((l) => l.date === d && !l.planned);
        return { date: d, logged: items.length > 0, ...sumMacros(items) };
      }),
    [logs, end],
  );
  const finished = days.filter((d) => d.logged && d.date < today);
  const includesToday = days.some((d) => d.date === today && d.logged);
  const max = Math.max(targets?.kcal ?? 0, ...days.map((d) => d.kcal), 1) * 1.18;
  const avg = (k: "kcal" | "protein") => (finished.length ? finished.reduce((a, d) => a + d[k], 0) / finished.length : 0);
  const proteinHits = targets ? finished.filter((d) => d.protein >= targets.protein * 0.95).length : 0;
  const title = end === today ? "Afgelopen 7 dagen" : `Week tot ${formatDate(end, { weekday: undefined, month: "short" })}`;

  return (
    <section className="card space-y-4" aria-labelledby="week-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="week-title" className="font-bold">
          {title}
        </h2>
        <span className="text-xs text-muted">{days.filter((d) => d.logged).length} van 7 dagen gelogd</span>
      </div>
      {state && logs !== undefined && <DataStatus state={state} />}

      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="rounded-xl bg-surface-2 py-2">
          <p className="text-lg font-extrabold tabular-nums">{finished.length ? fmt(avg("kcal")) : "–"}</p>
          <p className="text-xs text-muted">gem. kcal{targets ? ` (doel ${fmt(targets.kcal)})` : ""}</p>
        </div>
        <div className="rounded-xl bg-surface-2 py-2">
          <p className="text-lg font-extrabold tabular-nums" style={{ color: MACRO_COLORS.protein }}>
            {finished.length ? `${fmt(avg("protein"))} g` : "–"}
          </p>
          <p className="text-xs text-muted">gem. eiwit{targets ? ` (doel ${fmt(targets.protein)} g)` : ""}</p>
        </div>
      </div>

      {logs === undefined && error ? (
        <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl bg-surface-2 p-4 text-center" role="alert">
          <p className="text-sm text-muted">Kon je week niet laden.</p>
          {onRetry && (
            <button className="btn-ghost min-h-11 px-4 text-xs" onClick={onRetry}>
              Opnieuw proberen
            </button>
          )}
        </div>
      ) : logs === undefined ? (
        <div className="skeleton h-36" aria-busy />
      ) : (
        <div>
          {/* Staven en doellijn in hetzelfde vak, zodat een staaf precies op het doel ook precies op de lijn eindigt. */}
          <div className="relative h-28">
            {targets && (
              <div
                className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-muted/60"
                style={{ bottom: `${(targets.kcal / max) * 100}%` }}
                aria-hidden
              >
              </div>
            )}
            <div className="flex h-full items-end gap-1.5">
              {days.map((d) => {
                const dayCredit = credits?.[d.date] ?? 0;
                const over = targets && d.kcal > (targets.kcal + dayCredit) * 1.05;
                const isSel = d.date === selected;
                // Alleen de gekozen dag en vandaag krijgen een getal: zeven getallen naast elkaar zijn op een telefoon onleesbaar.
                const showValue = d.logged && (isSel || d.date === today);
                const dayName = formatDate(d.date, { weekday: "long", month: "long" });
                return (
                  <button
                    key={d.date}
                    onClick={() => onSelect(d.date)}
                    aria-label={`${dayName}: ${d.logged ? `${fmt(d.kcal)} kcal` : "niets gelogd"}${dayCredit > 0 ? `, doel + ${fmt(dayCredit)} kcal door beweging` : ""}`}
                    aria-current={isSel ? "date" : undefined}
                    className={`group relative flex h-full flex-1 items-end justify-center rounded-lg transition-colors ${isSel ? "bg-surface-2" : "hover:bg-surface-2/60"}`}
                  >
                    <div
                      className={`animate-fade-in relative w-full max-w-8 rounded-t-[4px] transition-[height] duration-700 ease-out ${
                        d.logged ? (over ? "bg-warn" : "bg-accent") : "bg-line"
                      } ${isSel || !d.logged ? "" : "opacity-80 group-hover:opacity-100"}`}
                      style={{ height: d.logged ? `${(d.kcal / max) * 100}%` : "3px" }}
                    >
                      {showValue && (
                        <span
                          className={`absolute bottom-full left-1/2 z-20 mb-0.5 -translate-x-1/2 whitespace-nowrap rounded bg-surface/90 px-0.5 text-[11px] tabular-nums ${isSel ? "font-bold text-ink" : "text-muted"}`}
                        >
                          {d.kcal >= 1000 ? `${fmt(d.kcal / 1000, 1)}k` : fmt(d.kcal)}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-1 flex gap-1.5" aria-hidden>
            {days.map((d) => (
              <span
                key={d.date}
                className={`flex-1 text-center text-[11px] capitalize ${
                  d.date === selected ? "font-bold text-accent" : d.date === today ? "font-semibold text-ink" : "text-muted"
                }`}
              >
                {formatDate(d.date, { weekday: "short", day: undefined, month: undefined }).slice(0, 2)}
              </span>
            ))}
          </div>
          {targets && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted" aria-hidden>
              <span className="inline-block w-4 border-t border-dashed border-muted" /> doel {fmt(targets.kcal)} kcal
              {credits && Object.values(credits).some((c) => c > 0) ? " (+ beweging per dag)" : ""}
              <span className="ml-2 inline-block h-2 w-2 rounded-sm bg-warn" /> boven doel
            </p>
          )}
        </div>
      )}

      <p className="text-[11px] text-muted">
        {finished.length > 0 && targets && (
          <>
            Eiwitdoel gehaald op <span className="font-semibold text-ink">{proteinHits}</span> van {finished.length} {finished.length === 1 ? "dag" : "dagen"}.{" "}
          </>
        )}
        {includesToday ? "Gemiddelden zonder vandaag. " : ""}Tik op een dag om hem te openen.
      </p>
    </section>
  );
}
