"use client";

import { useMemo } from "react";
import { toISODate } from "@/lib/dates";
import { parseISODate, trainedDaysPerWeek, weekRange, weekStreak } from "@/lib/week";
import { ChevronRightIcon } from "./Icons";

const WEEKDAYS = ["M", "D", "W", "D", "V", "Z", "Z"];
const WEEKDAY_NAMES = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
const SIZE = 60;
const STROKE = 6;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/**
 * Weekdoel: aantal getrainde dagen deze week tegenover het doel, met ring, dagstippen en reeks.
 * `days` is null zolang de gegevens laden. `today` (YYYY-MM-DD) laat de week meelopen als de app lang
 * open staat; `onEdit` maakt het blok aantikbaar (bijv. om het doel aan te passen). `failed` toont
 * een korte melding in plaats van een skeleton als er (nog) niets geladen kon worden. `planned`
 * (datums met een geplande training) zet een stip onder de dagen die nog komen, zodat je ziet of
 * het doel haalbaar is.
 */
export function WeekGoal({
  days,
  goal: rawGoal,
  today: todayProp,
  onEdit,
  failed = false,
  planned,
}: {
  days: Set<string> | null;
  goal: number;
  today?: string;
  onEdit?: () => void;
  failed?: boolean;
  planned?: Set<string> | null;
}) {
  const goal = Math.min(7, Math.max(1, Math.round(rawGoal) || 3));
  const today = todayProp ?? toISODate();
  const stats = useMemo(() => {
    if (!days) return null;
    const now = parseISODate(today);
    const { days: week } = weekRange(0, now);
    const done = week.filter((d) => days.has(d)).length;
    // Nog te gaan en gepland: vandaag (als je nog niet trainde) en de rest van de week.
    const upcoming = week.filter((d) => d >= today && !days.has(d) && !!planned?.has(d)).length;
    return { week, done, upcoming, streak: weekStreak(trainedDaysPerWeek(days), goal, now) };
  }, [days, goal, today, planned]);

  const progress = stats ? Math.min(1, stats.done / goal) : 0;
  const met = stats ? stats.done >= goal : false;
  const left = stats ? Math.max(0, goal - stats.done) : 0;
  const week = stats?.week ?? weekRange(0, parseISODate(today)).days;

  // Alleen <span>s: dit blok kan in een <button> staan.
  const body = (
    <>
      <span className="relative block shrink-0" style={{ width: SIZE, height: SIZE }}>
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
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
          {stats ? (
            <span className={`text-lg font-extrabold tabular-nums ${met ? "text-accent" : ""}`}>{stats.done}</span>
          ) : (
            <span className="text-lg font-extrabold text-muted">–</span>
          )}
        </span>
      </span>

      <span className="block min-w-0 flex-1 space-y-1.5">
        <span className="block text-sm">
          <span className="text-muted">Deze week: </span>
          <span className="font-bold tabular-nums">
            {stats ? stats.done : "–"} / {goal}
          </span>{" "}
          <span className="text-muted">{goal === 1 ? "training" : "trainingen"}</span>
        </span>

        <span className="flex gap-1" aria-hidden>
          {week.map((d, i) => {
            const trained = days?.has(d);
            const plan = !trained && d >= today && !!planned?.has(d);
            return (
              <span
                key={d}
                title={`${WEEKDAY_NAMES[i]}${trained ? ", getraind" : plan ? ", training gepland" : ""}`}
                className={`relative flex h-5 flex-1 items-center justify-center rounded-md text-[11px] font-bold leading-none transition-colors duration-300 ${
                  trained
                    ? "bg-accent text-accent-ink"
                    : d === today
                      ? "border border-accent/60 text-ink"
                      : d > today
                        ? "bg-surface-2/50 text-muted/60"
                        : "bg-surface-2 text-muted"
                }`}
              >
                {WEEKDAYS[i]}
                {plan && <span className="absolute -bottom-[5px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />}
              </span>
            );
          })}
        </span>

        <span className="block text-xs leading-4 text-muted">
          {!stats ? (
            failed ? (
              "Nog niet geladen"
            ) : (
              <span className="skeleton inline-block h-3 w-40 align-middle" />
            )
          ) : stats.streak > 1 || (stats.streak === 1 && !met) ? (
            <>
              <span className="font-semibold text-ink">
                {stats.streak} {stats.streak === 1 ? "week" : "weken"}
              </span>{" "}
              op rij je doel gehaald{!met && <> · nog {left} te gaan</>}
            </>
          ) : met ? (
            <span className="font-semibold text-accent">Doel gehaald, je reeks is gestart</span>
          ) : stats.upcoming > 0 ? (
            <>
              Nog {left} te gaan · <span className="text-ink">{stats.upcoming} gepland</span>
            </>
          ) : (
            "Haal deze week je doel om een reeks te starten"
          )}
        </span>
      </span>
      {onEdit && <ChevronRightIcon className="shrink-0 text-muted" />}
    </>
  );

  const label = stats
    ? `Weekdoel: ${stats.done} van ${goal} ${goal === 1 ? "training" : "trainingen"} deze week${
        stats.streak > 0 ? `, ${stats.streak} ${stats.streak === 1 ? "week" : "weken"} op rij gehaald` : ""
      }${stats.upcoming > 0 && !met ? `, nog ${stats.upcoming} gepland` : ""}.`
    : `Weekdoel: ${goal} ${goal === 1 ? "training" : "trainingen"} per week.`;

  if (onEdit) {
    return (
      <button
        type="button"
        onClick={onEdit}
        aria-label={`${label} Tik voor details of om je doel aan te passen.`}
        className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-surface-2/40 active:bg-surface-2/60"
      >
        {body}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-4 p-4" role="group" aria-label={label}>
      {body}
    </div>
  );
}
