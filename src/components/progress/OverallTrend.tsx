"use client";

import { useMemo } from "react";
import { LineChart, type ChartBand, type ChartPoint } from "@/components/LineChart";
import { formatDate } from "@/lib/dates";
import type { OverallPoint } from "@/lib/progress/rankHistory";
import { tierFor, tierProgress, TIERS } from "@/lib/ranks";

const BANDS: ChartBand[] = TIERS.map((t, i) => ({ from: i, to: i + 1, label: t.name, color: t.from }));

/** "Goud, 40%" of "Olympiër" (hoogste tier). */
function scoreLabel(score: number): string {
  const tier = tierFor(score);
  const top = TIERS.indexOf(tier) >= TIERS.length - 1;
  return top ? tier.name : `${tier.name}, ${Math.round(tierProgress(score) * 100)}%`;
}

/** Punten voor de grafiek; een stap naar een hogere tier dan ooit tevoren krijgt een ring. */
function toChartPoints(points: OverallPoint[]): ChartPoint[] {
  const out: ChartPoint[] = [];
  let best = -1;
  for (const p of points) {
    const pr = out.length > 0 && Math.floor(p.score) > Math.floor(best);
    best = Math.max(best, p.score);
    out.push({ date: p.date, value: p.score, pr, detail: pr ? `Nieuwe tier: ${tierFor(p.score).name}` : undefined });
  }
  return out;
}

/**
 * Verloop van de totaalscore over tijd, met de tiers als gekleurde zones. Teruggerekend uit de
 * trainingsgeschiedenis (zie rankReplay); alleen vanaf het moment dat de totaalrang definitief is.
 */
export function OverallTrend({ points, isMe = true }: { points: OverallPoint[]; isMe?: boolean }) {
  const chart: ChartPoint[] = useMemo(() => toChartPoints(points), [points]);

  if (chart.length < 2) return null;
  const first = chart[0];
  const last = chart.at(-1)!;
  const delta = last.value - first.value;

  return (
    <section className="space-y-3" aria-labelledby="overall-trend-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="overall-trend-heading" className="text-sm font-semibold uppercase tracking-wide text-muted">
          Totaalrang over tijd
        </h2>
        <span className={`text-xs font-semibold tabular-nums ${delta > 0.005 ? "text-accent" : "text-muted"}`}>
          {delta > 0.005 ? "+" : delta < -0.005 ? "−" : "±"}
          {Math.round(Math.abs(delta) * 100)}% van een tier
        </span>
      </div>
      <div className="card space-y-2">
        <LineChart
          points={chart}
          unit=""
          ranges
          bands={BANDS}
          formatValue={scoreLabel}
          label={isMe ? "Jouw totaalrang over tijd" : "Totaalrang over tijd"}
        />
        <p className="text-xs text-muted">
          Sinds {formatDate(first.date, { weekday: undefined, month: "short", year: "numeric" })}: van {scoreLabel(first.value)} naar{" "}
          {scoreLabel(last.value)}. Teruggerekend met {isMe ? "je" : "het"} huidige lichaamsgewicht.
        </p>
      </div>
    </section>
  );
}
