"use client";

import type { BuilderValue } from "@/components/WorkoutBuilder";
import { supabase } from "@/lib/supabase";

type PgError = { code?: string; message?: string };

/** De RPC bestaat nog niet (upgrade-groups.sql niet gedraaid). */
function missingFunction(e: PgError | null): boolean {
  if (!e) return false;
  return e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? "");
}

/**
 * Slaat een groepstraining op. Bij voorkeur in één transactie (RPC save_group_workout); zonder
 * die functie stap voor stap. `knownId` is het id van een training die bij een eerdere,
 * mislukte poging al is aangemaakt: dan wordt die bijgewerkt in plaats van een tweede gemaakt.
 * `onCreated` meldt een nieuw aangemaakt id zodat de aanroeper het kan onthouden.
 */
export async function saveGroupWorkout(
  groupId: string,
  knownId: string | null,
  v: BuilderValue,
  onCreated: (id: string) => void,
): Promise<string> {
  const items = v.items.map((it) => ({
    id: it.id ?? null,
    slug: it.slug,
    sets: it.sets,
    reps: it.reps || "8-12",
    notes: it.notes?.trim() || null,
  }));

  const rpc = await supabase.rpc("save_group_workout", {
    p_group_id: groupId,
    p_workout_id: knownId,
    p_title: v.title,
    p_date: v.date,
    p_notes: v.notes || null,
    p_items: items,
  });
  if (!rpc.error) return rpc.data as string;
  if (!missingFunction(rpc.error)) throw rpc.error;

  // Terugval zonder RPC.
  const fields = { title: v.title, date: v.date, notes: v.notes || null };
  let workoutId = knownId;
  if (workoutId) {
    const { error } = await supabase.from("workouts").update(fields).eq("id", workoutId).eq("group_id", groupId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from("workouts").insert({ ...fields, group_id: groupId }).select("id").single();
    if (error) throw error;
    workoutId = data.id as string;
    onCreated(workoutId);
  }

  const rows = items.map((it, position) => ({
    workout_id: workoutId,
    exercise_slug: it.slug,
    position,
    target_sets: it.sets,
    target_reps: it.reps,
    notes: it.notes,
  }));

  // Bestaande oefeningen bijwerken (gelogde sets blijven behouden), verwijderde weghalen, nieuwe toevoegen.
  const keep = items.filter((it) => it.id).map((it) => it.id!);
  let del = supabase.from("workout_exercises").delete().eq("workout_id", workoutId);
  if (keep.length) del = del.not("id", "in", `(${keep.join(",")})`);
  const { error: delErr } = await del;
  if (delErr) throw delErr;

  const existing = rows.map((r, i) => ({ ...r, id: items[i].id })).filter((r): r is typeof r & { id: string } => !!r.id);
  if (existing.length) {
    const { error } = await supabase.from("workout_exercises").upsert(existing, { onConflict: "id" });
    if (error) throw error;
  }
  const fresh = rows.filter((_, i) => !items[i].id);
  if (fresh.length) {
    const { error } = await supabase.from("workout_exercises").insert(fresh);
    if (error) throw error;
  }
  return workoutId;
}

/**
 * Meldt de leden dat er een training is gepland of aangepast (pushmelding). Fire-and-forget en met
 * keepalive, zodat het verzoek ook doorgaat als de pagina meteen daarna wegnavigeert.
 */
export async function notifyGroupWorkout(workoutId: string, kind: "new" | "edit"): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch("/api/push/group-workout", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ workoutId, kind }),
    });
  } catch {
    // Een melding is niet essentieel.
  }
}
