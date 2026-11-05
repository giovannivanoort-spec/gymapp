"use client";

import { useMemo } from "react";
import { getCached, useCachedState } from "@/lib/cache";
import { ageFrom } from "@/lib/dates";
import { useFriends } from "@/lib/friends";
import type { HistorySet } from "@/lib/history";
import { useSafeCached } from "@/lib/progress/safeCache";
import type { ExerciseRank, LogLike } from "@/lib/ranks";
import { isMissingSchemaError, supabase } from "@/lib/supabase";
import { fetchLogsBySlug, rankAll } from "@/lib/useRanks";

/** Vriend of groepsgenoot, met wat nodig is om een rang uit te rekenen. */
export type ComparePerson = {
  id: string;
  display_name: string;
  bodyweight_kg?: number | null;
  sex?: "male" | "female" | null;
  birth_date?: string | null;
  avatar_url?: string | null;
};

async function fetchGroupmates(me: string): Promise<ComparePerson[]> {
  const query = (cols: string) => supabase.from("group_members").select(`user_id, profiles(${cols})`).neq("user_id", me);
  let { data, error } = await query("id, display_name, bodyweight_kg, sex, birth_date, avatar_url");
  // Profielfoto's nog niet ingeschakeld (upgrade-avatars.sql): zonder foto.
  if (error && isMissingSchemaError(error)) ({ data, error } = await query("id, display_name, bodyweight_kg, sex, birth_date"));
  if (error) throw error;
  const out = new Map<string, ComparePerson>();
  for (const m of (data ?? []) as unknown as { user_id: string; profiles: ComparePerson | null }[]) {
    if (m.profiles) out.set(m.user_id, m.profiles);
  }
  return [...out.values()];
}

/**
 * Vrienden en groepsgenoten (zonder jezelf), op naam gesorteerd. `people` is undefined zolang
 * er nog niets bekend is. `me = null` slaat ophalen over.
 */
export function useComparePeople(me: string | null): { people: ComparePerson[] | undefined; error: string | null } {
  const friends = useFriends(me);
  const mates = useSafeCached(me ? `ranks:people:v2:${me}` : null, () => fetchGroupmates(me!), { persist: true, maxAge: 120_000 });
  const people = useMemo(() => {
    if (friends === undefined && mates.data === undefined) return undefined;
    const map = new Map<string, ComparePerson>();
    for (const p of friends?.friends ?? []) map.set(p.id, p);
    for (const p of mates.data ?? []) if (!map.has(p.id)) map.set(p.id, p);
    if (me) map.delete(me);
    return [...map.values()].sort((a, b) => a.display_name.localeCompare(b.display_name, "nl"));
  }, [friends, mates.data, me]);
  return { people: friends === undefined && mates.data === undefined && mates.error ? [] : people, error: mates.error };
}

/** Eén regel in de groepsranglijst van een oefening. */
export type BoardEntry = {
  id: string;
  name: string;
  value: number;
  unit: ExerciseRank["unit"];
  viaAdded: boolean;
  score: number;
  tierIndex: number;
};

/** Per oefening de rang van elke vriend/groepsgenoot (zonder jezelf). */
export type GroupBoard = Record<string, BoardEntry[]>;

/** Hoogstens zoveel mensen meenemen: de ranglijst is voor een kleine trainingsgroep. */
const MAX_PEOPLE = 16;

function logsFromHistory(history: HistorySet[]): Map<string, LogLike[]> {
  const logs = new Map<string, LogLike[]>();
  for (const s of history) {
    let list = logs.get(s.slug);
    if (!list) logs.set(s.slug, (list = []));
    list.push({ weight: s.weight, reps: s.reps });
  }
  return logs;
}

async function fetchBoard(people: ComparePerson[]): Promise<GroupBoard> {
  const rankable = people.filter((p) => p.bodyweight_kg && p.sex).slice(0, MAX_PEOPLE);
  const settled = await Promise.allSettled(
    rankable.map(async (p) => {
      // Al geladen geschiedenis (bijv. via "Vergelijk met") hergebruiken; anders alleen gewicht en reps.
      const cached = getCached<HistorySet[]>(`history:${p.id}`);
      const logs = cached ? logsFromHistory(cached) : await fetchLogsBySlug(p.id);
      return { p, ranks: rankAll(logs, p.bodyweight_kg ?? null, p.sex ?? null, ageFrom(p.birth_date)) };
    }),
  );
  // Eén persoon die niet laadt mag de rest niet tegenhouden; lukt niemand, dan een fout (cache houdt de vorige stand).
  const perPerson = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed && !perPerson.length) throw failed.reason;
  const board: GroupBoard = {};
  for (const { p, ranks } of perPerson) {
    for (const r of ranks) {
      (board[r.slug] ??= []).push({
        id: p.id,
        name: p.display_name,
        value: r.value,
        unit: r.unit,
        viaAdded: !!r.viaAdded,
        score: r.score,
        tierIndex: r.tierIndex,
      });
    }
  }
  return board;
}

/**
 * Groepsranglijst per oefening: de beste prestatie van elke vriend en groepsgenoot met een rang.
 * Kleine, bewaarde samenvatting; ververst hooguit eens per 5 minuten.
 */
export function useGroupBoard(me: string | null, people: ComparePerson[] | undefined): GroupBoard | undefined {
  const ids = people
    ?.filter((p) => p.bodyweight_kg && p.sex)
    .map((p) => `${p.id}:${p.bodyweight_kg}:${p.sex}:${p.birth_date ?? ""}`)
    .join(",");
  const key = me && people && ids ? `ranks:board:${me}:${hash(ids)}` : null;
  return useCachedState(key, () => fetchBoard(people!), { persist: true, maxAge: 5 * 60_000 }).data;
}

/** Korte, stabiele hash voor in een cachesleutel. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Ranglijst van één oefening inclusief jezelf, beste eerst. */
export function boardFor(
  slug: string,
  board: GroupBoard | undefined,
  me: { id: string; rank: ExerciseRank | null | undefined },
): (BoardEntry & { self: boolean })[] {
  const others = board?.[slug] ?? [];
  if (!others.length) return [];
  const list: (BoardEntry & { self: boolean })[] = others.map((e) => ({ ...e, self: false }));
  if (me.rank) {
    list.push({
      id: me.id,
      name: "Jij",
      value: me.rank.value,
      unit: me.rank.unit,
      viaAdded: !!me.rank.viaAdded,
      score: me.rank.score,
      tierIndex: me.rank.tierIndex,
      self: true,
    });
  }
  // Allemaal dezelfde maat (kg 1RM of reps): op prestatie. Anders op rang (eerlijk over maten heen).
  const sameMeasure = list.every((e) => e.unit === list[0].unit && e.viaAdded === list[0].viaAdded);
  return list.sort((a, b) => (sameMeasure ? b.value - a.value : 0) || b.score - a.score);
}
