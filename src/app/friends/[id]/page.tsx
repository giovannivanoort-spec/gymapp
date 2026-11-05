"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { Avatar } from "@/components/Avatar";
import { usePersonSummary, type PersonSummary } from "@/components/FriendCard";
import { CheckIcon, ChevronRightIcon, CloseIcon, TrophyIcon, UserPlusIcon, UsersIcon } from "@/components/Icons";
import { MonthCalendar } from "@/components/MonthCalendar";
import { RankBadge } from "@/components/RankBadge";
import { Sheet } from "@/components/Sheet";
import { ConfirmSheet } from "@/components/social/ConfirmSheet";
import { DuelChart, type DuelPoint } from "@/components/social/DuelChart";
import { RetryIcon } from "@/components/social/icons";
import { toast } from "@/components/ui/Toast";
import { WeekGoal } from "@/components/WeekGoal";
import { fetchCached, useCached } from "@/lib/cache";
import { formatDate, relativeDay, toISODate } from "@/lib/dates";
import { EXERCISE_BY_SLUG, isTimed } from "@/lib/exercises";
import {
  daysAgo,
  friendErrorMessage,
  recentWorkouts,
  refreshFriends,
  removeFriend,
  requestFriend,
  respondFriend,
  setFriendsFlash,
  useFriends,
  useFriendsRealtime,
  useFriendsStatus,
  type FriendProfile,
  type PersonalRecord,
  type RecentWorkout,
} from "@/lib/friends";
import { formatSet, nl, sessionsBySlug, type HistorySet, type Session } from "@/lib/history";
import { fetchPublicProfile } from "@/lib/supabase";
import { weekRange } from "@/lib/week";

/** Kleur van de vriend in vergelijkingen (thema-token als die bestaat). */
const RIVAL = "var(--color-rival, #7cc4ff)";

function monthStart(iso: string | null): Date {
  const d = iso ? new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, 1) : new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export default function FriendPage() {
  const { id } = useParams<{ id: string }>();
  const me = useUserId();
  const { profile: myProfile } = useAuth();
  const router = useRouter();
  const friends = useFriends(me);
  const friendsStatus = useFriendsStatus(me);
  useFriendsRealtime(me);
  const isFriend = friends?.friends.some((f) => f.id === id);

  const [personError, setPersonError] = useState(false);
  const personKey = `person:${id}`;
  const loadPerson = async () => {
    try {
      // Alleen openbare kolommen: voedingsdoelen van een ander blijven privé (ook in de cache).
      const data = await fetchPublicProfile(id);
      setPersonError(false);
      return (data as FriendProfile | null) ?? null;
    } catch (err) {
      setPersonError(true);
      throw err;
    }
  };
  const person = useCached(personKey, loadPerson, { persist: true });
  const [leaving, setLeaving] = useState(false);
  // Geschiedenis en ranks alleen ophalen voor vrienden: een vreemde ziet er toch niets van.
  const showsTraining = !!isFriend || leaving;
  const them = usePersonSummary(showsTraining ? (person ?? null) : null);
  const mine = usePersonSummary(showsTraining ? ((myProfile as FriendProfile | null) ?? null) : null);

  const [monthOverride, setMonthOverride] = useState<Date | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [duel, setDuel] = useState<Comparison | null>(null);
  const [duelOpen, setDuelOpen] = useState(false);

  const trained = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of them?.history ?? []) if ((s.reps ?? 0) > 0) map.set(s.date, (map.get(s.date) ?? 0) + 1);
    return map;
  }, [them?.history]);
  const lastDay = useMemo(() => [...trained.keys()].sort().at(-1) ?? null, [trained]);
  const day = selected ?? lastDay;
  // Kalender opent op de maand van de gekozen (of laatste) trainingsdag, tot je zelf bladert.
  const month = monthOverride ?? monthStart(day);

  const comparison = useMemo(() => compare(them?.history, mine?.history), [them?.history, mine?.history]);
  const recent = useMemo(() => (them ? recentWorkouts(them.history, 5) : []), [them]);
  const prs = useMemo(() => {
    if (!them) return [];
    const last30 = them.prs.filter((p) => daysAgo(p.date) <= 30);
    return (last30.length >= 3 ? last30 : them.prs).slice(0, 5);
  }, [them]);
  const prWorkouts = useMemo(() => new Set((them?.prs ?? []).map((p) => `${p.workoutId}:${p.slug}`)), [them]);
  const together = useMemo(() => trainedTogether(them?.history, mine?.history), [them?.history, mine?.history]);

  async function unfriend() {
    if (!person) return;
    // Profiel blijft staan tot we weg zijn genavigeerd (geen flits van "jullie zijn geen vrienden").
    setLeaving(true);
    try {
      await removeFriend(person.id);
    } catch (err) {
      setLeaving(false);
      throw new Error(friendErrorMessage(err));
    }
    setFriendsFlash(`Je bent geen vrienden meer met ${person.display_name.split(" ")[0]}`);
    router.replace("/friends");
  }

  function retry() {
    if (personError) {
      setPersonError(false);
      fetchCached(personKey, loadPerson, true).catch(() => {});
    }
    refreshFriends(me).catch(() => {});
  }

  function pickDay(iso: string) {
    setSelected(iso);
    setMonthOverride(null);
  }

  const name = person?.display_name ?? "";
  const firstName = name.split(" ")[0];
  // De bewaarde lijst kan verouderd zijn (bijv. net via je code toegevoegd): pas "geen vrienden" tonen
  // als de lijst in deze sessie van de server kwam (of dat niet lukt: dan de laatst bekende stand).
  const checkingFriendship = friends !== undefined && !isFriend && !leaving && !friendsStatus.verified && !friendsStatus.error;
  const failed = (person === undefined && personError) || (friends === undefined && friendsStatus.error);

  return (
    <AppShell title={name || "Vriend"} back>
      {failed ? (
        <div className="card space-y-3 text-center">
          <p className="text-sm text-muted">Kon dit profiel niet laden. Controleer je verbinding.</p>
          <button className="btn-ghost w-full" onClick={retry}>
            <RetryIcon size={15} /> Opnieuw proberen
          </button>
        </div>
      ) : person === undefined || friends === undefined || checkingFriendship ? (
        <div className="space-y-3" aria-busy>
          <div className="skeleton h-56" />
          <div className="skeleton h-40" />
          <div className="skeleton h-72" />
        </div>
      ) : person === null || person.id === me ? (
        <div className="card animate-fade-up flex flex-col items-center gap-3 px-6 py-8 text-center">
          {person && <Avatar id={person.id} name={person.display_name} src={person.avatar_url} size={56} />}
          <p className="text-sm text-muted">{person ? "Dit is je eigen profiel." : "Dit profiel bestaat niet (meer)."}</p>
          <Link href={person ? "/profile" : "/friends"} className="btn-ghost w-full">
            {person ? "Naar je profiel" : "Naar vrienden"}
          </Link>
        </div>
      ) : !isFriend && !leaving ? (
        <NonFriend
          person={person}
          incoming={friends.incoming.some((p) => p.id === person.id)}
          outgoing={friends.outgoing.some((p) => p.id === person.id)}
        />
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
              <Avatar id={person.id} name={name} src={person.avatar_url} size={68} ring={them?.overall?.tier.from} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xl font-extrabold">{name}</h2>
                <p className="text-sm text-muted">
                  {them?.last ? <>Laatst getraind: {relativeDay(them.last).toLowerCase()}</> : them ? "Nog niet getraind" : <span className="skeleton inline-block h-3 w-32 align-middle" />}
                </p>
                {them && them.streak > 0 && (
                  <p className="mt-0.5 text-xs font-semibold text-accent">
                    {them.streak} {them.streak === 1 ? "week" : "weken"} op rij weekdoel gehaald
                  </p>
                )}
              </div>
              {them?.tierIndex != null && (
                <Link href={`/ranks?user=${person.id}`} className="flex flex-col items-center" aria-label={`Rang ${them.overall!.tier.name}, bekijk ranks`}>
                  <RankBadge tierIndex={them.tierIndex} size={48} glow />
                  <span className="mt-0.5 text-xs font-bold" style={{ color: them.overall!.tier.to }}>
                    {them.overall!.tier.name}
                  </span>
                </Link>
              )}
            </div>
            <div className="relative grid grid-cols-3 border-t border-line py-3 text-center">
              <Stat value={them?.sessions} label="trainingen" />
              <Stat value={them ? trained.size : undefined} label="dagen" />
              <Stat value={them?.prs.length} label="records" />
            </div>
            <div className="relative border-t border-line">
              <WeekGoal days={them?.days ?? null} goal={them?.goal ?? person.weekly_goal ?? 3} />
            </div>
          </section>

          <Together them={them} mine={mine} together={together} firstName={firstName} />

          {them && prs.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recente records</h2>
                <span className="text-xs text-muted">{them.prs.length} in totaal</span>
              </div>
              <div className="card divide-y divide-line p-0">
                {prs.map((p, i) => (
                  <PrRow key={`${p.workoutId}:${p.slug}`} pr={p} index={i} />
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Laatste trainingen</h2>
            {!them ? (
              <div className="space-y-2">
                <div className="skeleton h-28" />
                <div className="skeleton h-28" />
              </div>
            ) : recent.length === 0 ? (
              <div className="card text-sm text-muted">{firstName} heeft nog geen sets gelogd.</div>
            ) : (
              <div className="space-y-2">
                {recent.map((w, i) => (
                  <RecentWorkoutCard key={w.workoutId} w={w} index={i} prWorkouts={prWorkouts} onDay={pickDay} />
                ))}
              </div>
            )}
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
              <>
                <Scoreboard comparison={comparison} firstName={firstName} />
                <div className="card divide-y divide-line p-0">
                  {(showAll ? comparison : comparison.slice(0, 6)).map((c, i) => (
                    <CompareRow
                      key={c.slug}
                      c={c}
                      index={i}
                      onOpen={() => {
                        setDuel(c);
                        setDuelOpen(true);
                      }}
                    />
                  ))}
                  {comparison.length > 6 && (
                    <button
                      className="w-full py-3 text-sm font-semibold text-muted hover:text-ink"
                      onClick={() => setShowAll((v) => !v)}
                      aria-expanded={showAll}
                    >
                      {showAll ? "Minder tonen" : `Alle ${comparison.length} oefeningen`}
                    </button>
                  )}
                </div>
              </>
            )}
          </section>

          {them && trained.size > 0 && (
            <section id="kalender" className="scroll-mt-20 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Kalender</h2>
              <div className="card space-y-4">
                <MonthCalendar month={month} onMonth={setMonthOverride} selected={day} onSelect={pickDay} trained={trained} planned={new Set()} />
                {day && <DaySets day={day} history={them.history} />}
              </div>
            </section>
          )}

          <Link href={`/ranks?user=${person.id}`} className="card flex items-center justify-between hover:border-muted">
            <span className="font-semibold">Alle ranks van {firstName}</span>
            <span className="flex items-center gap-2 text-sm text-muted">
              {them?.ranks?.ranks.length ? <span className="tabular-nums">{them.ranks.ranks.length}</span> : null}
              <ChevronRightIcon />
            </span>
          </Link>

          <button className="w-full py-2 text-sm text-muted hover:text-danger" onClick={() => setConfirmOpen(true)}>
            Verwijderen als vriend
          </button>

          <ConfirmSheet
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            title="Vriend verwijderen"
            body={
              <>
                Wil je <span className="font-semibold text-ink">{name}</span> verwijderen als vriend? Jullie zien daarna elkaars
                trainingen niet meer, behalve in een gezamenlijke groep. Je kunt later opnieuw vrienden worden.
              </>
            }
            confirmLabel="Verwijderen"
            busyLabel="Verwijderen…"
            danger
            onConfirm={unfriend}
          />

          <Sheet
            open={duelOpen}
            onClose={() => setDuelOpen(false)}
            title={duel ? `${EXERCISE_BY_SLUG[duel.slug]?.name ?? duel.slug}: jij tegen ${firstName}` : "Vergelijking"}
          >
            {duel && <DuelDetail c={duel} firstName={firstName} />}
          </Sheet>
        </div>
      )}
    </AppShell>
  );
}

function Stat({ value, label }: { value: number | undefined; label: string }) {
  return (
    <div className="[&:not(:first-child)]:border-l [&:not(:first-child)]:border-line">
      {value === undefined ? (
        <span className="skeleton mx-auto block h-7 w-10" />
      ) : (
        <p className="text-xl font-extrabold tabular-nums">{value}</p>
      )}
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function PrRow({ pr, index }: { pr: PersonalRecord; index: number }) {
  const ex = EXERCISE_BY_SLUG[pr.slug];
  const delta = pr.value - pr.previous;
  return (
    <Link
      href={`/exercises/${pr.slug}`}
      className="animate-fade-up flex items-center gap-3 px-4 py-3 hover:bg-surface-2/40"
      style={{ "--i": index } as React.CSSProperties}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warn/15 text-warn">
        <TrophyIcon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{ex?.name ?? pr.slug}</p>
        <p className="text-xs tabular-nums text-muted">
          {formatSet(pr.set)}
          {pr.unit === "kg" && <> · geschatte 1RM {nl(pr.value)} kg</>}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold tabular-nums text-accent">
          +{pr.unit === "kg" ? `${nl(delta)} kg` : isTimed(pr.slug) ? `${delta} s` : `${delta} ${delta === 1 ? "rep" : "reps"}`}
        </p>
        <p className="text-[11px] text-muted">{relativeDay(pr.date)}</p>
      </div>
    </Link>
  );
}

function RecentWorkoutCard({
  w,
  index,
  prWorkouts,
  onDay,
}: {
  w: RecentWorkout;
  index: number;
  prWorkouts: Set<string>;
  onDay: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? w.exercises : w.exercises.slice(0, 3);
  const prCount = w.exercises.filter((e) => prWorkouts.has(`${w.workoutId}:${e.slug}`)).length;
  return (
    <div className="card animate-fade-up space-y-3 p-0" style={{ "--i": index } as React.CSSProperties}>
      <button
        type="button"
        className="flex w-full items-start gap-3 px-4 pt-3 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{w.title}</p>
          <p className="truncate text-xs text-muted">
            <span className="capitalize">{relativeDay(w.date)}</span>
            {w.groupName && <> · {w.groupName}</>} · {w.exercises.length} {w.exercises.length === 1 ? "oefening" : "oefeningen"} ·{" "}
            {w.sets} sets
          </p>
        </div>
        {prCount > 0 && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn">
            <TrophyIcon size={11} /> {prCount} PR
          </span>
        )}
      </button>
      <ul className="space-y-1.5 px-4">
        {shown.map((e) => {
          const isPR = prWorkouts.has(`${w.workoutId}:${e.slug}`);
          return (
            <li key={e.workoutExerciseId} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                {EXERCISE_BY_SLUG[e.slug]?.name ?? e.slug}
                {isPR && <span className="ml-1.5 text-[10px] font-bold uppercase text-warn">PR</span>}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted">
                {open ? e.sets.map((s) => formatSet(s)).join("  ·  ") : `${e.sets.length}× · ${formatSet(e.top)}`}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs">
        <button type="button" className="font-semibold text-muted hover:text-ink" onClick={() => setOpen((v) => !v)}>
          {open ? "Minder" : w.exercises.length > 3 ? `Alle ${w.exercises.length} oefeningen` : "Alle sets"}
        </button>
        <button
          type="button"
          className="font-semibold text-muted hover:text-ink"
          onClick={() => {
            onDay(w.date);
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            document.getElementById("kalender")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
          }}
        >
          In kalender
        </button>
      </div>
    </div>
  );
}

type Best = { value: number; unit: "kg" | "reps"; label: string };
type Comparison = {
  slug: string;
  them: Best;
  me: Best;
  lastDate: string;
  /** Beste prestatie per sessie (oud naar nieuw), voor de grafiek. */
  mySeries: DuelPoint[];
  theirSeries: DuelPoint[];
};

/** Beste prestatie per sessie in de gegeven eenheid. */
function series(sessions: Session[], unit: "kg" | "reps"): DuelPoint[] {
  const out: DuelPoint[] = [];
  for (const s of sessions) {
    const value = unit === "kg" ? s.best1RM : s.maxReps;
    if (value != null && value > 0) out.push({ date: s.date, value });
  }
  return out;
}

function best(sessions: Session[]): Best {
  const withKg = sessions.filter((s) => s.best1RM != null);
  if (withKg.length) {
    const top = withKg.reduce((a, b) => (b.best1RM! > a.best1RM! ? b : a));
    return { value: top.best1RM!, unit: "kg", label: formatSet(top.bestSet) };
  }
  const top = sessions.reduce((a, b) => (b.maxReps > a.maxReps ? b : a));
  return { value: top.maxReps, unit: "reps", label: `${top.maxReps} ${isTimed(top.bestSet.slug) ? "s" : "reps"}` };
}

/** Oefeningen die jullie allebei gedaan hebben, met de beste prestatie van ieder. */
function compare(theirs: HistorySet[] | undefined, mine: HistorySet[] | undefined): Comparison[] {
  if (!theirs || !mine) return [];
  const done = (h: HistorySet[]) => h.filter((s) => (s.reps ?? 0) > 0);
  const a = sessionsBySlug(done(theirs));
  const b = sessionsBySlug(done(mine));
  const out: Comparison[] = [];
  for (const [slug, s] of a) {
    const m = b.get(slug);
    if (!m) continue;
    const t = best(s);
    const me = best(m);
    // Alleen vergelijken in dezelfde eenheid.
    if (t.unit !== me.unit) continue;
    out.push({
      slug,
      them: t,
      me,
      lastDate: s.at(-1)!.date > m.at(-1)!.date ? s.at(-1)!.date : m.at(-1)!.date,
      mySeries: series(m, me.unit),
      theirSeries: series(s, t.unit),
    });
  }
  return out.sort((x, y) => y.lastDate.localeCompare(x.lastDate));
}

/** Stand over alle gezamenlijke oefeningen. */
function Scoreboard({ comparison, firstName }: { comparison: Comparison[]; firstName: string }) {
  const mineWins = comparison.filter((c) => c.me.value > c.them.value).length;
  const theirWins = comparison.filter((c) => c.them.value > c.me.value).length;
  const ties = comparison.length - mineWins - theirWins;
  return (
    <div className="card flex items-center justify-between gap-3 py-3">
      <div className="text-center">
        <p className="text-2xl font-extrabold tabular-nums text-accent">{mineWins}</p>
        <p className="text-xs text-muted">Jij</p>
      </div>
      <p className="min-w-0 flex-1 text-center text-xs text-muted">
        {mineWins > theirWins ? "Jij staat voor" : mineWins < theirWins ? `${firstName} staat voor` : "Gelijke stand"}
        {ties > 0 && <span className="block">{ties} gelijk</span>}
      </p>
      <div className="text-center">
        <p className="text-2xl font-extrabold tabular-nums" style={{ color: RIVAL }}>
          {theirWins}
        </p>
        <p className="max-w-20 truncate text-xs text-muted">{firstName}</p>
      </div>
    </div>
  );
}

function CompareRow({ c, index, onOpen }: { c: Comparison; index: number; onOpen: () => void }) {
  const ex = EXERCISE_BY_SLUG[c.slug];
  const total = c.me.value + c.them.value || 1;
  const myShare = c.me.value / total;
  const iWin = c.me.value > c.them.value;
  const tie = c.me.value === c.them.value;
  const theyWin = !iWin && !tie;
  const timed = isTimed(c.slug);
  const fmt = (b: Best) => (b.unit === "kg" ? `${nl(b.value)} kg` : timed ? `${b.value} s` : `${b.value}`);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="animate-fade-up block w-full space-y-2 px-4 py-3 text-left transition hover:bg-surface-2/40 active:bg-surface-2/60"
      style={{ "--i": Math.min(index, 8) } as React.CSSProperties}
      aria-haspopup="dialog"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-sm font-semibold">{ex?.name ?? c.slug}</p>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
          {c.me.unit === "kg" ? "geschatte 1RM" : timed ? "langste set" : "max reps"}
          <ChevronRightIcon size={12} />
        </span>
      </div>
      <div className="flex items-center gap-3 text-sm tabular-nums">
        <span className={`w-16 shrink-0 font-bold ${iWin ? "text-accent" : tie ? "" : "text-muted"}`}>{fmt(c.me)}</span>
        <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div
            className={`h-full rounded-l-full ${iWin ? "bg-accent" : "bg-accent/40"}`}
            style={{ width: `${myShare * 100}%`, transition: "width 0.8s cubic-bezier(0.2,0.8,0.2,1)" }}
          />
          <div className="h-full flex-1 rounded-r-full" style={{ background: RIVAL, opacity: theyWin ? 1 : 0.4 }} />
        </div>
        <span className={`w-16 shrink-0 text-right font-bold ${theyWin ? "" : "text-muted"}`} style={theyWin ? { color: RIVAL } : undefined}>
          {fmt(c.them)}
        </span>
      </div>
      <div className="flex justify-between gap-2 text-[11px] text-muted">
        <span className="truncate">Jij · {c.me.label}</span>
        <span className="truncate">{c.them.label}</span>
      </div>
    </button>
  );
}

/** Sets van één dag, per training en oefening. */
function DaySets({ day, history }: { day: string; history: HistorySet[] }) {
  const byWorkout = useMemo(() => {
    const sets = history.filter((s) => s.date === day && (s.reps ?? 0) > 0);
    const map = new Map<string, { id: string; title: string; exercises: Map<string, HistorySet[]> }>();
    for (const s of sets) {
      const w = map.get(s.workoutId) ?? { id: s.workoutId, title: s.workoutTitle, exercises: new Map() };
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
          <div key={w.id} className="animate-fade-in space-y-2">
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

/** Uitgebreide vergelijking van één oefening: verloop over tijd en de stand. */
function DuelDetail({ c, firstName }: { c: Comparison; firstName: string }) {
  const unit = c.me.unit;
  const timed = isTimed(c.slug);
  const fmt = (v: number) => (unit === "kg" ? `${nl(v)} kg` : timed ? `${v} s` : `${v} reps`);
  const diff = Math.round((c.me.value - c.them.value) * 10) / 10;
  const lastMine = c.mySeries.at(-1);
  const lastTheirs = c.theirSeries.at(-1);
  const what = unit === "kg" ? "geschatte 1RM" : timed ? "langste set" : "max reps";
  const verdict =
    diff === 0
      ? `Jullie staan gelijk op ${fmt(c.me.value)} ${what}.`
      : diff > 0
        ? `Jij zit ${fmt(Math.abs(diff))} boven ${firstName}.`
        : `${firstName} zit ${fmt(Math.abs(diff))} boven jou.`;
  return (
    <div className="space-y-4">
      <p
        className={`rounded-xl px-3 py-2 text-sm font-semibold ${diff > 0 ? "bg-accent/10 text-accent" : diff < 0 ? "bg-surface-2" : "bg-surface-2 text-muted"}`}
        style={diff < 0 ? { color: RIVAL } : undefined}
      >
        {verdict}
      </p>
      <DuelChart mine={c.mySeries} theirs={c.theirSeries} unit={unit} timed={timed} rivalName={firstName} rivalColor={RIVAL} />
      <div className="grid grid-cols-2 gap-2">
        <DuelStat
          who="Jij"
          color="var(--color-accent)"
          best={c.me.label}
          last={lastMine ? `${fmt(lastMine.value)} · ${relativeDay(lastMine.date).toLowerCase()}` : "–"}
          sessions={c.mySeries.length}
        />
        <DuelStat
          who={firstName}
          color={RIVAL}
          best={c.them.label}
          last={lastTheirs ? `${fmt(lastTheirs.value)} · ${relativeDay(lastTheirs.date).toLowerCase()}` : "–"}
          sessions={c.theirSeries.length}
        />
      </div>
      <Link href={`/exercises/${c.slug}`} className="btn-ghost w-full">
        Oefening bekijken
      </Link>
    </div>
  );
}

function DuelStat({ who, color, best, last, sessions }: { who: string; color: string; best: string; last: string; sessions: number }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        <span className="truncate">{who}</span>
      </p>
      <dl className="mt-1.5 space-y-1 text-xs">
        <div>
          <dt className="text-muted">Beste set</dt>
          <dd className="font-semibold tabular-nums">{best}</dd>
        </div>
        <div>
          <dt className="text-muted">Laatste</dt>
          <dd className="tabular-nums">{last}</dd>
        </div>
        <div>
          <dt className="text-muted">Sessies</dt>
          <dd className="tabular-nums">{sessions}</dd>
        </div>
      </dl>
    </div>
  );
}

type TogetherStats = {
  /** Trainingen waarin jullie allebei sets logden, nieuwste eerst. */
  sessions: { workoutId: string; date: string; title: string }[];
  thisMonth: number;
};

/** Trainingen waarin jullie allebei sets logden (bijv. dezelfde groepstraining). */
function trainedTogether(theirs: HistorySet[] | undefined, mine: HistorySet[] | undefined): TogetherStats | null {
  if (!theirs || !mine) return null;
  const myWorkouts = new Set(mine.filter((s) => (s.reps ?? 0) > 0).map((s) => s.workoutId));
  const shared = new Map<string, { workoutId: string; date: string; title: string }>();
  for (const s of theirs) {
    if ((s.reps ?? 0) <= 0 || !myWorkouts.has(s.workoutId) || shared.has(s.workoutId)) continue;
    shared.set(s.workoutId, { workoutId: s.workoutId, date: s.date, title: s.workoutTitle });
  }
  const sessions = [...shared.values()].sort((a, b) => b.date.localeCompare(a.date));
  const monthKey = toISODate().slice(0, 7);
  return { sessions, thisMonth: sessions.filter((s) => s.date.startsWith(monthKey)).length };
}

/** De dag waarop iemand deze week zijn weekdoel haalde, of null. */
function goalHitDay(days: Set<string>, goal: number): string | null {
  const week = weekRange(0).days.filter((d) => days.has(d));
  return week.length >= goal ? week[Math.max(0, goal - 1)] : null;
}

/** Weekrace (wie haalt eerst zijn weekdoel) en hoe vaak jullie samen trainden. */
function Together({
  them,
  mine,
  together,
  firstName,
}: {
  them: PersonSummary | null;
  mine: PersonSummary | null;
  together: TogetherStats | null;
  firstName: string;
}) {
  if (!them || !mine || !together) {
    return <div className="skeleton h-40" aria-hidden />;
  }
  const myHit = goalHitDay(mine.days, mine.goal);
  const theirHit = goalHitDay(them.days, them.goal);
  const myLeft = Math.max(0, mine.goal - mine.week);
  const theirLeft = Math.max(0, them.goal - them.week);
  const verdict =
    myHit && theirHit
      ? myHit < theirHit
        ? "Allebei op weekdoel. Jij was eerder."
        : myHit > theirHit
          ? `Allebei op weekdoel. ${firstName} was eerder.`
          : "Allebei op weekdoel, op dezelfde dag."
      : myHit
        ? `Jij zit al op je weekdoel. ${firstName} nog ${theirLeft} te gaan.`
        : theirHit
          ? `${firstName} zit al op weekdoel. Jij nog ${myLeft} te gaan.`
          : mine.week === 0 && them.week === 0
            ? "Wie haalt deze week als eerste zijn weekdoel?"
            : `Wie is als eerste op weekdoel? Jij nog ${myLeft}, ${firstName} nog ${theirLeft}.`;
  const last = together.sessions[0];

  return (
    <section className="space-y-3" aria-labelledby="together-h">
      <h2 id="together-h" className="text-sm font-semibold uppercase tracking-wide text-muted">
        Samen
      </h2>
      <div className="card animate-fade-up space-y-4">
        <div className="space-y-2.5">
          <p className="text-sm font-semibold">{verdict}</p>
          <RaceRow label="Jij" week={mine.week} goal={mine.goal} color="var(--color-accent)" />
          <RaceRow label={firstName} week={them.week} goal={them.goal} color={RIVAL} />
        </div>
        <div className="flex items-center gap-3 border-t border-line pt-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <UsersIcon size={18} />
          </span>
          <div className="min-w-0 flex-1">
            {together.sessions.length === 0 ? (
              <>
                <p className="text-sm font-semibold">Nog niet samen getraind</p>
                <p className="text-xs text-muted">Log allebei sets in dezelfde groepstraining, dan zie je het hier.</p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold">
                  {together.sessions.length}× samen getraind
                  {together.thisMonth > 0 && <span className="font-normal text-muted"> · {together.thisMonth} deze maand</span>}
                </p>
                <p className="truncate text-xs text-muted">
                  Laatst: {last.title} · {relativeDay(last.date).toLowerCase()}
                </p>
              </>
            )}
          </div>
          {last && (
            <Link
              href={`/workouts/${last.workoutId}`}
              className="-my-2 flex min-h-11 shrink-0 items-center gap-0.5 text-xs font-semibold text-muted hover:text-ink"
              aria-label={`Laatste gezamenlijke training bekijken: ${last.title}`}
            >
              Bekijk <ChevronRightIcon size={14} />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function RaceRow({ label, week, goal, color }: { label: string; week: number; goal: number; color: string }) {
  const pct = Math.min(1, week / Math.max(1, goal));
  const hit = week >= goal;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-16 shrink-0 truncate text-xs font-semibold">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(pct * 100, week > 0 ? 6 : 0)}%`,
            background: color,
            opacity: hit ? 1 : 0.6,
            transition: "width 0.6s cubic-bezier(0.2,0.8,0.2,1)",
          }}
        />
      </div>
      <span className="w-10 shrink-0 text-right tabular-nums">
        <span className="font-semibold">{week}</span>
        <span className="text-muted">/{goal}</span>
        <span className="sr-only"> trainingsdagen deze week</span>
      </span>
    </div>
  );
}

type NonFriendAction = "send" | "accept" | "decline" | "withdraw";

/** Nog geen vrienden: verzoek sturen, beantwoorden of intrekken, direct vanaf het profiel. */
function NonFriend({
  person,
  incoming,
  outgoing,
}: {
  person: FriendProfile;
  incoming: boolean;
  outgoing: boolean;
}) {
  const [busy, setBusy] = useState<NonFriendAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = person.display_name.split(" ")[0];

  async function act(kind: NonFriendAction, fn: () => Promise<string>) {
    setBusy(kind);
    setError(null);
    try {
      toast.success(await fn());
    } catch (err) {
      setError(friendErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const send = () =>
    act("send", async () => {
      const res = await requestFriend(person.id);
      if (res === "accepted" || res === "already") return `Jij en ${first} zijn nu vrienden`;
      return `Verzoek verstuurd naar ${first}`;
    });

  return (
    <div className="space-y-3">
      <div className="card animate-scale-in relative flex flex-col items-center gap-4 overflow-hidden px-6 py-8 text-center">
        <div className="pointer-events-none absolute left-1/2 top-0 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-3xl" />
        <Avatar id={person.id} name={person.display_name} src={person.avatar_url} size={72} className="relative" />
        <div className="relative">
          <h2 className="text-xl font-extrabold">{person.display_name}</h2>
          {outgoing && (
            <p className="animate-fade-in mt-1.5 inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent">
              <CheckIcon size={12} /> Verzoek verstuurd
            </p>
          )}
          <p className="mt-2 text-sm text-muted">
            {incoming
              ? `${first} wil je vriend worden. Als vrienden zien jullie elkaars trainingen, records en ranks.`
              : outgoing
                ? `Zodra ${first} je verzoek accepteert, zie je hier trainingen, records en wie er sterker is.`
                : "Word vrienden om elkaars trainingen, records en ranks te zien en jullie prestaties te vergelijken."}
          </p>
        </div>
        {error && (
          <p role="alert" className="animate-fade-in relative w-full rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        {incoming ? (
          <div className="relative grid w-full grid-cols-2 gap-2">
            <button
              type="button"
              className="btn-ghost"
              disabled={!!busy}
              aria-busy={busy === "decline"}
              onClick={() =>
                act("decline", async () => {
                  await respondFriend(person.id, false);
                  return "Verzoek geweigerd";
                })
              }
            >
              <CloseIcon size={15} /> {busy === "decline" ? "Bezig…" : "Weigeren"}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!!busy}
              aria-busy={busy === "accept"}
              onClick={() =>
                act("accept", async () => {
                  await respondFriend(person.id, true);
                  return `Jij en ${first} zijn nu vrienden`;
                })
              }
            >
              <CheckIcon size={15} /> {busy === "accept" ? "Bezig…" : "Accepteren"}
            </button>
          </div>
        ) : outgoing ? (
          <button
            type="button"
            className="btn-ghost relative w-full text-muted hover:text-danger"
            disabled={!!busy}
            aria-busy={busy === "withdraw"}
            onClick={() =>
              act("withdraw", async () => {
                await removeFriend(person.id);
                return "Verzoek ingetrokken";
              })
            }
          >
            {busy === "withdraw" ? "Intrekken…" : "Verzoek intrekken"}
          </button>
        ) : (
          <button type="button" className="btn-primary relative w-full" disabled={!!busy} aria-busy={busy === "send"} onClick={send}>
            <UserPlusIcon size={16} /> {busy === "send" ? "Versturen…" : "Vriendschapsverzoek sturen"}
          </button>
        )}
      </div>
      <p className="text-center text-xs text-muted">Voeding blijft altijd privé, ook voor vrienden.</p>
      <Link href="/friends" className="flex min-h-11 items-center justify-center text-sm font-semibold text-muted hover:text-ink">
        Naar vrienden
      </Link>
    </div>
  );
}
