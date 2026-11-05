"use client";

import Link from "next/link";
import { PlusIcon } from "@/components/Icons";
import { parseISODate } from "@/lib/week";
import { exerciseCount, type UpcomingWorkout } from "./data";

/** "Morgen", "Over 3 dagen" (vanaf vandaag, op kalenderdagen). */
function untilLabel(date: string, today: string): string {
  const n = Math.round((parseISODate(date).getTime() - parseISODate(today).getTime()) / 86_400_000);
  if (n <= 0) return "Vandaag";
  if (n === 1) return "Morgen";
  if (n < 14) return `Over ${n} dagen`;
  return `Over ${Math.round(n / 7)} weken`;
}

/**
 * Wat er na vandaag gepland staat, als compacte horizontale strook direct onder de training van
 * vandaag. Trainers krijgen aan het eind een tegel om de volgende training te plannen.
 */
export function PlanStrip({
  workouts,
  title,
  today,
  planHref,
}: {
  workouts: UpcomingWorkout[];
  title: string;
  today: string;
  /** Alleen voor trainers: waar "Training plannen" naartoe gaat. */
  planHref: string | null;
}) {
  if (!workouts.length && !planHref) return null;
  return (
    <section className="space-y-3" aria-labelledby="home-plan">
      <h2 id="home-plan" className="text-sm font-semibold uppercase tracking-wide text-muted">
        {title}
      </h2>
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {workouts.map((w, i) => {
          const d = parseISODate(w.date);
          const n = exerciseCount(w);
          const when = untilLabel(w.date, today);
          return (
            <li key={w.id} className="flex shrink-0">
              <Link
                href={`/workouts/${w.id}`}
                className="card animate-fade-up flex w-[150px] flex-col gap-2 p-3 transition-colors hover:border-muted active:scale-[0.98]"
                style={{ "--i": i } as React.CSSProperties}
                aria-label={`${w.title}, ${d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}${
                  w.groups?.name ? `, ${w.groups.name}` : ""
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-2 leading-none">
                    <span className="text-[10px] font-semibold uppercase text-muted">
                      {d.toLocaleDateString("nl-NL", { weekday: "short" }).replace(".", "")}
                    </span>
                    <span className="text-base font-bold tabular-nums">{d.getDate()}</span>
                  </span>
                  <span className={`text-[11px] font-semibold ${when === "Morgen" ? "text-accent" : "text-muted"}`}>{when}</span>
                </span>
                <span className="line-clamp-2 text-sm font-semibold leading-snug">{w.title}</span>
                <span className="mt-auto truncate text-[11px] text-muted">
                  {w.groups?.name ? `${w.groups.name} · ` : ""}
                  {n === 0 ? "nog leeg" : `${n} ${n === 1 ? "oefening" : "oefeningen"}`}
                </span>
              </Link>
            </li>
          );
        })}
        {planHref && (
          <li className="flex shrink-0">
            <Link
              href={planHref}
              className="animate-fade-up flex w-[120px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line p-3 text-center text-muted transition hover:border-muted hover:text-ink active:scale-[0.98]"
              style={{ "--i": workouts.length } as React.CSSProperties}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2">
                <PlusIcon size={18} />
              </span>
              <span className="text-xs font-semibold">Training plannen</span>
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}
