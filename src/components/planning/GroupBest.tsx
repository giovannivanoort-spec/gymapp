"use client";

import { useMemo, useState } from "react";
import { useCachedState } from "@/lib/cache";
import { nl } from "@/lib/history";
import { estimate1RM } from "@/lib/ranks";
import { supabase } from "@/lib/supabase";
import { TrophyIcon } from "../Icons";
import { useMyGroupsState } from "./sharing";

type BestRow = { user_id: string; exercise_slug: string; weight: number | string | null; reps: number; reps12: number | null };
type MemberRow = { user_id: string; profiles: { display_name: string | null } | null };
type Entry = { userId: string; name: string; weight: number | null; reps: number; e1rm: number | null };

/** Beste sets van de hele groep (alle oefeningen), een keer per groep opgehaald en gedeeld tussen oefeningen. */
async function fetchGroupBest(gid: string): Promise<BestRow[] | null> {
  const { data, error } = await supabase.rpc("group_best_sets", { gid });
  if (error) {
    // Functie nog niet geïnstalleerd (upgrade-groups.sql): dan simpelweg geen groepsvergelijking.
    if (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message)) return null;
    throw error;
  }
  return (data ?? []) as BestRow[];
}

async function fetchMembers(gid: string): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("group_members").select("user_id, profiles(display_name)").eq("group_id", gid);
  if (error) throw error;
  return Object.fromEntries(
    ((data ?? []) as unknown as MemberRow[]).map((m) => [m.user_id, m.profiles?.display_name?.trim() || "Lid"]),
  );
}

/**
 * Ranglijst van je groep voor deze oefening: per persoon de beste set (geschatte 1RM, of de meeste
 * reps zonder gewicht). Trainingen zijn zichtbaar voor je groep; voeding blijft privé en komt hier niet voor.
 */
export function GroupBest({ slug, userId }: { slug: string; userId: string }) {
  const { groups } = useMyGroupsState(userId);
  const [picked, setPicked] = useState<string | null>(null);
  const group = groups?.find((g) => g.id === picked) ?? groups?.[0];
  const gid = group?.id ?? null;

  const best = useCachedState(gid ? `exbest:${gid}` : null, () => fetchGroupBest(gid!), { maxAge: 60_000 });
  const members = useCachedState(gid ? `exbest-members:${gid}` : null, () => fetchMembers(gid!), { maxAge: 5 * 60_000, persist: true });

  const entries = useMemo<Entry[] | undefined>(() => {
    if (!best.data || !members.data) return undefined;
    const byUser = new Map<string, Entry>();
    for (const r of best.data) {
      if (r.exercise_slug !== slug || !(r.user_id in members.data)) continue;
      const weight = Number(r.weight) || null;
      const candidates = [r.reps, r.reps12].filter((x): x is number => x != null && x > 0);
      for (const reps of candidates) {
        const e1rm = weight ? estimate1RM(weight, reps) : null;
        const cur = byUser.get(r.user_id);
        const better = !cur
          ? true
          : e1rm != null || cur.e1rm != null
            ? (e1rm ?? 0) > (cur.e1rm ?? 0)
            : (weight ?? 0) > (cur.weight ?? 0) || ((weight ?? 0) === (cur.weight ?? 0) && reps > cur.reps);
        if (better) byUser.set(r.user_id, { userId: r.user_id, name: members.data[r.user_id], weight, reps, e1rm });
      }
    }
    return [...byUser.values()].sort((a, b) =>
      a.e1rm != null || b.e1rm != null ? (b.e1rm ?? 0) - (a.e1rm ?? 0) : (b.weight ?? 0) - (a.weight ?? 0) || b.reps - a.reps,
    );
  }, [best.data, members.data, slug]);

  if (!groups?.length) return null;
  // Geen RPC beschikbaar: stil weglaten.
  if (best.data === null) return null;

  const failed = (best.data === undefined && !!best.error) || (members.data === undefined && !!members.error);
  const myIndex = entries?.findIndex((e) => e.userId === userId) ?? -1;
  const others = entries ? entries.filter((e) => e.userId !== userId).length : 0;

  return (
    <section className="card space-y-3" aria-labelledby="group-best">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="group-best" className="font-bold">
            Jij vs groep
          </h2>
          <p className="text-xs text-muted">
            {entries && entries.length > 0
              ? myIndex >= 0
                ? `Je staat ${myIndex + 1}e van ${entries.length} in ${group!.name}.`
                : `${others} ${others === 1 ? "lid heeft" : "leden hebben"} dit gedaan in ${group!.name}.`
              : `Beste set per persoon in ${group!.name}.`}
          </p>
        </div>
        <TrophyIcon size={18} className="mt-0.5 shrink-0 text-accent" />
      </div>

      {groups.length > 1 && (
        <div className="flex flex-wrap gap-x-1.5" role="group" aria-label="Groep">
          {groups.map((g) => (
            <button key={g.id} onClick={() => setPicked(g.id)} aria-pressed={g.id === gid} className="group flex min-h-11 items-center active:scale-95">
              <span
                className={`flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors ${
                  g.id === gid ? "border-accent text-accent" : "border-line text-muted group-hover:text-ink"
                }`}
              >
                {g.name}
              </span>
            </button>
          ))}
        </div>
      )}

      {failed ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-danger/30 py-1 pl-3 pr-1 text-xs text-danger" role="alert">
          <span>Groepsresultaten laden mislukt.</span>
          <button
            onClick={() => {
              best.retry();
              members.retry();
            }}
            disabled={best.refreshing || members.refreshing}
            className="min-h-11 shrink-0 rounded-lg px-3 font-semibold underline"
          >
            Opnieuw
          </button>
        </div>
      ) : entries === undefined ? (
        <div className="space-y-2" aria-busy aria-label="Groepsresultaten laden">
          <div className="skeleton h-11" />
          <div className="skeleton h-11" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted">Nog niemand in {group!.name} heeft deze oefening gelogd. Wie zet de eerste set neer?</p>
      ) : (
        <ol className="space-y-1.5">
          {entries.slice(0, 8).map((e, i) => {
            const me = e.userId === userId;
            return (
              <li
                key={e.userId}
                className={`animate-fade-up flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 ${me ? "bg-accent/10 ring-1 ring-accent/40" : "bg-surface-2"}`}
                style={{ "--i": i } as React.CSSProperties}
              >
                <span className={`w-5 shrink-0 text-center text-sm font-extrabold tabular-nums ${i === 0 ? "text-accent" : "text-muted"}`}>
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {e.name}
                  {me && <span className="ml-1.5 text-xs font-semibold text-accent">(jij)</span>}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold tabular-nums">
                    {e.weight ? `${nl(e.weight)} kg × ${e.reps}` : `${e.reps} reps`}
                  </span>
                  {e.e1rm != null && <span className="block text-[11px] tabular-nums text-muted">ca. {nl(e.e1rm)} kg 1RM</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {entries && myIndex > 7 && (
        <p className="text-xs text-muted">
          Jij: {myIndex + 1}e met {entries[myIndex].weight ? `${nl(entries[myIndex].weight!)} kg × ${entries[myIndex].reps}` : `${entries[myIndex].reps} reps`}.
        </p>
      )}
    </section>
  );
}
