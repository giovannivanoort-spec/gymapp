"use client";

import { supabase } from "./supabase";

export type ActivityType = "pr" | "promotion" | "joined";
export type ActivityPayload = { slug?: string; tierIndex?: number; detail?: string };

/**
 * Plaatst een activiteit in de groepsfeed en meldt hem aan de andere leden.
 * Een record wordt per training en oefening maar één keer geplaatst: een beter record in
 * dezelfde training werkt de bestaande activiteit bij (zonder nieuwe melding).
 */
export async function postActivity(a: {
  groupId: string;
  userId: string;
  type: ActivityType;
  payload: ActivityPayload;
  workoutId?: string;
}) {
  if (a.type === "pr" && a.workoutId && a.payload.slug) {
    const { data: existing } = await supabase
      .from("activities")
      .select("id")
      .eq("workout_id", a.workoutId)
      .eq("user_id", a.userId)
      .eq("type", "pr")
      .eq("payload->>slug", a.payload.slug)
      .maybeSingle();
    if (existing) {
      await supabase.from("activities").update({ payload: a.payload }).eq("id", existing.id);
      return;
    }
  }

  const { data, error } = await supabase
    .from("activities")
    .insert({ group_id: a.groupId, user_id: a.userId, type: a.type, payload: a.payload, workout_id: a.workoutId ?? null })
    .select("id")
    .single();
  if (error || !data) return;

  const { data: session } = await supabase.auth.getSession();
  fetch("/api/push/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token ?? ""}` },
    body: JSON.stringify({ activityId: data.id }),
  }).catch(() => {});
}
