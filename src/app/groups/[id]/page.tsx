"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useUserId } from "@/components/AuthProvider";
import { relativeDay, toISODate } from "@/lib/dates";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Group, GroupMember, Workout } from "@/lib/types";
import { GroupFeed } from "@/components/GroupFeed";
import { GroupLeaderboard } from "@/components/GroupLeaderboard";
import { ChevronRightIcon, CloseIcon } from "@/components/Icons";

type GroupWorkout = Workout & { workout_exercises: { count: number }[] };

export default function GroupPage() {
  const { id } = useParams<{ id: string }>();
  const userId = useUserId();
  const router = useRouter();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [workouts, setWorkouts] = useState<GroupWorkout[]>([]);
  const [showPast, setShowPast] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const load = () => setVersion((v) => v + 1);

  useEffect(() => {
    Promise.all([
      supabase.from("groups").select("*").eq("id", id).single(),
      supabase.from("group_members").select("*, profiles(*)").eq("group_id", id).order("joined_at"),
      supabase.from("workouts").select("*, workout_exercises(count)").eq("group_id", id).order("date", { ascending: false }).limit(60),
    ]).then(([g, m, w]) => {
      if (g.error) setError("Groep niet gevonden of je bent geen lid.");
      setGroup(g.data);
      setMembers((m.data as GroupMember[]) ?? []);
      setWorkouts((w.data as GroupWorkout[]) ?? []);
    });
  }, [id, version]);

  const isTrainer = members.some((m) => m.user_id === userId && m.role === "trainer");
  const today = toISODate();
  const upcoming = workouts.filter((w) => w.date >= today).reverse();
  const past = workouts.filter((w) => w.date < today);
  const inviteUrl = group ? `${typeof window !== "undefined" ? window.location.origin : ""}/join/${group.invite_code}` : "";

  async function share() {
    if (!group) return;
    const text = `Doe mee met "${group.name}" in GymApp`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "GymApp", text, url: inviteUrl });
        return;
      } catch {
        // geannuleerd: val terug op kopiëren
      }
    }
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function setRole(member: GroupMember, role: "trainer" | "member") {
    const { error } = await supabase.from("group_members").update({ role }).eq("group_id", id).eq("user_id", member.user_id);
    if (error) return alert(errorMessage(error));
    load();
  }

  async function removeMember(member: GroupMember) {
    const self = member.user_id === userId;
    const name = member.profiles?.display_name ?? "dit lid";
    if (!confirm(self ? "Weet je zeker dat je de groep wilt verlaten?" : `${name} uit de groep verwijderen?`)) return;
    const { error } = await supabase.from("group_members").delete().eq("group_id", id).eq("user_id", member.user_id);
    if (error) return alert(errorMessage(error));
    if (self) router.replace("/");
    else load();
  }

  async function deleteGroup() {
    if (!group || !confirm(`Groep "${group.name}" en alle trainingen definitief verwijderen?`)) return;
    const { error } = await supabase.from("groups").delete().eq("id", id);
    if (error) return alert(errorMessage(error));
    router.replace("/");
  }

  if (error) {
    return (
      <AppShell title="Groep" back="/">
        <div className="card text-sm text-muted">{error}</div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={group?.name ?? "Groep"}
      back="/"
      action={
        isTrainer && (
          <Link href={`/groups/${id}/plan`} className="btn-primary px-3 py-1.5 text-xs">
            + Training
          </Link>
        )
      }
    >
      <div className="space-y-7">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Trainingen</h2>
          {upcoming.length === 0 && (
            <div className="card text-sm text-muted">
              {isTrainer ? "Nog niets gepland. Tik op “+ Training” om er een klaar te zetten." : "Nog niets gepland door de trainer."}
            </div>
          )}
          {upcoming.map((w) => (
            <WorkoutRow key={w.id} w={w} today={today} />
          ))}
          {past.length > 0 && (
            <>
              <button className="text-sm text-muted underline-offset-2 hover:underline" onClick={() => setShowPast((v) => !v)}>
                {showPast ? "Verberg" : "Toon"} eerdere trainingen ({past.length})
              </button>
              {showPast && past.map((w) => <WorkoutRow key={w.id} w={w} today={today} />)}
            </>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Activiteit</h2>
          <GroupFeed groupId={id} userId={userId} />
        </section>

        {members.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Ranglijst</h2>
            <GroupLeaderboard members={members} userId={userId} />
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Leden ({members.length})</h2>
          <ul className="card divide-y divide-line p-0">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-sm font-bold">
                  {(m.profiles?.display_name ?? "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {m.profiles?.display_name}
                    {m.user_id === userId && <span className="text-muted"> (jij)</span>}
                  </p>
                  <p className={`text-xs ${m.role === "trainer" ? "text-accent" : "text-muted"}`}>
                    {m.role === "trainer" ? "Trainer" : "Lid"}
                  </p>
                </div>
                {isTrainer && m.user_id !== userId && (
                  <div className="flex gap-1">
                    <button
                      className="btn-ghost px-2 py-1 text-xs"
                      onClick={() => setRole(m, m.role === "trainer" ? "member" : "trainer")}
                    >
                      {m.role === "trainer" ? "Maak lid" : "Maak trainer"}
                    </button>
                    <button className="btn-ghost px-2 py-1 text-xs text-danger" onClick={() => removeMember(m)} aria-label="Verwijderen">
                      <CloseIcon size={14} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {group && (
            <div className="card space-y-3">
              <p className="font-semibold">Vrienden uitnodigen</p>
              <p className="text-sm text-muted">Stuur deze link. Na het inloggen worden ze direct lid.</p>
              <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-sm">{inviteUrl}</code>
              </div>
              <p className="text-xs text-muted">
                Code: <span className="font-mono text-ink">{group.invite_code}</span>
              </p>
              <button className="btn-primary w-full" onClick={share}>
                {copied ? "Link gekopieerd" : "Deel uitnodiging"}
              </button>
            </div>
          )}
        </section>

        <section className="flex flex-wrap gap-2">
          {members.some((m) => m.user_id === userId) && (
            <button className="btn-ghost" onClick={() => removeMember(members.find((m) => m.user_id === userId)!)}>
              Groep verlaten
            </button>
          )}
          {isTrainer && (
            <button className="btn-danger" onClick={deleteGroup}>
              Groep verwijderen
            </button>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function WorkoutRow({ w, today }: { w: GroupWorkout; today: string }) {
  const isToday = w.date === today;
  return (
    <Link
      href={`/workouts/${w.id}`}
      className={`card flex items-center gap-3 hover:border-muted ${isToday ? "border-accent/50 bg-accent/5" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{w.title}</p>
        <p className="text-xs text-muted">
          {relativeDay(w.date)} · {w.workout_exercises[0]?.count ?? 0} oefeningen
        </p>
      </div>
      <ChevronRightIcon className="text-muted" />
    </Link>
  );
}
