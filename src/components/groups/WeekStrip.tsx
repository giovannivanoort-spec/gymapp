"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRightIcon } from "@/components/Icons";
import { Sheet } from "@/components/Sheet";
import { toISODate } from "@/lib/dates";
import { parseISODate, weekRange } from "@/lib/week";
import { plural, type GroupWorkout } from "./groupData";

const DAY = ["ma", "di", "wo", "do", "vr", "za", "zo"];

const longDay = (d: string) => parseISODate(d).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });

/**
 * Deze week in één oogopslag: geplande dagen gemarkeerd. Een geplande dag opent de training (bij
 * meerdere trainingen op één dag eerst een keuze); een trainer kan op een lege dag (vandaag of
 * later) tikken om direct iets te plannen.
 */
export function WeekStrip({
  groupId,
  workouts,
  isTrainer,
}: {
  groupId: string;
  workouts: GroupWorkout[];
  isTrainer: boolean;
}) {
  const [choose, setChoose] = useState<{ date: string; items: GroupWorkout[] } | null>(null);
  const today = toISODate();
  const { days } = weekRange(0);
  const byDate = new Map<string, GroupWorkout[]>();
  for (const w of workouts) byDate.set(w.date, [...(byDate.get(w.date) ?? []), w]);

  return (
    <>
      <ol className="grid grid-cols-7 gap-1" aria-label="Deze week">
        {days.map((d, i) => {
          const planned = byDate.get(d) ?? [];
          const isToday = d === today;
          const isPast = d < today;
          const num = parseISODate(d).getDate();
          const label = `${longDay(d)}${
            planned.length ? `: ${planned.map((w) => w.title).join(", ")}` : isTrainer && !isPast ? ": training plannen" : ": niets gepland"
          }`;
          const inner = (
            <>
              <span className={`text-[10px] font-medium uppercase ${isToday ? "text-accent" : "text-muted"}`}>{DAY[i]}</span>
              <span className={`text-sm font-bold tabular-nums ${isPast && !planned.length ? "text-muted" : ""}`}>{num}</span>
              {planned.length > 1 ? (
                // Twee of meer trainingen op één dag: het aantal in plaats van een stip.
                <span
                  className={`flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none tabular-nums ${
                    isPast ? "bg-muted text-bg" : "bg-accent text-accent-ink"
                  }`}
                >
                  {planned.length}
                </span>
              ) : (
                <span
                  className={`h-1.5 w-1.5 rounded-full transition-colors ${
                    planned.length ? (isPast ? "bg-muted" : "bg-accent") : "bg-transparent"
                  }`}
                />
              )}
            </>
          );
          const cls = `flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-xl border transition active:scale-95 ${
            isToday ? "border-accent/60 bg-accent/10" : planned.length ? "border-line bg-surface" : "border-transparent"
          }`;
          let href: string | null = null;
          if (planned.length === 1) href = `/workouts/${planned[0].id}`;
          else if (!planned.length && isTrainer && !isPast) href = `/groups/${groupId}/plan?date=${d}`;
          return (
            <li key={d} className="animate-fade-up" style={{ "--i": i } as React.CSSProperties}>
              {planned.length > 1 ? (
                <button
                  type="button"
                  aria-label={`${label}. Kies een training`}
                  aria-haspopup="dialog"
                  className={`${cls} hover:border-muted`}
                  onClick={() => setChoose({ date: d, items: planned })}
                >
                  {inner}
                </button>
              ) : href ? (
                <Link href={href} aria-label={label} className={`${cls} hover:border-muted`}>
                  {inner}
                </Link>
              ) : (
                <div aria-label={label} className={cls}>
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <Sheet open={!!choose} onClose={() => setChoose(null)} title={choose ? longDay(choose.date) : "Trainingen"}>
        <ul className="space-y-2">
          {choose?.items.map((w) => (
            <li key={w.id}>
              <Link
                href={`/workouts/${w.id}`}
                className="flex min-h-12 items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 transition hover:border-muted active:scale-[0.99]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{w.title}</span>
                  <span className="block text-xs text-muted">{plural(w.exerciseCount, "oefening", "oefeningen")}</span>
                </span>
                <ChevronRightIcon className="shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}
