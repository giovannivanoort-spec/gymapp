"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { Sheet } from "@/components/Sheet";
import { relativeDay, toISODate } from "@/lib/dates";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Group, Role, Workout } from "@/lib/types";
import { ChevronRightIcon, PlusIcon } from "@/components/Icons";
import { RankBadge, TierProgress } from "@/components/RankBadge";
import { TIERS } from "@/lib/ranks";
import { useRanks } from "@/lib/useRanks";
import { ageFrom } from "@/lib/dates";
import { fetchTrainedDays } from "@/lib/week";
import { WeekGoal } from "@/components/WeekGoal";

type MyGroup = Group & { role: Role; memberCount: number };
type UpcomingWorkout = Workout & { groups: { name: string } | null; workout_exercises: { count: number }[] };

export default function HomePage() {
  const { profile } = useAuth();
  const userId = useUserId();
  const router = useRouter();
  const [groups, setGroups] = useState<MyGroup[] | null>(null);
  const [workouts, setWorkouts] = useState<UpcomingWorkout[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [trainedDays, setTrainedDays] = useState<Set<string> | null>(null);
  const ranks = useRanks(userId, profile?.bodyweight_kg ?? null, profile?.sex ?? null, ageFrom(profile?.birth_date));

  useEffect(() => {
    fetchTrainedDays(userId).then(setTrainedDays);
  }, [userId]);

  useEffect(() => {
    (async () => {
      const { data: memberships } = await supabase
        .from("group_members")
        .select("role, groups(*, group_members(count))")
        .eq("user_id", userId);
      setGroups(
        (memberships ?? [])
          .filter((m) => m.groups)
          .map((m) => {
            const g = m.groups as unknown as Group & { group_members: { count: number }[] };
            return { ...g, role: m.role as Role, memberCount: g.group_members[0]?.count ?? 1 };
          }),
      );

      const { data: w } = await supabase
        .from("workouts")
        .select("*, groups(name), workout_exercises(count)")
        .gte("date", toISODate())
        .order("date")
        .limit(10);
      setWorkouts((w as UpcomingWorkout[]) ?? []);
    })();
  }, [userId]);

  const today = toISODate();
  const todays = workouts.filter((w) => w.date === today);
  const later = workouts.filter((w) => w.date !== today);

  return (
    <AppShell>
      <div className="space-y-7 pt-[env(safe-area-inset-top)]">
        <header>
          <p className="text-sm capitalize text-muted">
            {new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">Hoi {profile?.display_name ?? ""}</h1>
        </header>

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
                {ranks === null ? "…" : ranks.overall ? ranks.overall.tier.name : profile?.bodyweight_kg && profile.sex ? "Nog geen rang" : "Vul je profiel aan"}
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

        <div className="grid grid-cols-3 gap-2">
          {[
            { href: "/progress", label: "Kalender" },
            { href: "/templates", label: "Schema's" },
            { href: "/ranks", label: "Ranks" },
          ].map((l) => (
            <Link key={l.href} href={l.href} className="btn-ghost justify-between px-3 text-xs">
              {l.label} <ChevronRightIcon size={14} className="text-muted" />
            </Link>
          ))}
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Vandaag</h2>
          {todays.length === 0 ? (
            <div className="card text-sm text-muted">Geen training gepland voor vandaag.</div>
          ) : (
            todays.map((w, i) => <WorkoutCard key={w.id} w={w} highlight index={i} />)
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

function WorkoutCard({ w, highlight, index = 0 }: { w: UpcomingWorkout; highlight?: boolean; index?: number }) {
  const count = w.workout_exercises[0]?.count ?? 0;
  return (
    <Link
      href={`/workouts/${w.id}`}
      className={`card animate-fade-up flex items-center gap-3 hover:border-muted ${
        highlight ? "border-accent/50 bg-gradient-to-br from-accent/10 to-transparent" : ""
      }`}
      style={{ "--i": index } as React.CSSProperties}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{w.title}</p>
        <p className="text-xs text-muted">
          {relativeDay(w.date)} · {w.groups?.name} · {count} oefeningen
        </p>
      </div>
      {highlight ? <span className="btn-primary px-3 py-1.5 text-xs">Start</span> : <ChevronRightIcon className="text-muted" />}
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
