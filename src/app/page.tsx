"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { Avatar, ProfileButton } from "@/components/Avatar";
import { FriendChip } from "@/components/FriendCard";
import {
  BookIcon,
  CalendarIcon,
  ChevronRightIcon,
  DumbbellIcon,
  PlusIcon,
  TrophyIcon,
  UserPlusIcon,
  UsersIcon,
} from "@/components/Icons";
import { RankBadge, TierProgress } from "@/components/RankBadge";
import { Sheet } from "@/components/Sheet";
import { WeekGoal } from "@/components/WeekGoal";
import { MACRO_COLORS } from "@/components/nutrition/MacroSummary";
import { useCached } from "@/lib/cache";
import { ageFrom, relativeDay, toISODate } from "@/lib/dates";
import { useFriends } from "@/lib/friends";
import { useHistory } from "@/lib/history";
import { fetchLogs } from "@/lib/nutrition/log";
import { computeTargets, type NutritionProfile } from "@/lib/nutrition/targets";
import { sumMacros } from "@/lib/nutrition/types";
import { TIERS } from "@/lib/ranks";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Group, Role, Workout } from "@/lib/types";
import { useRanks } from "@/lib/useRanks";

type MyGroup = Group & { role: Role; memberCount: number };
type UpcomingWorkout = Workout & { groups: { name: string } | null; workout_exercises: { count: number }[] };

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? "Goedenacht" : h < 12 ? "Goedemorgen" : h < 18 ? "Goedemiddag" : "Goedenavond";
}

const QUICK = [
  { href: "/exercises", label: "Oefeningen", icon: BookIcon },
  { href: "/progress", label: "Kalender", icon: CalendarIcon },
  { href: "/ranks", label: "Ranks", icon: TrophyIcon },
  { href: "/friends", label: "Vrienden", icon: UsersIcon },
];

const MACROS = [
  ["protein", "Eiwit"],
  ["carbs", "Koolh."],
  ["fat", "Vet"],
] as const;

export default function HomePage() {
  const { profile } = useAuth();
  const userId = useUserId();
  const router = useRouter();
  const [newOpen, setNewOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const ranks = useRanks(userId, profile?.bodyweight_kg ?? null, profile?.sex ?? null, ageFrom(profile?.birth_date));
  const history = useHistory(userId);
  const friends = useFriends(userId);
  const trainedDays = useMemo(
    () => (history ? new Set(history.filter((s) => (s.reps ?? 0) > 0).map((s) => s.date)) : null),
    [history],
  );
  const today = toISODate();

  // Groepen en komende trainingen: tegelijk opgehaald en onthouden tussen bezoeken.
  const groups =
    useCached(
      `home:groups:${userId}`,
      async () => {
        const { data: memberships } = await supabase
          .from("group_members")
          .select("role, groups(*, group_members(count))")
          .eq("user_id", userId);
        return (memberships ?? [])
          .filter((m) => m.groups)
          .map((m) => {
            const g = m.groups as unknown as Group & { group_members: { count: number }[] };
            return { ...g, role: m.role as Role, memberCount: g.group_members[0]?.count ?? 1 } as MyGroup;
          });
      },
      { persist: true },
    ) ?? null;
  const workouts =
    useCached(
      `home:workouts:${userId}`,
      async () => {
        // groups!inner: alleen trainingen van je eigen groepen (niet die van vrienden).
        const { data: w } = await supabase
          .from("workouts")
          .select("*, groups!inner(name), workout_exercises(count)")
          .gte("date", toISODate())
          .order("date")
          .limit(10);
        return (w as UpcomingWorkout[]) ?? [];
      },
      { persist: true },
    ) ?? [];
  const food = useCached(`home:food:${userId}:${today}`, () => fetchLogs(today, today), { persist: true });
  const targets = computeTargets(profile as NutritionProfile | null);
  const eaten = food ? sumMacros(food) : null;

  const todays = workouts.filter((w) => w.date === today);
  const later = workouts.filter((w) => w.date !== today);
  const firstName = profile?.display_name?.split(" ")[0] ?? "";
  const incoming = friends?.incoming ?? [];

  return (
    <AppShell>
      <div className="space-y-7 pt-[env(safe-area-inset-top)]">
        <header className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm capitalize text-muted">
              {new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <h1 className="truncate text-[28px] font-extrabold leading-tight tracking-tight">
              {greeting()}
              {firstName && <span className="text-accent">, {firstName}</span>}
            </h1>
          </div>
          <Link
            href="/friends"
            aria-label="Vrienden"
            className="relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted transition hover:text-ink active:scale-95"
          >
            <UsersIcon size={18} />
            {incoming.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-ink">
                {incoming.length}
              </span>
            )}
          </Link>
          <ProfileButton id={userId} name={profile?.display_name ?? ""} />
        </header>

        {/* De training van vandaag staat bovenaan: daar open je de app meestal voor. */}
        {todays.length > 0 && (
          <section className="space-y-2">
            {todays.map((w, i) => (
              <TodayCard key={w.id} w={w} index={i} />
            ))}
          </section>
        )}

        <section className="card animate-scale-in relative overflow-hidden p-0">
          {ranks?.overall && (
            <div
              className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-25 blur-3xl"
              style={{ background: ranks.overall.tier.from }}
            />
          )}
          <Link href="/ranks" className="relative flex items-center gap-4 p-4">
            {ranks?.overall ? (
              <RankBadge tierIndex={TIERS.indexOf(ranks.overall.tier)} size={64} glow />
            ) : (
              <RankBadge tierIndex={0} size={64} className="opacity-25 grayscale" />
            )}
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Totaalrang</p>
              <p className="text-xl font-bold" style={ranks?.overall ? { color: ranks.overall.tier.to } : undefined}>
                {ranks === null
                  ? "…"
                  : ranks.overall
                    ? ranks.overall.tier.name
                    : profile?.bodyweight_kg && profile.sex
                      ? "Nog geen rang"
                      : "Vul je profiel aan"}
              </p>
              {ranks?.overall && (
                <TierProgress tierIndex={TIERS.indexOf(ranks.overall.tier)} progress={ranks.overall.score % 1} />
              )}
            </div>
            <ChevronRightIcon className="text-muted" />
          </Link>
          <div className="relative border-t border-line">
            <WeekGoal days={trainedDays} goal={profile?.weekly_goal ?? 3} />
          </div>
        </section>

        <nav className="grid grid-cols-4 gap-2">
          {QUICK.map(({ href, label, icon: Icon }, i) => (
            <Link
              key={href}
              href={href}
              className="card animate-fade-up flex flex-col items-center gap-2 px-1 py-3 text-center transition hover:border-muted active:scale-95"
              style={{ "--i": i } as React.CSSProperties}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-accent">
                <Icon size={20} />
              </span>
              <span className="text-[11px] font-semibold">{label}</span>
            </Link>
          ))}
        </nav>

        {todays.length === 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Vandaag</h2>
            <div className="card flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
                <DumbbellIcon size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Geen training gepland</p>
                <p className="truncate text-xs text-muted">
                  {later[0] ? (
                    <>
                      Volgende: {later[0].title}, {relativeDay(later[0].date).toLowerCase()}
                    </>
                  ) : (
                    "Plan er een vanuit je groep."
                  )}
                </p>
              </div>
            </div>
          </section>
        )}

        <Link href="/nutrition" className="card animate-fade-up block space-y-3 hover:border-muted">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">Voeding vandaag</p>
            <ChevronRightIcon className="text-muted" />
          </div>
          {!eaten ? (
            <div className="skeleton h-16" />
          ) : (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold tabular-nums">{Math.round(eaten.kcal).toLocaleString("nl-NL")}</span>
                <span className="text-sm text-muted">{targets ? <>/ {targets.kcal.toLocaleString("nl-NL")} kcal</> : "kcal"}</span>
              </div>
              {targets && (
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full ${eaten.kcal > targets.kcal ? "bg-warn" : "bg-accent"}`}
                    style={{
                      width: `${Math.min(100, (eaten.kcal / targets.kcal) * 100)}%`,
                      transition: "width 0.8s cubic-bezier(0.2,0.8,0.2,1)",
                    }}
                  />
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                {MACROS.map(([k, label]) => (
                  <div key={k} className="space-y-1">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-muted">{label}</span>
                      <span className="font-semibold tabular-nums">
                        {Math.round(eaten[k])}
                        {targets && <span className="font-normal text-muted">/{targets[k]}</span>}g
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${targets ? Math.min(100, (eaten[k] / targets[k]) * 100) : 0}%`,
                          background: MACRO_COLORS[k],
                          transition: "width 0.8s cubic-bezier(0.2,0.8,0.2,1)",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Link>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Vrienden</h2>
            <Link href="/friends" className="text-xs font-semibold text-muted hover:text-ink">
              Alles
            </Link>
          </div>
          {incoming.length > 0 && (
            <Link href="/friends" className="card flex items-center gap-3 border-accent/40 bg-accent/5 p-3">
              <Avatar id={incoming[0].id} name={incoming[0].display_name} size={32} />
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">{incoming[0].display_name}</span>
                {incoming.length > 1
                  ? ` en ${incoming.length - 1} ${incoming.length === 2 ? "ander willen" : "anderen willen"}`
                  : " wil"}{" "}
                je vriend worden
              </p>
              <ChevronRightIcon className="text-muted" />
            </Link>
          )}
          {!friends ? (
            <div className="skeleton h-[104px]" />
          ) : (
            <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {friends.friends.map((f, i) => (
                <FriendChip key={f.id} friend={f} index={i} />
              ))}
              <Link href="/friends" className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-line text-muted transition hover:border-muted hover:text-ink">
                  <UserPlusIcon size={22} />
                </span>
                <span className="text-xs font-semibold text-muted">Toevoegen</span>
              </Link>
              {friends.friends.length === 0 && (
                <p className="self-center pl-2 text-xs text-muted">Voeg vrienden toe en zie hoe zij trainen.</p>
              )}
            </div>
          )}
        </section>

        {later.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Binnenkort</h2>
            {later.map((w, i) => (
              <WorkoutCard key={w.id} w={w} index={i} />
            ))}
          </section>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Mijn groepen</h2>
            <div className="flex gap-2">
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setJoinOpen(true)}>
                Code invoeren
              </button>
              <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => setNewOpen(true)}>
                <PlusIcon size={14} /> Nieuwe groep
              </button>
            </div>
          </div>
          {groups === null ? (
            <div className="space-y-2">
              <div className="skeleton h-[72px]" />
              <div className="skeleton h-[72px]" />
            </div>
          ) : groups.length === 0 ? (
            <div className="card space-y-2 text-sm text-muted">
              <p>Je zit nog niet in een groep.</p>
              <p>Maak een groep aan en deel de uitnodigingslink met je vrienden, of voer een code in die je hebt gekregen.</p>
            </div>
          ) : (
            groups.map((g, i) => (
              <Link
                key={g.id}
                href={`/groups/${g.id}`}
                className="card animate-fade-up flex items-center gap-3 hover:border-muted"
                style={{ "--i": i } as React.CSSProperties}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-lg font-bold text-accent">
                  {g.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{g.name}</p>
                  <p className="text-xs text-muted">
                    {g.memberCount} {g.memberCount === 1 ? "lid" : "leden"} · {g.role === "trainer" ? "Trainer" : "Lid"}
                  </p>
                </div>
                <ChevronRightIcon className="text-muted" />
              </Link>
            ))
          )}
        </section>
      </div>

      <NewGroupSheet open={newOpen} onClose={() => setNewOpen(false)} onCreated={(id) => router.push(`/groups/${id}`)} />
      <JoinSheet open={joinOpen} onClose={() => setJoinOpen(false)} />
    </AppShell>
  );
}

/** Grote kaart voor de training van vandaag. */
function TodayCard({ w, index }: { w: UpcomingWorkout; index: number }) {
  const count = w.workout_exercises[0]?.count ?? 0;
  return (
    <Link
      href={`/workouts/${w.id}`}
      className="animate-scale-in relative block overflow-hidden rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/20 via-accent/5 to-transparent p-5 transition active:scale-[0.99]"
      style={{ "--i": index } as React.CSSProperties}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/25 blur-3xl" />
      <div className="relative space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Vandaag{w.groups?.name ? ` · ${w.groups.name}` : ""}
        </div>
        <div>
          <p className="text-2xl font-extrabold leading-tight">{w.title}</p>
          <p className="mt-1 text-sm text-muted">{count} oefeningen</p>
        </div>
        <span className="btn-primary w-full">Start training</span>
      </div>
    </Link>
  );
}

function WorkoutCard({ w, index = 0 }: { w: UpcomingWorkout; index?: number }) {
  const count = w.workout_exercises[0]?.count ?? 0;
  return (
    <Link
      href={`/workouts/${w.id}`}
      className="card animate-fade-up flex items-center gap-3 hover:border-muted"
      style={{ "--i": index } as React.CSSProperties}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{w.title}</p>
        <p className="text-xs text-muted">
          {relativeDay(w.date)} · {w.groups?.name} · {count} oefeningen
        </p>
      </div>
      <ChevronRightIcon className="text-muted" />
    </Link>
  );
}

function NewGroupSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.from("groups").insert({ name: name.trim() }).select("id").single();
    setBusy(false);
    if (error) return setError(errorMessage(error));
    onCreated(data.id);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Nieuwe groep">
      <form onSubmit={create} className="space-y-4">
        <div>
          <label className="label" htmlFor="gname">Naam</label>
          <input id="gname" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bijv. Gym bros" required autoFocus />
        </div>
        <p className="text-sm text-muted">Jij wordt de trainer van deze groep. Daarna kun je vrienden uitnodigen.</p>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button className="btn-primary w-full" disabled={busy || !name.trim()}>
          {busy ? "Aanmaken…" : "Groep aanmaken"}
        </button>
      </form>
    </Sheet>
  );
}

function JoinSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [code, setCode] = useState("");
  const router = useRouter();
  return (
    <Sheet open={open} onClose={onClose} title="Lid worden met code">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Accepteert ook een volledige uitnodigingslink.
          const c = code.trim().split("/").pop();
          if (c) router.push(`/join/${c}`);
        }}
        className="space-y-4"
      >
        <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code of uitnodigingslink" autoFocus />
        <button className="btn-primary w-full" disabled={!code.trim()}>
          Verder
        </button>
      </form>
    </Sheet>
  );
}
