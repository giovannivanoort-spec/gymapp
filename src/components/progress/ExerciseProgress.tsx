"use client";

import Link from "next/link";
import { forwardRef, useMemo, useState } from "react";
import { ChevronRightIcon } from "@/components/Icons";
import { filterRange, LineChart, RANGES, rangesAvailable, type ChartPoint, type RangeId } from "@/components/LineChart";
import { formatDate } from "@/lib/dates";
import { isTimed } from "@/lib/exercises";
import { formatSet, nl, type HistorySet, type Session } from "@/lib/history";
import { exerciseName, groupExercises, isWeighted } from "@/lib/progress/records";

const PAGE = 8;

type Metric = "1rm" | "weight" | "volume" | "reps" | "total";

type MetricMeta = { label: string; long: string; unit: "kg" | "reps" | "s" };

const METRICS: Record<Metric, MetricMeta> = {
  "1rm": { label: "1RM", long: "Geschatte 1RM", unit: "kg" },
  weight: { label: "Zwaarste set", long: "Zwaarste set", unit: "kg" },
  volume: { label: "Volume", long: "Volume (kg × reps)", unit: "kg" },
  reps: { label: "Meeste reps", long: "Meeste reps in één set", unit: "reps" },
  total: { label: "Totaal reps", long: "Totaal reps", unit: "reps" },
};

/** Statische oefeningen (plank): de reps zijn seconden. */
const TIMED_METRICS: Partial<Record<Metric, MetricMeta>> = {
  reps: { label: "Langste set", long: "Langste set", unit: "s" },
  total: { label: "Totaal tijd", long: "Totale tijd", unit: "s" },
};

const WEIGHTED_METRICS: Metric[] = ["1rm", "weight", "volume"];
const REPS_METRICS: Metric[] = ["reps", "total"];

function heaviestSet(s: Session): HistorySet | null {
  let best: HistorySet | null = null;
  for (const x of s.sets) {
    if (!(x.weight && x.weight > 0)) continue;
    if (!best || x.weight > best.weight! || (x.weight === best.weight && (x.reps ?? 0) > (best.reps ?? 0))) best = x;
  }
  return best;
}

function metricValue(s: Session, m: Metric): number | null {
  switch (m) {
    case "1rm":
      return s.best1RM;
    case "weight":
      return heaviestSet(s)?.weight ?? null;
    case "volume":
      return s.volume > 0 ? Math.round(s.volume) : null;
    case "reps":
      return s.maxReps > 0 ? s.maxReps : null;
    case "total": {
      const t = s.sets.reduce((a, x) => a + (x.reps ?? 0), 0);
      return t > 0 ? t : null;
    }
  }
}

function metricDetail(s: Session, m: Metric): string {
  if (m === "weight") {
    const h = heaviestSet(s);
    return h ? formatSet(h) : formatSet(s.bestSet);
  }
  if (m === "volume" || m === "total") return `${s.sets.length} ${s.sets.length === 1 ? "set" : "sets"}`;
  return formatSet(s.bestSet);
}

/** Grafiek + lijst van één oefening over tijd, met records gemarkeerd (per gekozen maatstaf). */
export const ExerciseProgress = forwardRef<
  HTMLElement,
  { slug: string; options: string[]; sessions: Session[]; onChange: (slug: string) => void }
>(function ExerciseProgress({ slug, options, sessions, onChange }, ref) {
  const [showAll, setShowAll] = useState(false);
  const [metricChoice, setMetric] = useState<Metric>("1rm");
  const [range, setRange] = useState<RangeId>("all");
  const weighted = isWeighted(sessions);
  const groups = useMemo(() => groupExercises(options), [options]);
  const metricOptions = weighted ? WEIGHTED_METRICS : REPS_METRICS;
  const metric: Metric = metricOptions.includes(metricChoice) ? metricChoice : metricOptions[0];
  const meta = (isTimed(slug) && TIMED_METRICS[metric]) || METRICS[metric];
  const unit = meta.unit;

  const points: ChartPoint[] = useMemo(() => {
    let best = 0;
    const out: ChartPoint[] = [];
    for (const s of sessions) {
      const value = metricValue(s, metric);
      if (value == null) continue;
      // De eerste meting is nooit een record; daarna elk nieuw hoogste punt.
      const pr = out.length > 0 && value > best;
      best = Math.max(best, value);
      out.push({ date: s.date, value, detail: metricDetail(s, metric), pr });
    }
    return out;
  }, [sessions, metric]);

  // Kopcijfers volgen de gekozen periode van de grafiek.
  const activeRange: RangeId = rangesAvailable(points) ? range : "all";
  const inRange = useMemo(() => filterRange(points, activeRange), [points, activeRange]);
  const rangeMeta = RANGES.find((r) => r.id === activeRange)!;
  const first = inRange[0]?.value;
  const lastPoint = points.at(-1);
  const last = lastPoint?.value;
  const top = inRange.length ? Math.max(...inRange.map((p) => p.value)) : null;
  const change = first != null && inRange.length > 1 && first > 0 ? ((inRange.at(-1)!.value - first) / first) * 100 : null;

  const rows = useMemo(() => [...sessions].reverse(), [sessions]);
  const visible = showAll ? rows : rows.slice(0, PAGE);
  /** Per sessie (nieuw → oud) de meest recente eerdere sessie met een waarde, voor het verschil. */
  const previousValue = useMemo(() => {
    const out: (number | null)[] = new Array(rows.length).fill(null);
    let seen: number | null = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      out[i] = seen;
      const v = metricValue(rows[i], metric);
      if (v != null) seen = v;
    }
    return out;
  }, [rows, metric]);

  return (
    <section ref={ref} className="scroll-mt-32 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Progressie per oefening</h2>
      <div className="card space-y-4">
        <div className="flex gap-2">
          <select
            className="input min-w-0 flex-1"
            value={slug}
            onChange={(e) => {
              onChange(e.target.value);
              setShowAll(false);
            }}
            aria-label="Kies een oefening"
          >
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.slugs.map((s) => (
                  <option key={s} value={s}>
                    {exerciseName(s)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Link
            href={`/exercises/${slug}`}
            className="btn-ghost shrink-0 px-3"
            aria-label={`Details van ${exerciseName(slug)}`}
            title="Oefening bekijken"
          >
            <ChevronRightIcon />
          </Link>
        </div>

        <div className="flex rounded-xl border border-line bg-surface-2 p-0.5 text-xs font-semibold" role="group" aria-label="Maatstaf">
          {metricOptions.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              aria-pressed={metric === m}
              className={`min-w-0 flex-1 truncate rounded-[10px] px-2 py-1.5 transition ${
                metric === m ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {((isTimed(slug) && TIMED_METRICS[m]) || METRICS[m]).label}
            </button>
          ))}
        </div>

        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted">{meta.long}, laatste training</p>
            <p className="text-2xl font-extrabold tabular-nums">
              {last != null ? nl(last) : "–"} <span className="text-sm font-semibold text-muted">{unit}</span>
            </p>
            {top != null && last != null && top > last && (
              <p className="text-xs text-muted">
                Beste {activeRange === "all" ? "ooit" : rangeMeta.long}: {nl(top)} {unit}
              </p>
            )}
          </div>
          {change != null && (
            <span
              className={`shrink-0 rounded-lg px-2 py-1 text-right text-sm font-semibold tabular-nums ${
                change >= 0 ? "bg-accent/15 text-accent" : "bg-danger/15 text-danger"
              }`}
            >
              {change >= 0 ? "+" : "−"}
              {nl(Math.abs(change))}%
              <span className="block text-[10px] font-medium opacity-80">{rangeMeta.long}</span>
            </span>
          )}
        </div>

        {points.length > 1 ? (
          <LineChart
            points={points}
            unit={unit}
            ranges
            range={activeRange}
            onRange={setRange}
            label={`${meta.long} ${exerciseName(slug)}`}
          />
        ) : (
          <p className="text-sm text-muted">Na een tweede training met deze oefening verschijnt hier een grafiek.</p>
        )}
        {points.some((p) => p.pr) && (
          <p className="-mt-1 flex items-center gap-1.5 text-xs text-muted">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-accent/60 bg-accent" aria-hidden /> Nieuw record · {meta.label}
          </p>
        )}

        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Trainingen</p>
          <ul className="divide-y divide-line">
            {visible.map((s, i) => {
              const v = metricValue(s, metric);
              const pv = previousValue[i];
              const oldest = i === rows.length - 1;
              const diff = v != null && pv != null ? Math.round((v - pv) * 10) / 10 : null;
              const note =
                v == null
                  ? metric === "1rm"
                    ? "boven 12 reps"
                    : "geen gewicht"
                  : diff != null
                    ? diff === 0
                      ? "gelijk"
                      : `${diff > 0 ? "+" : "−"}${nl(Math.abs(diff))}`
                    : oldest
                      ? "eerste keer"
                      : "eerste meting";
              return (
                <li key={s.sets[0].workoutExerciseId}>
                  <Link href={`/workouts/${s.workoutId}`} className="flex items-center gap-3 py-2.5 text-sm tabular-nums transition hover:text-accent">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {formatDate(s.date, { weekday: "short", month: "short", year: "2-digit" })}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {formatSet(s.bestSet)} · {s.sets.length} {s.sets.length === 1 ? "set" : "sets"}
                        {s.volume ? ` · ${nl(s.volume, 0)} kg volume` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`block font-semibold ${v == null ? "text-muted" : ""}`}>{v != null ? `${nl(v)} ${unit}` : "–"}</span>
                      <span
                        className={`block text-xs ${diff == null || diff === 0 ? "text-muted" : diff > 0 ? "text-accent" : "text-danger"}`}
                      >
                        {note}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {rows.length > PAGE && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="btn-ghost mt-2 w-full text-sm">
              {showAll ? "Minder tonen" : `Alle ${rows.length} trainingen tonen`}
            </button>
          )}
        </div>
      </div>
    </section>
  );
});
