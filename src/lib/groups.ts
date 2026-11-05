"use client";

import { fetchCached, getCached, invalidate } from "./cache";
import { supabase } from "./supabase";
import type { Group, Role } from "./types";

export type MyGroup = Group & { role: Role; memberCount: number };

export const myGroupsKey = (userId: string) => `home:groups:${userId}`;

/** Groepen waar je lid van bent, met je rol en het aantal leden. */
export async function fetchMyGroups(userId: string): Promise<MyGroup[]> {
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
}

/** Direct uit de cache als dat kan, anders ophalen. */
export async function getMyGroups(userId: string): Promise<MyGroup[]> {
  const fresh = fetchCached(myGroupsKey(userId), () => fetchMyGroups(userId), true);
  return getCached<MyGroup[]>(myGroupsKey(userId)) ?? fresh;
}

export function invalidateMyGroups(userId: string) {
  invalidate(myGroupsKey(userId));
}
