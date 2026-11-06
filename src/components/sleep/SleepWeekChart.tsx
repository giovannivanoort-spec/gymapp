"use client";

import { formatSleepDuration, formatSleepHours, type DailySleep } from "@/lib/sleep";
import { parseISODate } from "@/lib/week";
import { goalMet, shortWakeDay } from "./format";

const GROW = "height 0.6s cubic-bezier(0.2,0.8,0.2,1)";

/**
 * Balkjes per nacht (op wakkerworddatum) met een stippellijn op het slaapdoel. Dagen in de toekomst
 * zijn leeg; nachten zonder data krijgen een streepje. Met `onSelect` is elke nacht met data aan te tikken.
 */
export function SleepWeekChart({
  days,
  nights,
  goal,
  today,
  selected,
  onSelect,
  compact = false,
}: {
  days: string[];
  nights: DailySleep[] | undefined;
  goal: number;
  today: string;
  selected?: string | null;
  onSelect?: (date: string) => void;
  /** Lagere variant (voor op een kaart), zonder waarden boven de balken. */
  compact?: boolean;
}) {
  const byDate = new Map((nights ?? []).map((n) => [n.date, n]));
  const values = days.map((d) => byDate.get(d)?.asleep_minutes ?? null);
  const max = Math.max(goal * 1.15, ...values.map((v) => v ?? 0));
  const goalPos = (goal / max) * 100;
  const height = compact ? "h-10" : "h-36";

  return (
    <div className={compact ? "" : "pt-5"}>
      <div className={`relative ${height}`}>
        {/* Slaapdoel */}
        <span
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted/50"
          style={{ bottom: `${goalPos}%` }}
          aria-hidden
        />
        <ol className="relative flex h-full items-end gap-1.5" aria-label="Slaap per nacht">
          {days.map((d, i) => {
            const v = values[i];
            const future = d > today;
            const hit = goalMet(v, goal);
            const h = v != null && max > 0 ? Math.max(4, (v / max) * 100) : 0;
            const isSel = selected === d;
            const label = `${shortWakeDay(d)}: ${v != null ? `${formatSleepDuration(v)} geslapen${hit ? ", doel gehaald" : ""}` : future ? "nog niet" : "geen gegevens"}`;
            const bar =
              v != null ? (
                <span
                  className={`relative block w-full rounded-md ${hit ? "bg-accent" : "bg-accent/40"} ${isSel ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : ""}`}
                  style={{ height: `${h}%`, transition: GROW }}
                >
                  {!compact && (
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold tabular-nums text-muted">
                      {formatSleepHours(v).replace(" u", "")}
                    </span>
                  )}
                </span>
              ) : (
                <span className={`block h-1 w-full rounded-sm ${future ? "bg-line/40" : "bg-line"}`} />
              );
            return (
              <li key={d} className="flex h-full flex-1 items-end">
                {onSelect && v != null ? (
                  <button
                    type="button"
                    onClick={() => onSelect(d)}
                    aria-pressed={isSel}
                    aria-label={label}
                    className="flex h-full w-full items-end rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {bar}
                  </button>
                ) : (
                  <span className="flex h-full w-full items-end" role="img" aria-label={label}>
                    {bar}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="mt-1.5 flex gap-1.5" aria-hidden>
        {days.map((d) => (
          <span key={d} className={`flex-1 text-center text-[10px] ${d === today ? "font-bold text-ink" : "text-muted"}`}>
            {compact
              ? parseISODate(d).toLocaleDateString("nl-NL", { weekday: "narrow" }).toUpperCase()
              : parseISODate(d).toLocaleDateString("nl-NL", { weekday: "short" }).replace(".", "")}
          </span>
        ))}
      </div>
    </div>
  );
}
