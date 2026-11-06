"use client";

import { timeAgo } from "@/lib/dates";
import { formatClockTime, formatSleepDuration, sleepSourceLine, sleepStages, type DailySleep, type SleepStageKey } from "@/lib/sleep";
import { goalMet, goalPct } from "./format";

const STAGE_COLOR: Record<SleepStageKey, string> = {
  deep: "bg-accent",
  rem: "bg-rival",
  light: "bg-accent/45",
  awake: "bg-warn/70",
};

/** Slaapfases als één gestapelde balk met legenda (alleen als het horloge of de app ze meet). */
export function SleepStagesBar({ night }: { night: DailySleep }) {
  const stages = sleepStages(night);
  if (!stages) return null;
  const total = stages.reduce((a, s) => a + s.minutes, 0);
  if (total <= 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Slaapfases</p>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        {stages.map((s) =>
          s.minutes > 0 ? <span key={s.key} className={`block h-full ${STAGE_COLOR[s.key]}`} style={{ width: `${(s.minutes / total) * 100}%` }} /> : null,
        )}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {stages.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_COLOR[s.key]}`} aria-hidden />
            <span className="text-muted">{s.label}</span>
            <span className="ml-auto font-semibold tabular-nums">{formatSleepDuration(s.minutes)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Eén nacht in detail: duur tegen het doel, bed- en wektijd, tijd in bed, fases en bron. */
export function NightDetail({ night, goal }: { night: DailySleep; goal: number }) {
  const hit = goalMet(night.asleep_minutes, goal);
  const short = goal - night.asleep_minutes;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-3xl font-extrabold tabular-nums">{formatSleepDuration(night.asleep_minutes)}</span>
          <span className="text-sm text-muted">/ {formatSleepDuration(goal)} doel</span>
          <span className={`ml-auto text-xs tabular-nums ${hit ? "font-semibold text-accent" : "text-muted"}`}>
            {hit ? "Doel gehaald" : `${formatSleepDuration(short)} te kort`}
          </span>
        </p>
        <span className="block h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <span className={`block h-full rounded-full ${hit ? "bg-accent" : "bg-accent/70"}`} style={{ width: `${goalPct(night.asleep_minutes, goal)}%` }} />
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-xl bg-surface-2 px-3 py-2">
          <dt className="text-xs text-muted">Naar bed</dt>
          <dd className="font-semibold tabular-nums">{formatClockTime(night.bedtime)}</dd>
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2">
          <dt className="text-xs text-muted">Wakker</dt>
          <dd className="font-semibold tabular-nums">{formatClockTime(night.wake_time)}</dd>
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2">
          <dt className="text-xs text-muted">In bed</dt>
          <dd className="font-semibold tabular-nums">{formatSleepDuration(night.in_bed_minutes)}</dd>
        </div>
      </dl>

      <SleepStagesBar night={night} />

      <p className="truncate text-xs text-muted">
        {sleepSourceLine(night)}
        {night.source !== "manual" && night.synced_at ? ` · ${timeAgo(night.synced_at)}` : ""}
      </p>
    </div>
  );
}
