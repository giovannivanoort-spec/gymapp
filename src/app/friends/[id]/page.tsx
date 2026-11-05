"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { Avatar } from "@/components/Avatar";
import { usePersonSummary } from "@/components/FriendCard";
import { ChevronRightIcon } from "@/components/Icons";
import { MonthCalendar } from "@/components/MonthCalendar";
import { RankBadge } from "@/components/RankBadge";
import { WeekGoal } from "@/components/WeekGoal";
import { useCached } from "@/lib/cache";
import { formatDate, relativeDay } from "@/lib/dates";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { removeFriend, useFriends, type FriendProfile } from "@/lib/friends";
import { formatSet, nl, sessionsBySlug, type HistorySet, type Session } from "@/lib/history";
import { errorMessage, supabase } from "@/lib/supabase";

export default function FriendPage() {
  const { id } = useParams<{ id: string }>();
  const me = useUserId();
  const { profile: myProfile } = useAuth();
  const router = useRouter();
  const friends = useFriends(me);
  const isFriend = friends?.friends.some((f) => f.id === id);

  const person = useCached(
    `person:${id}`,
    async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
      return (data as FriendProfile | null) ?? null;
    },
    { persist: true },
  );
  const them = usePersonSummary(person ?? null);
  const mine = usePersonSummary((myProfile as FriendProfile | null) ?? null);

  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const trained = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of them?.history ?? []) if ((s.reps ?? 0) > 0) map.set(s.date, (map.get(s.date) ?? 0) + 1);
    return map;
  }, [them?.history]);
  const lastDay = useMemo(() => [...trained.keys()].sort().at(-1) ?? null, [trained]);
  const day = selected ?? lastDay;

  const comparison = useMemo(() => compare(them?.history, mine?.history), [them?.history, mine?.history]);
  const sessionsCount = useMemo(() => new Set((them?.history ?? []).map((s) => s.workoutId)).size, [them?.history]);

  async function unfriend() {
    if (!person || !confirm(`${person.display_name} verwijderen als vriend?`)) return;
    try {
      await removeFriend(person.id);
      router.replace("/friends");
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  const name = person?.display_name ?? "";
  const firstName = name.split(" ")[0];

  return (
    <AppShell title={name || "Vriend"} back>
      {person === undefined || friends === undefined ? (
        <div className="space-y-3">
          <div className="skeleton h-48" />
          <div className="skeleton h-72" />
        </div>
      ) : person === null || !isFriend ? (
        <div className="card space-y-3 text-sm text-muted">
          <p>Je kunt dit profiel alleen bekijken als jullie vrienden zijn.</p>
          <Link href="/friends" className="btn-ghost w-full">
            Naar vrienden
          </Link>
        </div>
      ) : (
        <div className="space-y-7">
          <section className="card animate-scale-in relative overflow-hidden p-0">
            {them?.overall && (
              <div
                className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-25 blur-3xl"
                style={{ background: them.overall.tier.from }}
              />
            )}
            <div className="relative flex items-center gap-4 p-4">
              <Avatar id={person.id} name={name} size={68} ring={them?.overall?.tier.from} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xl font-extrabold">{name}</h2>
                <p className="text-sm text-muted">
                  {them?.last ? <>Laatst getraind: {relativeDay(them.last).toLowerCase()}</> : them ? "Nog niet getraind" : "…"}
                </p>
              </div>
              {them?.tierIndex != null && (
                <Link href={`/ranks?user=${person.id}`} className="flex flex-col items-center">
                  <RankBadge tierIndex={them.tierIndex} size={48} glow />
                  <span className="mt-0.5 text-xs font-bold" style={{ color: them.overall!.tier.to }}>
                    {them.overall!.tier.name}
                  </span>
                </Link>
              )}
            </div>
            <div className="relative grid grid-cols-3 border-t border-line py-3 text-center">
              <Stat value={them ? sessionsCount : "–"} label="trainingen" />
              <Stat value={them ? trained.size : "–"} label="dagen" />
              <Stat value={them ? them.ranks?.ranks.length ?? 0 : "–"} label="ranks" />
            </div>
            <div className="relative border-t border-line">
              <WeekGoal days={them?.days ?? null} goal={them?.goal ?? person.weekly_goal ?? 3} />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Jij tegen {firstName}</h2>
              <span className="text-xs text-muted">beste prestatie</span>
            </div>
            {!them || !mine ? (
              <div className="skeleton h-40" />
            ) : comparison.length === 0 ? (
              <div className="card text-sm text-muted">
                Nog geen gezamenlijke oefeningen. Zodra jullie allebei dezelfde oefening loggen, zie je hier wie sterker is.
              </div>
            ) : (
              <div className="card divide-y divide-line p-0">
                {(showAll ? comparison : comparison.slice(0, 6)).map((c, i) => (
                  <CompareRow key={c.slug} c={c} index={i} />
                ))}
                {comparison.length > 6 && (
                  <button className="w-full py-3 text-sm font-semibold text-muted hover:text-ink" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Minder tonen" : `Alle ${comparison.length} oefeningen`}
                  </button>
                )}
              </div>
            )}
          </section>

          {them && trained.size > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Kalender</h2>
              <div className="card space-y-4">
                <MonthCalendar month={month} onMonth={setMonth} selected={day} onSelect={setSelected} trained={trained} planned={new Set()} />
                {day && <DaySets day={day} history={them.history} />}
              </div>
            </section>
          )}

          <Link href={`/ranks?user=${person.id}`} className="card flex items-center justify-between hover:border-muted">
            <span className="font-semibold">Alle ranks van {firstName}</span>
            <ChevronRightIcon className="text-muted" />
          </Link>

          <button className="w-full py-2 text-sm text-muted hover:text-danger" onClick={unfriend}>
            Verwijderen als vriend
          </button>
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

type Best = { value: number; unit: "kg" | "reps"; label: string };
type Comparison = { slug: string; them: Best; me: Best; lastDate: string };

function best(sessions: Session[]): Best {
  const withKg = sessions.filter((s) => s.best1RM != null);
  if (withKg.length) {
    const top = withKg.reduce((a, b) => (b.best1RM! > a.best1RM! ? b : a));
    return { value: top.best1RM!, unit: "kg", label: formatSet(top.bestSet) };
  }
  const top = sessions.reduce((a, b) => (b.maxReps > a.maxReps ? b : a));
  return { value: top.maxReps, unit: "reps", label: `${top.maxReps} reps` };
}

/** Oefeningen die jullie allebei gedaan hebben, met de beste prestatie van ieder. */
function compare(theirs: HistorySet[] | undefined, mine: HistorySet[] | undefined): Comparison[] {
  if (!theirs || !mine) return [];
  const a = sessionsBySlug(theirs);
  const b = sessionsBySlug(mine);
  const out: Comparison[] = [];
  for (const [slug, s] of a) {
    const m = b.get(slug);
    if (!m) continue;
    const t = best(s);
    const me = best(m);
    // Alleen vergelijken in dezelfde eenheid.
    if (t.unit !== me.unit) continue;
    out.push({ slug, them: t, me, lastDate: s.at(-1)!.date > m.at(-1)!.date ? s.at(-1)!.date : m.at(-1)!.date });
  }
  return out.sort((x, y) => y.lastDate.localeCompare(x.lastDate));
}

function CompareRow({ c, index }: { c: Comparison; index: number }) {
  const ex = EXERCISE_BY_SLUG[c.slug];
  const total = c.me.value + c.them.value || 1;
  const myShare = c.me.value / total;
  const iWin = c.me.value > c.them.value;
  const tie = c.me.value === c.them.value;
  const fmt = (b: Best) => (b.unit === "kg" ? `${nl(b.value)} kg` : `${b.value}`);
  return (
    <Link
      href={`/exercises/${c.slug}`}
      className="animate-fade-up block space-y-2 px-4 py-3 hover:bg-surface-2/40"
      style={{ "--i": Math.min(index, 8) } as React.CSSProperties}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-sm font-semibold">{ex?.name ?? c.slug}</p>
        <span className="shrink-0 text-[11px] text-muted">{c.me.unit === "kg" ? "geschatte 1RM" : "max reps"}</span>
      </div>
      <div className="flex items-center gap-3 text-sm tabular-nums">
        <span className={`w-16 shrink-0 font-bold ${iWin ? "text-accent" : tie ? "" : "text-muted"}`}>{fmt(c.me)}</span>
        <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className={`h-full rounded-l-full ${iWin ? "bg-accent" : "bg-accent/40"}`}
            style={{ width: `${myShare * 100}%`, transition: "width 0.8s cubic-bezier(0.2,0.8,0.2,1)" }}
          />
          <div className={`h-full flex-1 rounded-r-full ${!iWin && !tie ? "bg-[#7cc4ff]" : "bg-[#7cc4ff]/40"}`} />
        </div>
        <span className={`w-16 shrink-0 text-right font-bold ${!iWin && !tie ? "text-[#7cc4ff]" : "text-muted"}`}>{fmt(c.them)}</span>
      </div>
      <div className="flex justify-between text-[11px] text-muted">
        <span>Jij · {c.me.label}</span>
        <span>{c.them.label}</span>
      </div>
    </Link>
  );
}

/** Sets van één dag, per oefening. */
function DaySets({ day, history }: { day: string; history: HistorySet[] }) {
  const byWorkout = useMemo(() => {
    const sets = history.filter((s) => s.date === day && (s.reps ?? 0) > 0);
    const map = new Map<string, { title: string; exercises: Map<string, HistorySet[]> }>();
    for (const s of sets) {
      const w = map.get(s.workoutId) ?? { title: s.workoutTitle, exercises: new Map() };
      w.exercises.set(s.workoutExerciseId, [...(w.exercises.get(s.workoutExerciseId) ?? []), s]);
      map.set(s.workoutId, w);
    }
    return [...map.values()];
  }, [day, history]);

  return (
    <div className="space-y-3 border-t border-line pt-4">
      <p className="text-sm font-semibold capitalize">{formatDate(day, { weekday: "long", day: "numeric", month: "long" })}</p>
      {byWorkout.length === 0 ? (
        <p className="text-sm text-muted">Geen sets gelogd op deze dag.</p>
      ) : (
        byWorkout.map((w) => (
          <div key={w.title} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{w.title}</p>
            {[...w.exercises.values()].map((sets) => {
              const sorted = [...sets].sort((a, b) => a.setNumber - b.setNumber);
              return (
                <div key={sorted[0].workoutExerciseId} className="rounded-xl bg-surface-2 px-3 py-2">
                  <p className="text-sm font-semibold">{EXERCISE_BY_SLUG[sorted[0].slug]?.name ?? sorted[0].slug}</p>
                  <p className="text-xs tabular-nums text-muted">{sorted.map((s) => formatSet(s)).join("  ·  ")}</p>
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
