"use client";

import type { BuilderValue } from "@/components/WorkoutBuilder";
import { defaultTargetReps } from "@/lib/exercises";
import { supabase } from "@/lib/supabase";

type PgError = { code?: string; message?: string };

/** De RPC bestaat nog niet (upgrade-groups.sql niet gedraaid). */
function missingFunction(e: PgError | null): boolean {
  if (!e) return false;
  return e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? "");
}

/** Een oefening in een plan, zoals de planner hem stuurt en zoals hij in workout_exercises staat. */
export type PlanLine = { slug: string; sets: number | null | undefined; reps: string | null | undefined };

/**
 * Inhoud van een plan (oefening, sets x herhalingen, op volgorde), genormaliseerd zoals
 * save_group_workout het opslaat (sets minimaal 1, herhalingen getrimd, standaard 8-12). Zo is
 * wat de planner stuurt te vergelijken met wat de trainingspagina daarna ophaalt.
 */
export function planContent(lines: readonly PlanLine[]): string {
  return lines
    .map((l) => {
      const n = Number(l.sets ?? 3);
      const sets = Math.max(1, Number.isFinite(n) ? Math.round(n) : 3);
      const reps = (l.reps ?? "").trim() || "8-12";
      return `${l.slug}:${sets}:${reps}`;
    })
    .join("|");
}

/** Wat er op dit toestel met een training is gedaan: het plan opgeslagen, of hem verwijderd. */
export type OwnSaveKind = "save" | "delete";

/**
 * Wanneer een training op dit toestel voor het laatst zelf is opgeslagen of verwijderd, en met welk
 * plan. In het geheugen en in localStorage, zodat ook een ander tabblad (de training open op de
 * achtergrond) het weet.
 */
type OwnSave = { at: number; kind: OwnSaveKind; plan?: string };
const ownSaves = new Map<string, OwnSave>();
const OWN_SAVES_KEY = "spotter-own-saves";
/** Oudere markeringen zijn niet meer nodig en worden bij het volgende opslaan opgeruimd. */
const OWN_SAVE_KEEP_MS = 60_000;

function asOwnSave(v: unknown): OwnSave | null {
  if (!v || typeof v !== "object" || typeof (v as OwnSave).at !== "number") return null;
  const { at, kind, plan } = v as Partial<OwnSave> & { at: number };
  const entry: OwnSave = { at, kind: kind === "delete" ? "delete" : "save" };
  if (typeof plan === "string") entry.plan = plan;
  return entry;
}

function readOwnSaves(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(OWN_SAVES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Schrijft de markering van deze training (of haalt hem weg) en ruimt oude markeringen op. */
function writeOwnSave(workoutId: string, entry: OwnSave | null) {
  if (entry) ownSaves.set(workoutId, entry);
  else ownSaves.delete(workoutId);
  try {
    const now = Date.now();
    const next: Record<string, OwnSave> = entry ? { [workoutId]: entry } : {};
    for (const [k, v] of Object.entries(readOwnSaves())) {
      const o = asOwnSave(v);
      if (k !== workoutId && o && now - o.at < OWN_SAVE_KEEP_MS) next[k] = o;
    }
    localStorage.setItem(OWN_SAVES_KEY, JSON.stringify(next));
  } catch {
    // Geen opslag beschikbaar (privévenster): alleen dit tabblad weet het.
  }
}

/**
 * Onthoudt dat deze training net op dit toestel is aangepast (`kind` "save", met het opgeslagen
 * plan uit planContent) of verwijderd ("delete"), zodat de live update op de trainingspagina
 * (src/components/workout/useLivePlan.ts) de eigen actie herkent: geen melding "De trainer heeft de
 * training aangepast", en bij verwijderen de eigen tekst.
 * Roep dit aan op elke plek die een bestaande training of de oefeningen ervan aanpast of
 * verwijdert: `saveGroupWorkout` hieronder (planscherm en "week herhalen") en het verwijderen op
 * het planscherm. De coach maakt alleen nieuwe trainingen aan, die nog niemand open heeft.
 */
export function markOwnSave(workoutId: string, opts: { kind?: OwnSaveKind; plan?: string } = {}) {
  const entry: OwnSave = { at: Date.now(), kind: opts.kind ?? "save" };
  if (opts.plan !== undefined) entry.plan = opts.plan;
  writeOwnSave(workoutId, entry);
}

/** Haalt de markering weg, bijv. als het verwijderen toch niet lukte. */
export function forgetOwnSave(workoutId: string) {
  writeOwnSave(workoutId, null);
}

/**
 * Is deze training in de laatste `ms` milliseconden op dit toestel (in welk tabblad ook) zelf
 * aangepast (`kind` "save") of verwijderd ("delete")? Met `plan`: alleen als dat ook het plan is
 * dat hier werd opgeslagen. Past een tweede trainer kort daarna iets anders aan of verwijdert hij
 * de training, dan is dat dus geen eigen actie.
 */
export function isRecentOwnSave(workoutId: string, opts: { kind?: OwnSaveKind; plan?: string; ms?: number } = {}): boolean {
  const { kind = "save", plan, ms = 15_000 } = opts;
  const mem = ownSaves.get(workoutId) ?? null;
  const stored = asOwnSave(readOwnSaves()[workoutId]);
  const last = !stored || (mem && mem.at >= stored.at) ? mem : stored;
  if (!last || last.kind !== kind || Date.now() - last.at >= ms) return false;
  return plan === undefined || last.plan === undefined || last.plan === plan;
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
    // Getrimd, zodat de terugval hieronder hetzelfde opslaat als de RPC.
    reps: it.reps?.trim() || defaultTargetReps(it.slug),
    notes: it.notes?.trim() || null,
  }));
  const plan = planContent(items);

  // Vooraf al markeren: de live update kan binnenkomen voordat het antwoord er is.
  if (knownId) markOwnSave(knownId, { plan });
  const rpc = await supabase.rpc("save_group_workout", {
    p_group_id: groupId,
    p_workout_id: knownId,
    p_title: v.title,
    p_date: v.date,
    p_notes: v.notes || null,
    p_items: items,
  });
  if (!rpc.error) {
    markOwnSave(rpc.data as string, { plan });
    return rpc.data as string;
  }
  if (!missingFunction(rpc.error)) throw rpc.error;

  // Terugval zonder RPC.
  const fields = { title: v.title, date: v.date, notes: v.notes || null };
  let workoutId = knownId;
  if (!workoutId) {
    const { data, error } = await supabase.from("workouts").insert({ ...fields, group_id: groupId }).select("id").single();
    if (error) throw error;
    workoutId = data.id as string;
    onCreated(workoutId);
  }
  // Een bestaande training krijgt zijn titel, datum en notities pas hieronder, na de oefeningen.

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
  // Eén keer, en als laatste: open trainingspagina's krijgen via deze rij een live signaal en halen
  // dan het plan op. Zo komt dat signaal pas als alle oefeningen er staan (nooit een half plan).
  if (knownId) {
    const { error } = await supabase.from("workouts").update(fields).eq("id", workoutId).eq("group_id", groupId);
    if (error) throw error;
  }
  markOwnSave(workoutId, { plan });
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
