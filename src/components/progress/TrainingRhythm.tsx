"use client";

import { useMemo } from "react";
import { FlameIcon } from "@/components/Icons";
import { formatWeekRange, trainedDaysPerWeek, weekKey, weekRange, weekStreak } from "@/lib/week";

const WEEKS = 8;

/** Getrainde dagen per week over de laatste 8 weken, met het weekdoel en de reeks. */
export function TrainingRhythm({ days, goal }: { days: Iterable<string>; goal: number }) {
  const { weeks, streak, average, averageWeeks } = useMemo(() => {
    const list = [...days];
    const perWeek = trainedDaysPerWeek(list);
    const weeks = Array.from({ length: WEEKS }, (_, i) => {
      const range = weekRange(i - (WEEKS - 1));
      return { range, count: perWeek.get(range.from) ?? 0 };
    });
    // Gemiddelde over de afgeronde weken (de huidige week loopt nog), pas vanaf je eerste
    // trainingsweek: lege weken van voor je begon trekken het gemiddelde anders onterecht omlaag.
    const firstDay = list.reduce<string | null>((min, d) => (min == null || d < min ? d : min), null);
    const firstWeek = firstDay ? weekKey(firstDay) : null;
    const done = weeks.slice(0, -1).filter((w) => firstWeek != null && w.range.from >= firstWeek);
    const average = done.length ? done.reduce((s, w) => s + w.count, 0) / done.length : null;
    return { weeks, streak: weekStreak(perWeek, goal), average, averageWeeks: done.length };
  }, [days, goal]);

  const max = Math.max(goal, 4, ...weeks.map((w) => w.count));

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Ritme</p>
          <p className="text-xs text-muted">
            {average == null
              ? `Doel ${goal} ${goal === 1 ? "dag" : "dagen"} per week`
              : `Gemiddeld ${average.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} dagen per week${
                  averageWeeks < WEEKS - 1 ? ` (${averageWeeks} ${averageWeeks === 1 ? "week" : "weken"})` : ""
                } · doel ${goal}`}
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold tabular-nums ${
            streak > 0 ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted"
          }`}
        >
          <FlameIcon size={14} />
          {streak} {streak === 1 ? "week" : "weken"} op rij
        </span>
      </div>

      <div className="relative">
        {/* Lijn op de hoogte van het weekdoel, binnen het vlak van de staven (h-14). */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-14" aria-hidden>
          <div className="absolute inset-x-0 border-t border-dashed border-accent/40" style={{ bottom: `${(goal / max) * 100}%` }} />
        </div>
        <ol className="grid grid-cols-8 items-end gap-1.5" aria-label="Getrainde dagen per week, laatste 8 weken">
          {weeks.map((w, i) => {
            const current = i === WEEKS - 1;
            const met = w.count >= goal;
            return (
              <li
                key={w.range.from}
                className="flex flex-col items-center gap-1"
                aria-label={`${formatWeekRange(w.range)}: ${w.count} ${w.count === 1 ? "dag" : "dagen"}${current ? " (deze week)" : ""}`}
              >
                <div className="flex h-14 w-full items-end justify-center">
                  <div
                    className={`w-full max-w-7 origin-bottom rounded-md transition-[height] duration-500 ease-out ${
                      w.count === 0 ? "bg-surface-2" : met ? "bg-accent" : "bg-accent/45"
                    } ${current ? "ring-1 ring-ink/40 ring-offset-1 ring-offset-surface" : ""}`}
                    style={{ height: w.count ? `${(w.count / max) * 100}%` : "4px" }}
                  />
                </div>
                <span className={`text-[11px] tabular-nums ${current ? "font-bold text-ink" : "text-muted"}`} aria-hidden>
                  {w.count}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="flex justify-between text-[10px] uppercase tracking-wide text-muted" aria-hidden>
        <span>{WEEKS - 1} weken geleden</span>
        <span>deze week</span>
      </div>
    </div>
  );
}
