"use client";

import { useMemo } from "react";
import { toISODate } from "@/lib/dates";
import { trainedDaysPerWeek, weekRange, weekStreak } from "@/lib/week";

const WEEKDAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const SIZE = 60;
const STROKE = 6;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/**
 * Weekdoel: aantal getrainde dagen deze week tegenover het doel, met ring, dagstippen en reeks.
 * `days` is null zolang de gegevens laden.
 */
export function WeekGoal({ days, goal }: { days: Set<string> | null; goal: number }) {
  const stats = useMemo(() => {
    if (!days) return null;
    const { days: week } = weekRange(0);
    const done = week.filter((d) => days.has(d)).length;
    return { week, done, streak: weekStreak(trainedDaysPerWeek(days), goal) };
  }, [days, goal]);

  const today = toISODate();
  const progress = stats ? Math.min(1, stats.done / goal) : 0;
  const met = stats ? stats.done >= goal : false;
  const left = stats ? Math.max(0, goal - stats.done) : 0;

  return (
    <div className="flex items-center gap-4 p-4">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90" aria-hidden>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--color-surface-2)" strokeWidth={STROKE} />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - progress)}
            style={{
              transition: "stroke-dashoffset 0.9s cubic-bezier(0.2, 0.8, 0.2, 1)",
              opacity: progress > 0 ? 1 : 0,
            }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {stats ? (
            <span className={`text-lg font-extrabold tabular-nums ${met ? "text-accent" : ""}`}>{stats.done}</span>
          ) : (
            <span className="text-lg font-extrabold text-muted">–</span>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm">
          <span className="text-muted">Deze week: </span>
          <span className="font-bold tabular-nums">
            {stats ? stats.done : "–"} / {goal}
          </span>{" "}
          <span className="text-muted">{goal === 1 ? "training" : "trainingen"}</span>
        </p>

        <div className="flex gap-1" aria-hidden>
          {(stats?.week ?? weekRange(0).days).map((d, i) => {
            const trained = days?.has(d);
            return (
              <span
                key={d}
                className={`flex h-5 flex-1 items-center justify-center rounded-md text-[9px] font-semibold uppercase transition-colors duration-300 ${
                  trained
                    ? "bg-accent text-accent-ink"
                    : d === today
                      ? "border border-accent/50 text-ink"
                      : d > today
                        ? "bg-surface-2/50 text-muted/50"
                        : "bg-surface-2 text-muted"
                }`}
              >
                {WEEKDAYS[i]}
              </span>
            );
          })}
        </div>

        <p className="text-xs leading-4 text-muted">
          {!stats ? (
            <span className="skeleton inline-block h-3 w-40 align-middle" />
          ) : stats.streak > 1 || (stats.streak === 1 && !met) ? (
            <>
              <span className="font-semibold text-ink">
                {stats.streak} {stats.streak === 1 ? "week" : "weken"}
              </span>{" "}
              op rij je doel gehaald{!met && <> · nog {left} te gaan</>}
            </>
          ) : met ? (
            <span className="font-semibold text-accent">Doel gehaald, je reeks is gestart</span>
          ) : (
            "Haal deze week je doel om een reeks te starten"
          )}
        </p>
      </div>
    </div>
  );
}
