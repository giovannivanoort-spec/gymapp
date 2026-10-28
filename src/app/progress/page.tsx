"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useUserId } from "@/components/AuthProvider";
import { ChevronRightIcon } from "@/components/Icons";
import { LineChart } from "@/components/LineChart";
import { MonthCalendar } from "@/components/MonthCalendar";
import { ProgressBodyweight } from "@/components/ProgressBodyweight";
import { WeeklyVolume } from "@/components/WeeklyVolume";
import { formatDate, toISODate } from "@/lib/dates";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { fetchHistory, formatSet, nl, sessionsBySlug, type HistorySet, type Session } from "@/lib/history";
import { estimate1RM } from "@/lib/ranks";
import { supabase } from "@/lib/supabase";

export default function ProgressPage() {
  const userId = useUserId();
  const [history, setHistory] = useState<HistorySet[] | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [planned, setPlanned] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [exercise, setExercise] = useState<string | null>(null);

  useEffect(() => {
    fetchHistory(userId).then(setHistory);
  }, [userId]);

  // Geplande groepstrainingen in de getoonde maand.
  useEffect(() => {
    const from = toISODate(month);
    const to = toISODate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    supabase
      .from("workouts")
      .select("date")
      .gte("date", from)
      .lte("date", to)
      .then(({ data }) => setPlanned(new Set((data ?? []).map((w) => w.date))));
  }, [month]);

  const sessions = useMemo(() => (history ? sessionsBySlug(history) : new Map<string, Session[]>()), [history]);

  const trained = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of history ?? []) if ((s.reps ?? 0) > 0) map.set(s.date, (map.get(s.date) ?? 0) + 1);
    return map;
  }, [history]);

  // Standaard: de laatste getrainde dag selecteren.
  const lastTrained = useMemo(() => [...trained.keys()].sort().at(-1) ?? null, [trained]);
  const day = selected ?? lastTrained;

  const exercises = useMemo(
    () => [...sessions].sort((a, b) => b[1].length - a[1].length).map(([slug]) => slug),
    [sessions],
  );
  const currentExercise = exercise ?? exercises[0] ?? null;

  const monthKey = toISODate(month).slice(0, 7);
  const monthSets = (history ?? []).filter((s) => s.date.startsWith(monthKey) && (s.reps ?? 0) > 0);
  const monthStats = {
    sessions: new Set(monthSets.map((s) => s.workoutId)).size,
    sets: monthSets.length,
    volume: monthSets.reduce((v, s) => v + (s.weight ?? 0) * (s.reps ?? 0), 0),
  };

  return (
    <AppShell title="Progressie">
      {history === null ? (
        <div className="space-y-3">
          <div className="skeleton h-80" />
          <div className="skeleton h-40" />
        </div>
      ) : history.length === 0 ? (
        <div className="space-y-7">
          <div className="card space-y-2 text-sm text-muted">
            <p className="font-semibold text-ink">Nog geen trainingen gelogd</p>
            <p>Zodra je sets invult bij een training, zie je hier je kalender, grafieken en records.</p>
          </div>
          <ProgressBodyweight />
        </div>
      ) : (
        <div className="space-y-7">
          <section className="card animate-scale-in space-y-4">
            <MonthCalendar
              month={month}
              onMonth={setMonth}
              selected={day}
              onSelect={setSelected}
              trained={trained}
              planned={planned}
            />
            <div className="grid grid-cols-3 border-t border-line pt-3 text-center">
              <Stat value={monthStats.sessions} label="trainingen" />
              <Stat value={monthStats.sets} label="sets" />
              <Stat value={monthStats.volume >= 1000 ? `${nl(monthStats.volume / 1000)}t` : nl(monthStats.volume, 0)} label="kg volume" />
            </div>
          </section>

          {day && <DayDetail day={day} history={history} sessions={sessions} plannedOnly={planned.has(day) && !trained.has(day)} />}

          <WeeklyVolume history={history} />

          {currentExercise && (
            <ExerciseProgress
              slug={currentExercise}
              options={exercises}
              sessions={sessions.get(currentExercise) ?? []}
              onChange={setExercise}
            />
          )}

          <ProgressBodyweight />

          <Records sessions={sessions} />
        </div>
      )}
    </AppShell>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="[&:not(:first-child)]:border-l [&:not(:first-child)]:border-line">
      <p className="text-xl font-extrabold tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

/** Resultaten van één dag, per training en oefening, met records gemarkeerd. */
function DayDetail({
  day,
  history,
  sessions,
  plannedOnly,
}: {
  day: string;
  history: HistorySet[];
  sessions: Map<string, Session[]>;
  plannedOnly: boolean;
}) {
  const sets = history.filter((s) => s.date === day);
  const workouts = [...new Set(sets.map((s) => s.workoutId))];

  return (
    <section key={day} className="animate-fade-up space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{formatDate(day)}</h2>
      {sets.length === 0 ? (
        <div className="card text-sm text-muted">{plannedOnly ? "Er stond een training gepland, maar je hebt niets gelogd." : "Geen training op deze dag."}</div>
      ) : (
        workouts.map((wid) => {
          const ws = sets.filter((s) => s.workoutId === wid);
          const byExercise = [...new Set(ws.map((s) => s.workoutExerciseId))]
            .map((weId) => ws.filter((s) => s.workoutExerciseId === weId).sort((a, b) => a.setNumber - b.setNumber))
            .sort((a, b) => a[0].position - b[0].position);
          return (
            <div key={wid} className="card space-y-4">
              <Link href={`/workouts/${wid}`} className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-bold">{ws[0].workoutTitle}</p>
                  {ws[0].groupName && <p className="text-xs text-muted">{ws[0].groupName}</p>}
                </div>
                <ChevronRightIcon className="text-muted" />
              </Link>
              {byExercise.map((exSets) => {
                const slug = exSets[0].slug;
                // Beste 1RM vóór deze dag, om records te herkennen.
                const before = (sessions.get(slug) ?? []).filter((s) => s.date < day).map((s) => s.best1RM ?? 0);
                const prevBest = Math.max(0, ...before);
                const best = Math.max(0, ...exSets.map((s) => estimate1RM(s.weight ?? 0, s.reps ?? 0) ?? 0));
                return (
                  <div key={exSets[0].workoutExerciseId} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link href={`/exercises/${slug}`} className="text-sm font-semibold hover:text-accent">
                        {EXERCISE_BY_SLUG[slug]?.name ?? slug}
                      </Link>
                      <span className="text-xs text-muted">
                        doel {exSets[0].targetSets} × {exSets[0].targetReps}
                      </span>
                    </div>
                    <table className="w-full text-sm tabular-nums">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                          <th className="w-10 py-1 font-medium">Set</th>
                          <th className="py-1 font-medium">Kg</th>
                          <th className="py-1 font-medium">Reps</th>
                          <th className="py-1 text-right font-medium">1RM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {exSets.map((s) => {
                          const e = estimate1RM(s.weight ?? 0, s.reps ?? 0);
                          const isPR = e != null && e === best && before.length > 0 && e > prevBest;
                          return (
                            <tr key={s.setNumber} className="border-t border-line">
                              <td className="py-1.5 text-muted">{s.setNumber}</td>
                              <td className="py-1.5">{s.weight != null ? nl(s.weight) : "–"}</td>
                              <td className="py-1.5">{s.reps ?? "–"}</td>
                              <td className="py-1.5 text-right">
                                {isPR && (
                                  <span className="mr-2 rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">PR</span>
                                )}
                                {e != null ? nl(e) : <span className="text-muted">–</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </section>
  );
}

/** Grafiek + tabel van één oefening over tijd. */
function ExerciseProgress({
  slug,
  options,
  sessions,
  onChange,
}: {
  slug: string;
  options: string[];
  sessions: Session[];
  onChange: (slug: string) => void;
}) {
  const weighted = sessions.some((s) => s.best1RM != null);
  const points = sessions
    .filter((s) => (weighted ? s.best1RM != null : s.maxReps > 0))
    .map((s) => ({ date: s.date, value: weighted ? s.best1RM! : s.maxReps, detail: formatSet(s.bestSet) }));
  const first = points[0]?.value;
  const last = points.at(-1)?.value;
  const change = first != null && last != null && first > 0 ? ((last - first) / first) * 100 : null;
  const rows = [...sessions].reverse();

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Progressie per oefening</h2>
      </div>
      <div className="card space-y-4">
        <select
          className="input"
          value={slug}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Kies een oefening"
        >
          {options.map((s) => (
            <option key={s} value={s}>
              {EXERCISE_BY_SLUG[s]?.name ?? s}
            </option>
          ))}
        </select>

        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted">{weighted ? "Beste geschatte 1RM per training" : "Meeste reps per training"}</p>
            <p className="text-2xl font-extrabold tabular-nums">
              {last != null ? nl(last) : "–"} <span className="text-sm font-semibold text-muted">{weighted ? "kg" : "reps"}</span>
            </p>
          </div>
          {change != null && points.length > 1 && (
            <span
              className={`rounded-lg px-2 py-1 text-sm font-semibold tabular-nums ${
                change >= 0 ? "bg-accent/15 text-accent" : "bg-danger/15 text-danger"
              }`}
            >
              {change >= 0 ? "+" : ""}
              {nl(change)}% sinds start
            </span>
          )}
        </div>

        {points.length > 1 ? (
          <LineChart points={points} unit={weighted ? "kg" : "reps"} />
        ) : (
          <p className="text-sm text-muted">Na een tweede training met deze oefening verschijnt hier een grafiek.</p>
        )}

        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[420px] text-sm tabular-nums">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1.5 font-medium">Datum</th>
                <th className="py-1.5 font-medium">Beste set</th>
                <th className="py-1.5 text-right font-medium">{weighted ? "1RM" : "Reps"}</th>
                <th className="py-1.5 text-right font-medium">Volume</th>
                <th className="py-1.5 text-right font-medium">Verschil</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => {
                const prev = rows[i + 1];
                const v = weighted ? s.best1RM : s.maxReps;
                const pv = prev ? (weighted ? prev.best1RM : prev.maxReps) : null;
                const diff = v != null && pv != null ? v - pv : null;
                return (
                  <tr key={s.workoutId + s.date} className="border-t border-line">
                    <td className="py-2">
                      <Link href={`/workouts/${s.workoutId}`} className="hover:text-accent">
                        {formatDate(s.date, { weekday: undefined, month: "short", year: "2-digit" })}
                      </Link>
                    </td>
                    <td className="py-2">{formatSet(s.bestSet)}</td>
                    <td className="py-2 text-right font-semibold">{v != null ? nl(v) : "–"}</td>
                    <td className="py-2 text-right text-muted">{s.volume ? nl(s.volume, 0) : "–"}</td>
                    <td
                      className={`py-2 text-right ${diff == null || diff === 0 ? "text-muted" : diff > 0 ? "text-accent" : "text-danger"}`}
                    >
                      {diff == null ? "–" : `${diff > 0 ? "+" : ""}${nl(diff)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** Beste prestatie per oefening. */
function Records({ sessions }: { sessions: Map<string, Session[]> }) {
  const rows = [...sessions]
    .map(([slug, list]) => {
      const weighted = list.some((s) => s.best1RM != null);
      const best = list.reduce((a, b) => ((weighted ? (b.best1RM ?? 0) > (a.best1RM ?? 0) : b.maxReps > a.maxReps) ? b : a));
      return { slug, weighted, best, count: list.length };
    })
    .sort((a, b) => (EXERCISE_BY_SLUG[a.slug]?.name ?? a.slug).localeCompare(EXERCISE_BY_SLUG[b.slug]?.name ?? b.slug));

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Records</h2>
      <div className="card -mx-0 overflow-x-auto p-0">
        <table className="w-full min-w-[460px] text-sm tabular-nums">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5 font-medium">Oefening</th>
              <th className="py-2.5 font-medium">Beste set</th>
              <th className="py-2.5 text-right font-medium">1RM / reps</th>
              <th className="py-2.5 text-right font-medium">Datum</th>
              <th className="px-4 py-2.5 text-right font-medium">Sessies</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug} className="border-t border-line first:border-0">
                <td className="px-4 py-2.5">
                  <Link href={`/exercises/${r.slug}`} className="font-medium hover:text-accent">
                    {EXERCISE_BY_SLUG[r.slug]?.name ?? r.slug}
                  </Link>
                </td>
                <td className="py-2.5 text-muted">{formatSet(r.best.bestSet)}</td>
                <td className="py-2.5 text-right font-semibold">
                  {r.weighted ? `${nl(r.best.best1RM ?? 0)} kg` : `${r.best.maxReps} reps`}
                </td>
                <td className="py-2.5 text-right text-muted">
                  {formatDate(r.best.date, { weekday: undefined, month: "short", year: "2-digit" })}
                </td>
                <td className="px-4 py-2.5 text-right text-muted">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
