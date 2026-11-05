"use client";

import { invalidate, useCached } from "./cache";
import { supabase } from "./supabase";
import type { Profile } from "./types";

export type FriendProfile = Profile & { friend_code?: string };

export type FriendsState = {
  /** Geaccepteerde vrienden. */
  friends: FriendProfile[];
  /** Verzoeken die jij nog moet beantwoorden. */
  incoming: FriendProfile[];
  /** Verzoeken die jij hebt gestuurd. */
  outgoing: FriendProfile[];
};

type Row = {
  requester: string;
  addressee: string;
  status: "pending" | "accepted";
  req: FriendProfile | null;
  adr: FriendProfile | null;
};

export async function fetchFriends(userId: string): Promise<FriendsState> {
  const { data } = await supabase
    .from("friendships")
    .select(
      "requester, addressee, status, req:profiles!friendships_requester_fkey(*), adr:profiles!friendships_addressee_fkey(*)",
    )
    .order("created_at");
  const out: FriendsState = { friends: [], incoming: [], outgoing: [] };
  for (const r of (data ?? []) as unknown as Row[]) {
    const mine = r.requester === userId;
    const other = mine ? r.adr : r.req;
    if (!other) continue;
    if (r.status === "accepted") out.friends.push(other);
    else (mine ? out.outgoing : out.incoming).push(other);
  }
  out.friends.sort((a, b) => a.display_name.localeCompare(b.display_name));
  return out;
}

export function useFriends(userId: string | null): FriendsState | undefined {
  return useCached(userId ? `friends:${userId}` : null, () => fetchFriends(userId!), { persist: true, maxAge: 15_000 });
}

export type RequestResult = "requested" | "accepted" | "already" | "self";

export async function requestFriend(target: string): Promise<RequestResult> {
  const { data, error } = await supabase.rpc("request_friend", { target });
  if (error) throw error;
  invalidate("friends:");
  return data as RequestResult;
}

export async function requestFriendByCode(code: string): Promise<RequestResult> {
  const { data, error } = await supabase.rpc("request_friend_by_code", { code });
  if (error) throw error;
  invalidate("friends:");
  return data as RequestResult;
}

export async function respondFriend(requesterId: string, accept: boolean) {
  const { error } = await supabase.rpc("respond_friend", { requester_id: requesterId, accept });
  if (error) throw error;
  invalidate("friends:");
}

export async function removeFriend(other: string) {
  const { error } = await supabase.rpc("remove_friend", { other });
  if (error) throw error;
  invalidate("friends:");
}

export function friendLink(code: string) {
  return `${typeof window !== "undefined" ? window.location.origin : ""}/friend/${code}`;
}

export const REQUEST_MESSAGES: Record<RequestResult, string> = {
  requested: "Verzoek verstuurd",
  accepted: "Jullie zijn nu vrienden",
  already: "Jullie zijn al vrienden",
  self: "Dit is je eigen code",
};
