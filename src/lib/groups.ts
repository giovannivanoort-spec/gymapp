"use client";

import { fetchCached, getCached, getCachedAt, invalidate } from "./cache";
import { supabase } from "./supabase";
import type { Group, Role } from "./types";

export type MyGroup = Group & { role: Role; memberCount: number };

export const myGroupsKey = (userId: string) => `home:groups:${userId}`;

/** Zo lang mag getMyGroups de bekende lijst teruggeven zonder op de achtergrond te verversen. */
const FRESH_MS = 30_000;

/**
 * Groepen waar je lid van bent, met je rol en het aantal leden.
 * Gooit een fout als het ophalen mislukt: een lege lijst zou anders in de cache belanden en
 * Home zou dan ten onrechte "nog geen groep" tonen.
 */
export async function fetchMyGroups(userId: string): Promise<MyGroup[]> {
  const { data: memberships, error } = await supabase
    .from("group_members")
    .select("role, groups(*, group_members(count))")
    .eq("user_id", userId);
  if (error) throw error;
  return (memberships ?? [])
    .filter((m) => m.groups)
    .map((m) => {
      const g = m.groups as unknown as Group & { group_members: { count: number }[] };
      const { group_members, ...group } = g;
      return { ...group, role: m.role as Role, memberCount: group_members?.[0]?.count ?? 1 } as MyGroup;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "nl"));
}

/**
 * Direct uit de cache als dat kan (en op de achtergrond verversen als de lijst wat ouder is),
 * anders ophalen. Mislukt het verversen terwijl er al een lijst is, dan blijft die gewoon staan.
 */
export async function getMyGroups(userId: string): Promise<MyGroup[]> {
  const key = myGroupsKey(userId);
  const cached = getCached<MyGroup[]>(key);
  const at = getCachedAt(key);
  if (cached && at > 0 && Date.now() - at < FRESH_MS) return cached;
  const fresh = fetchCached(key, () => fetchMyGroups(userId), true);
  if (cached) {
    fresh.catch(() => {});
    return cached;
  }
  return fresh;
}

export function invalidateMyGroups(userId: string) {
  invalidate(myGroupsKey(userId));
}
