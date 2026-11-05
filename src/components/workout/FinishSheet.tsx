"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, SparkleIcon, TrophyIcon } from "@/components/Icons";
import { Sheet } from "@/components/Sheet";
import { EXERCISE_BY_SLUG, isTimed } from "@/lib/exercises";
import { postFinished } from "@/lib/offlineQueue";
import type { GroupMember, WorkoutExercise } from "@/lib/types";
import {
  beats,
  bestOf,
  describeBest,
  doneSets,
  fmtBig,
  fmtSet,
  isDone,
  logsBySlug,
  plannedSets,
  prevSessions,
  repsOf,
  volumeOf,
  type FullWorkout,
  type HistRow,
  type LogRow,
} from "./logic";

const SHARE_KEY = "gymapp-share-finished";

function loadShare(): boolean {
  try {
    return localStorage.getItem(SHARE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Aantal records van iemand in deze training (ten opzichte van alle eerdere trainingen). */
function countRecords(exercises: WorkoutExercise[], sets: LogRow[], history: HistRow[] | undefined): number | undefined {
  if (!history) return undefined;
  const before = logsBySlug(history);
  const slugs = new Set(exercises.map((e) => e.exercise_slug));
  let n = 0;
  for (const slug of slugs) {
    const ids = new Set(exercises.filter((e) => e.exercise_slug === slug).map((e) => e.id));
    const today = bestOf(sets.filter((l) => ids.has(l.workout_exercise_id)), slug);
    if (today?.set && beats(today.set, bestOf(before.get(slug) ?? [], slug))) n++;
  }
  return n;
}

/** "45 s", "2 min" of "2 min 30 s". */
function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

/** Samenvatting na de training: sets, volume, records en vergelijking met vorige keer. */
export function FinishSheet({
  open,
  onClose,
  workout,
  exercises,
  members,
  logs,
  uid,
  userId,
  history,
  historyFor,
  canShareFor,
  nameOf,
}: {
  open: boolean;
  onClose: () => void;
  workout: FullWorkout;
  exercises: WorkoutExercise[];
  members: GroupMember[];
  logs: LogRow[];
  /** Voor wie de samenvatting is. */
  uid: string;
  userId: string;
  history: HistRow[] | undefined;
  /** Eerdere sets van een ander lid (voor het aantal records in de groepsfeed), als die geladen zijn. */
  historyFor?: (uid: string) => HistRow[] | undefined;
  /** Mag "training afgerond" voor dit lid in de groepsfeed worden gezet? Zonder: niet delen. */
  canShareFor?: (uid: string) => boolean;
  nameOf: (uid: string) => string;
}) {
  const [share, setShare] = useState(loadShare);
  const mine = logs.filter((l) => l.user_id === uid && isDone(l));
  const planned = plannedSets(exercises, logs, uid);
  const done = mine.length;
  // Statische oefeningen (plank, wall sit): reps zijn seconden, die tellen apart als tijd.
  const timedIds = new Set(exercises.filter((e) => isTimed(e.exercise_slug)).map((e) => e.id));
  const repSets = mine.filter((l) => !timedIds.has(l.workout_exercise_id));
  const volume = volumeOf(repSets);
  const reps = repsOf(repSets);
  const seconds = repsOf(mine.filter((l) => timedIds.has(l.workout_exercise_id)));
  const times = mine.map((l) => Date.parse(l.created_at)).filter((t) => Number.isFinite(t) && t > 0);
  const minutes = times.length >= 2 ? Math.round((Math.max(...times) - Math.min(...times)) / 60000) : null;
  const prev = prevSessions(history, workout.date);
  const allBefore = logsBySlug(history);
  const who = uid === userId ? "Jij" : nameOf(uid);

  const perExercise = exercises.map((we) => {
    const sets = mine.filter((l) => l.workout_exercise_id === we.id).sort((a, b) => a.set_number - b.set_number);
    const p = prev[we.exercise_slug];
    const todayVol = volumeOf(sets);
    const prevVol = p ? volumeOf(p.sets) : 0;
    const todayReps = repsOf(sets);
    const prevReps = p ? repsOf(p.sets) : 0;
    let delta: number | null = null;
    if (sets.length && p) {
      if (todayVol > 0 && prevVol > 0) delta = (todayVol - prevVol) / prevVol;
      else if (todayVol === 0 && prevVol === 0 && prevReps > 0) delta = (todayReps - prevReps) / prevReps;
    }
    const sessionBest = bestOf(sets, we.exercise_slug);
    const record =
      sessionBest?.set && beats(sessionBest.set, bestOf(allBefore.get(we.exercise_slug) ?? [], we.exercise_slug)) ? describeBest(sessionBest, we.exercise_slug) : null;
    return { we, sets, delta, record, name: EXERCISE_BY_SLUG[we.exercise_slug]?.name ?? we.exercise_slug };
  });
  const records = perExercise.filter((e) => e.record);
  const coachHref = `/coach?workout=${workout.id}&q=${encodeURIComponent(
    `Kijk de training "${workout.title}" van ${workout.date} na. Hoe ging het en wat moet ik volgende keer anders doen?`,
  )}`;

  // Wie er in de groepsfeed komt: jijzelf, of als trainer iedereen die vandaag sets heeft gedaan.
  const sharers = canShareFor ? members.map((m) => m.user_id).filter((id) => canShareFor(id) && doneSets(logs, id) > 0) : [];
  const shareLabel =
    sharers.length === 0
      ? null
      : sharers.length === 1 && sharers[0] === userId
        ? "Deel “training afgerond” in de groepsfeed"
        : sharers.length === 1
          ? `Deel “training afgerond” van ${nameOf(sharers[0])} in de groepsfeed`
          : `Deel “training afgerond” van ${sharers.length} personen in de groepsfeed`;

  function toggleShare(on: boolean) {
    setShare(on);
    try {
      localStorage.setItem(SHARE_KEY, on ? "1" : "0");
    } catch {
      // niet onthouden is geen probleem
    }
  }

  /** Zet de samenvatting in de groepsfeed (één per training en lid; opnieuw delen werkt hem bij). */
  function shareFinished() {
    if (!share) return;
    for (const id of sharers) {
      const sets = logs.filter((l) => l.user_id === id && isDone(l));
      const prs = countRecords(exercises, sets, id === uid ? history : historyFor?.(id));
      // Via de wachtrij: offline (of met sets die nog wachten) gaat het bericht pas weg als die sets
      // zijn opgeslagen, zodat de groep geen "klaar" ziet zonder de sets erbij.
      postFinished(
        {
          groupId: workout.group_id,
          userId: id,
          workoutId: workout.id,
          type: "finished",
          payload: {
            sets: sets.length,
            volume: Math.round(volumeOf(sets)),
            exercises: new Set(sets.map((l) => l.workout_exercise_id)).size,
            ...(prs != null ? { prs } : {}),
          },
        },
        exercises.map((e) => e.id),
        userId,
      ).catch(() => {});
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={uid === userId ? "Jouw samenvatting" : `Samenvatting · ${who}`}>
      <div className="space-y-5">
        {done === 0 ? (
          <div className="rounded-xl bg-surface-2 p-4 text-sm text-muted">
            Nog geen sets gelogd. Rond een set af met de vinkknop, dan zie je hier je volume, records en de vergelijking met vorige keer.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Sets" value={`${done}/${planned}`} accent={done >= planned} i={0} />
              <Stat
                label={volume > 0 ? "Volume" : reps > 0 || seconds === 0 ? "Reps" : "Tijd"}
                value={volume > 0 ? `${fmtBig(volume)} kg` : reps > 0 || seconds === 0 ? String(reps) : fmtDuration(seconds)}
                i={1}
              />
              <Stat label="Duur" value={minutes != null && minutes < 360 ? `${minutes} min` : "–"} i={2} />
            </div>

            {records.length > 0 && (
              <section className="space-y-2">
                <h3 className="label">Persoonlijke records</h3>
                <ul className="space-y-1.5">
                  {records.map((r, i) => (
                    <li
                      key={r.we.id}
                      className="animate-fade-up flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5"
                      style={{ "--i": i + 3 } as React.CSSProperties}
                    >
                      <TrophyIcon size={18} className="shrink-0 text-accent" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{r.name}</p>
                        <p className="text-xs text-muted">{r.record}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="space-y-2">
              <h3 className="label">Per oefening</h3>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {perExercise.map((e) => (
                  <li key={e.we.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{e.name}</p>
                      <p className="text-xs text-muted">{e.sets.length ? e.sets.map((l) => fmtSet(l, e.we.exercise_slug)).join(" · ") : "Niet gedaan"}</p>
                    </div>
                    {e.delta != null && Math.abs(e.delta) >= 0.005 && (
                      <span
                        className={`inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold tabular-nums ${e.delta > 0 ? "text-accent" : "text-muted"}`}
                        title="Volume ten opzichte van vorige keer"
                      >
                        {e.delta > 0 ? <ArrowUpIcon size={12} /> : <ArrowDownIcon size={12} />}
                        {Math.round(Math.abs(e.delta) * 100)}%
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">Percentages: volume (gewicht × reps) ten opzichte van de vorige keer.</p>
            </section>
          </>
        )}

        {members.length > 1 && (
          <section className="space-y-2">
            <h3 className="label">De groep vandaag</h3>
            <ul className="space-y-2">
              {members.map((m) => {
                const d = doneSets(logs, m.user_id);
                const pl = plannedSets(exercises, logs, m.user_id);
                const vol = volumeOf(logs.filter((l) => l.user_id === m.user_id && isDone(l)));
                return (
                  <li key={m.user_id} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{m.user_id === userId ? "Jij" : (m.profiles?.display_name ?? "Onbekend")}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted">
                        {d}/{pl} sets{vol > 0 ? ` · ${fmtBig(vol)} kg` : ""}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-500"
                        style={{ width: `${pl ? Math.min(100, (d / pl) * 100) : 0}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className="grid gap-2 pt-1">
          <Link href={coachHref} className="btn-ghost w-full">
            <SparkleIcon className="text-accent" /> Laat de coach deze training nakijken
          </Link>
          {shareLabel && (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 accent-[var(--color-accent)]"
                checked={share}
                onChange={(e) => toggleShare(e.target.checked)}
              />
              <span className="min-w-0">{shareLabel}</span>
            </label>
          )}
          <Link href={`/groups/${workout.group_id}`} className="btn-primary w-full" onClick={shareFinished}>
            Klaar, terug naar de groep
          </Link>
        </div>
      </div>
    </Sheet>
  );
}

function Stat({ label, value, accent, i }: { label: string; value: string; accent?: boolean; i: number }) {
  return (
    <div className="animate-fade-up rounded-xl bg-surface-2 px-3 py-2.5" style={{ "--i": i } as React.CSSProperties}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 truncate text-lg font-bold tabular-nums ${accent ? "text-accent" : ""}`}>{value}</p>
    </div>
  );
}
