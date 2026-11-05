"use client";

import { supabase } from "./supabase";

export type ActivityType = "pr" | "promotion" | "joined" | "finished";
export type ActivityPayload = {
  slug?: string;
  tierIndex?: number;
  detail?: string;
  /** Alleen bij "finished": samenvatting van de afgeronde training. */
  sets?: number;
  volume?: number;
  prs?: number;
  exercises?: number;
};

type PostInput = {
  groupId: string;
  userId: string;
  type: ActivityType;
  payload: ActivityPayload;
  workoutId?: string;
};

/**
 * Hoe een activiteit uniek is binnen een training. Komt overeen met de unieke indexen in
 * upgrade-groups.sql; zonder die indexen voorkomen de opzoekactie en de wachtrij hieronder
 * dubbelingen binnen dit apparaat.
 * - pr: één per training, lid en oefening (een beter record werkt de bestaande bij)
 * - promotion: één per training, lid, oefening en rang (nooit bijwerken)
 * - finished: één per training en lid (de samenvatting wordt bijgewerkt)
 */
type Dedupe = { filters: [string, string][]; update: boolean };

function dedupeFor(a: PostInput): Dedupe | null {
  if (!a.workoutId) return null;
  if (a.type === "pr" && a.payload.slug) return { filters: [["payload->>slug", a.payload.slug]], update: true };
  if (a.type === "promotion" && a.payload.slug) {
    return {
      filters: [
        ["payload->>slug", a.payload.slug],
        ["payload->>tierIndex", String(a.payload.tierIndex ?? 0)],
      ],
      update: false,
    };
  }
  if (a.type === "finished") return { filters: [], update: true };
  return null;
}

/** Bestaande activiteit voor deze sleutel (de oudste, als er ooit dubbele zijn ontstaan). */
async function findExisting(a: PostInput, d: Dedupe): Promise<string | null> {
  let q = supabase.from("activities").select("id").eq("workout_id", a.workoutId!).eq("user_id", a.userId).eq("type", a.type);
  for (const [col, val] of d.filters) q = q.eq(col, val);
  const { data, error } = await q.order("created_at").limit(1);
  if (error) console.warn("[activities] opzoeken mislukt:", error.message);
  return (data?.[0]?.id as string | undefined) ?? null;
}

async function updatePayload(id: string, payload: ActivityPayload) {
  const { error } = await supabase.from("activities").update({ payload }).eq("id", id);
  if (error) console.warn("[activities] bijwerken mislukt:", error.message);
}

/** Lopende plaatsingen per sleutel, zodat snel na elkaar gelogde sets niet dubbel plaatsen. */
const pending = new Map<string, Promise<void>>();

/**
 * Plaatst een activiteit in de groepsfeed en meldt hem aan de andere leden.
 * Records, promoties en "training afgerond" worden per training maar één keer geplaatst; een
 * tweede poging werkt (waar zinvol) de bestaande activiteit bij, zonder nieuwe melding.
 */
export async function postActivity(a: PostInput): Promise<void> {
  const d = dedupeFor(a);
  if (!d) {
    const id = await insertActivity(a);
    if (id) await notify(id);
    return;
  }
  const key = [a.type, a.workoutId, a.userId, ...d.filters.map(([, v]) => v)].join(":");
  const previous = pending.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => postOnce(a, d));
  pending.set(key, next);
  try {
    await next;
  } finally {
    if (pending.get(key) === next) pending.delete(key);
  }
}

async function postOnce(a: PostInput, d: Dedupe) {
  const existing = await findExisting(a, d);
  if (existing) {
    if (d.update) await updatePayload(existing, a.payload);
    return;
  }
  const { data, error } = await supabase
    .from("activities")
    .insert({ group_id: a.groupId, user_id: a.userId, type: a.type, payload: a.payload, workout_id: a.workoutId ?? null })
    .select("id")
    .single();
  if (error) {
    // 23505: een ander apparaat was net eerder (unieke index). Dan hoogstens bijwerken, geen melding.
    if (error.code === "23505") {
      if (d.update) {
        const id = await findExisting(a, d);
        if (id) await updatePayload(id, a.payload);
      }
      return;
    }
    console.warn("[activities] plaatsen mislukt:", error.message);
    return;
  }
  if (data?.id) await notify(data.id as string);
}

async function insertActivity(a: PostInput): Promise<string | null> {
  const { data, error } = await supabase
    .from("activities")
    .insert({ group_id: a.groupId, user_id: a.userId, type: a.type, payload: a.payload, workout_id: a.workoutId ?? null })
    .select("id")
    .single();
  if (error || !data) {
    if (error && error.code !== "23505") console.warn("[activities] activiteit plaatsen mislukt:", error.message);
    return null;
  }
  return data.id as string;
}

/** Pushmelding naar de andere leden (fire-and-forget; de server bepaalt welke typen een melding krijgen). */
async function notify(activityId: string) {
  try {
    const { data: session } = await supabase.auth.getSession();
    await fetch("/api/push/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token ?? ""}` },
      body: JSON.stringify({ activityId }),
    });
  } catch {
    // Melding is niet essentieel.
  }
}
