"use client";

import Link from "next/link";
import { ChevronRightIcon } from "@/components/Icons";
import { RankBadge, TierProgress } from "@/components/RankBadge";
import { WeekGoal } from "@/components/WeekGoal";
import { tierProgress, TIERS, type OverallRank } from "@/lib/ranks";

/** Totaalrang (naar /ranks) met daaronder het weekdoel (opent het weekdoel-paneel). */
export function RankGoalCard({
  overall,
  rankFailed,
  profileDone,
  days,
  planned,
  goal,
  today,
  goalFailed,
  onEditGoal,
}: {
  /** undefined zolang de geschiedenis laadt, null als er (nog) geen rang is. */
  overall: OverallRank | null | undefined;
  rankFailed: boolean;
  profileDone: boolean;
  days: Set<string> | null;
  planned: Set<string> | null;
  goal: number;
  today: string;
  goalFailed: boolean;
  onEditGoal: () => void;
}) {
  const tierIndex = overall ? TIERS.indexOf(overall.tier) : 0;
  return (
    <section className="card animate-scale-in relative overflow-hidden p-0" aria-label="Rang en weekdoel">
      {overall && (
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-25 blur-3xl"
          style={{ background: overall.tier.from }}
        />
      )}
      <Link
        href={profileDone || overall ? "/ranks" : "/profile"}
        className="relative flex items-center gap-4 p-4 transition-colors hover:bg-surface-2/40 active:bg-surface-2/60"
      >
        {overall ? (
          <RankBadge tierIndex={tierIndex} size={64} glow />
        ) : (
          <RankBadge tierIndex={0} size={64} className="opacity-25 grayscale" />
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Totaalrang</p>
          {overall === undefined ? (
            rankFailed ? (
              <p className="text-sm text-muted">Nog niet geladen</p>
            ) : (
              <>
                <span className="skeleton block h-6 w-28" />
                <span className="skeleton block h-2 w-full" />
              </>
            )
          ) : overall ? (
            <>
              <p className="text-xl font-bold" style={{ color: overall.tier.to }}>
                {overall.tier.name}
              </p>
              <TierProgress tierIndex={tierIndex} progress={tierProgress(overall.score)} />
            </>
          ) : (
            <>
              <p className="text-xl font-bold">Nog geen rang</p>
              <p className="text-xs text-muted">
                {profileDone
                  ? "Log een training met gewicht om je rang te bepalen."
                  : "Vul je gewicht en geslacht in om je rang te bepalen."}
              </p>
            </>
          )}
        </div>
        <ChevronRightIcon className="shrink-0 text-muted" />
      </Link>
      <div className="relative border-t border-line">
        <WeekGoal days={days} planned={planned} goal={goal} today={today} onEdit={onEditGoal} failed={goalFailed} />
      </div>
    </section>
  );
}
