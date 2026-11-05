"use client";

import {
  type CachedState,
  forgetPersisted,
  getCached,
  hardInvalidationSeq,
  invalidate,
  setCached,
  useCached,
  useCachedState,
} from "./cache";
import { estimate1RM } from "./ranks";
import { supabase } from "./supabase";

/** Eén gelogde set met de training en oefening waar hij bij hoort. */
export type HistorySet = {
  date: string;
  workoutId: string;
  workoutTitle: string;
  groupName: string | null;
  workoutExerciseId: string;
  slug: string;
  position: number;
  targetSets: number;
  targetReps: string;
  setNumber: number;
  weight: number | null;
  reps: number | null;
  /** Moment van loggen (ISO). Nodig om alleen het nieuwste deel opnieuw op te halen. */
  createdAt?: string;
};

type Row = {
  set_number: number;
  weight: number | null;
  reps: number | null;
  created_at: string;
  workout_exercise_id: string;
  workout_exercises: {
    exercise_slug: string;
    position: number;
    target_sets: number;
    target_reps: string;
    workout_id: string;
    workouts: { date: string; title: string; groups: { name: string } | null };
  };
};

const SELECT =
  "set_number, weight, reps, created_at, workout_exercise_id, workout_exercises!inner(exercise_slug, position, target_sets, target_reps, workout_id, workouts!inner(date, title, groups(name)))";
const PAGE = 1000;

/**
 * Bij bijwerken alleen sets opnieuw ophalen die zijn gelogd na (nieuwste bekende set - dit venster).
 * Binnen het venster wordt alles vervangen, dus ook gewiste of aangepaste sets kloppen weer.
 */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Zo vaak halen we toch alles opnieuw op (aanpassingen in oude trainingen, verwijderde trainingen). */
const FULL_SYNC_MS = 12 * 60 * 60 * 1000;

const historyKey = (userId: string | null) => (userId ? `history:${userId}` : null);
const syncKey = (userId: string) => `history-sync:${userId}`;

type SyncMeta = { fullAt: number };

/** Hardere invalidate-volgnummers per persoon bij de laatste volledige sync (alleen in dit tabblad). */
const fullSyncSeq = new Map<string, number>();

function toSet(r: Row): HistorySet {
  const we = r.workout_exercises;
  return {
    date: we.workouts.date,
    workoutId: we.workout_id,
    workoutTitle: we.workouts.title,
    groupName: we.workouts.groups?.name ?? null,
    workoutExerciseId: r.workout_exercise_id,
    slug: we.exercise_slug,
    position: we.position,
    targetSets: we.target_sets,
    targetReps: we.target_reps,
    setNumber: r.set_number,
    weight: r.weight != null ? Number(r.weight) : null,
    reps: r.reps,
    createdAt: r.created_at,
  };
}

/**
 * Gelogde sets van één persoon (in pagina's, Supabase geeft max. 1000 rijen terug), optioneel
 * alleen vanaf een moment. Gooit een fout als één van de pagina's mislukt: een half of leeg
 * resultaat mag nooit in de cache terechtkomen.
 */
async function fetchRows(userId: string, since?: string): Promise<HistorySet[]> {
  const out: HistorySet[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from("set_logs").select(SELECT).eq("user_id", userId).not("reps", "is", null);
    if (since) query = query.gte("created_at", since);
    const { data, error } = await query
      .order("created_at")
      // Vaste volgorde bij gelijke tijdstippen, zodat er over paginagrenzen niets dubbel gaat of wegvalt.
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data) throw new Error("Geen antwoord van de server.");
    for (const r of data as unknown as Row[]) out.push(toSet(r));
    if (data.length < PAGE) break;
  }
  return out;
}

/** Kan de bekende geschiedenis aangevuld worden, of is een volledige sync nodig? */
function incrementalBase(userId: string): HistorySet[] | null {
  const key = historyKey(userId)!;
  const base = getCached<HistorySet[]>(key);
  const meta = getCached<SyncMeta>(syncKey(userId));
  if (!base?.length || !meta || Date.now() - meta.fullAt > FULL_SYNC_MS) return null;
  // Na een "harde" invalidate (training verwijderd, groep verlaten) alles opnieuw.
  if (hardInvalidationSeq(key) > (fullSyncSeq.get(userId) ?? 0)) return null;
  // Oude kopie zonder tijdstippen (van voor deze versie): volledig ophalen.
  if (!base.every((s) => s.createdAt && Number.isFinite(Date.parse(s.createdAt)))) return null;
  return base;
}

/**
 * Alle gelogde sets van één persoon, oud naar nieuw.
 *
 * Standaard incrementeel: is er een recente volledige kopie, dan worden alleen de sets van de
 * laatste week (gerekend vanaf de nieuwste bekende set) opnieuw opgehaald en samengevoegd. Dat
 * houdt Home en Progressie snel, ook na jaren loggen. Elke 12 uur, na een harde invalidate en
 * met `{ full: true }` wordt alles opgehaald.
 */
export async function fetchHistory(userId: string, { full = false }: { full?: boolean } = {}): Promise<HistorySet[]> {
  const base = full ? null : incrementalBase(userId);
  if (!base) {
    const seqAtStart = hardInvalidationSeq(historyKey(userId)!);
    const all = await fetchRows(userId);
    fullSyncSeq.set(userId, seqAtStart);
    setCached<SyncMeta>(syncKey(userId), { fullAt: Date.now() }, true);
    return all;
  }
  let newest = 0;
  for (const s of base) newest = Math.max(newest, Date.parse(s.createdAt!));
  const cutoff = newest - WINDOW_MS;
  const recent = await fetchRows(userId, new Date(cutoff).toISOString());
  // Date.parse kapt microseconden af, net als de grens hierboven: precies één van beide kanten
  // bevat een set, nooit beide en nooit geen van beide.
  const kept = base.filter((s) => Date.parse(s.createdAt!) < cutoff);
  return kept.length === base.length && !recent.length ? base : [...kept, ...recent];
}

/** Samenvatting van één oefening in één training. */
export type Session = {
  date: string;
  workoutId: string;
  workoutTitle: string;
  sets: HistorySet[];
  /** Beste geschatte 1RM (kg), of null als er geen gewicht/geldige reps zijn. */
  best1RM: number | null;
  /** Set met de hoogste geschatte 1RM, anders de set met de meeste reps. */
  bestSet: HistorySet;
  maxReps: number;
  /** Totaal kg × reps. */
  volume: number;
};

/** Per oefening: sessies op datum (oud → nieuw). */
export function sessionsBySlug(history: HistorySet[]): Map<string, Session[]> {
  const byWe = new Map<string, HistorySet[]>();
  for (const s of history) {
    const list = byWe.get(s.workoutExerciseId);
    if (list) list.push(s);
    else byWe.set(s.workoutExerciseId, [s]);
  }

  const bySlug = new Map<string, Session[]>();
  for (const sets of byWe.values()) {
    sets.sort((a, b) => a.setNumber - b.setNumber);
    const scored = sets.map((s) => ({ s, e: estimate1RM(s.weight ?? 0, s.reps ?? 0) }));
    const withE = scored.filter((x) => x.e != null);
    const best = withE.length ? withE.reduce((a, b) => (b.e! > a.e! ? b : a)) : null;
    const session: Session = {
      date: sets[0].date,
      workoutId: sets[0].workoutId,
      workoutTitle: sets[0].workoutTitle,
      sets,
      best1RM: best ? Math.round(best.e! * 10) / 10 : null,
      bestSet: best?.s ?? sets.reduce((a, b) => ((b.reps ?? 0) > (a.reps ?? 0) ? b : a)),
      maxReps: Math.max(...sets.map((s) => s.reps ?? 0)),
      volume: sets.reduce((v, s) => v + (s.weight ?? 0) * (s.reps ?? 0), 0),
    };
    const slug = sets[0].slug;
    const list = bySlug.get(slug);
    if (list) list.push(session);
    else bySlug.set(slug, [session]);
  }
  for (const list of bySlug.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return bySlug;
}

export function formatSet(s: { weight: number | null; reps: number | null }): string {
  const w = s.weight ? `${s.weight.toLocaleString("nl-NL")} kg × ` : "";
  return `${w}${s.reps ?? "–"}${s.weight ? "" : " reps"}`;
}

export const nl = (n: number, digits = 1) => n.toLocaleString("nl-NL", { maximumFractionDigits: digits });

// ─────────── Wie is er ingelogd (alleen de eigen geschiedenis bewaren) ───────────

let selfId: string | null = null;
if (typeof window !== "undefined") {
  supabase.auth
    .getSession()
    .then(({ data }) => {
      selfId = data.session?.user.id ?? null;
    })
    .catch(() => {});
  supabase.auth.onAuthStateChange((_event, session) => {
    selfId = session?.user.id ?? null;
  });
}

/**
 * Standaard ("auto") wordt je eigen geschiedenis altijd in localStorage bewaard (direct beeld bij
 * openen). Van vrienden alleen zolang die klein is: grote geschiedenissen van anderen zouden het
 * opslagbudget opeten en elkaar (en jouw data) steeds wegdrukken. Die worden bij openen gewoon
 * opnieuw opgehaald en een eerdere, te grote kopie wordt opgeruimd.
 */
const MAX_FRIEND_PERSIST_SETS = 600;

function persistFor(userId: string | null, persist: boolean | "auto"): boolean | ((data: unknown) => boolean) {
  if (persist !== "auto") return persist;
  return (data) => {
    if (!userId) return false;
    if (userId === selfId) return true;
    const small = Array.isArray(data) && data.length <= MAX_FRIEND_PERSIST_SETS;
    if (!small) forgetPersisted(historyKey(userId)!);
    return small;
  };
}

/** Na eigen writes en realtime is de data al vers; dit is alleen het vangnet. */
const HISTORY_MAX_AGE = 60_000;

/**
 * Alle gelogde sets van één persoon, gedeeld tussen pagina's (Home, Profiel, Ranks, Oefeningen,
 * Progressie). Toont direct de vorige stand en ververst op de achtergrond (incrementeel).
 */
export function useHistory(
  userId: string | null,
  { persist = "auto" }: { persist?: boolean | "auto" } = {},
): HistorySet[] | undefined {
  return useCached(historyKey(userId), () => fetchHistory(userId!), {
    persist: persistFor(userId, persist),
    maxAge: HISTORY_MAX_AGE,
  });
}

/**
 * Als useHistory, maar met fout- en laadstatus (voor een foutmelding met "Opnieuw" en een regel
 * als "Offline, bijgewerkt om 18:42"; zie components/platform/DataStatus).
 */
export function useHistoryState(
  userId: string | null,
  { persist = "auto" }: { persist?: boolean | "auto" } = {},
): CachedState<HistorySet[]> {
  return useCachedState(historyKey(userId), () => fetchHistory(userId!), {
    persist: persistFor(userId, persist),
    maxAge: HISTORY_MAX_AGE,
  });
}

/**
 * Na het loggen of wissen van sets: geschiedenis van deze persoon opnieuw laten ophalen.
 * Standaard volledig. Geef `workoutDate` (YYYY-MM-DD) mee als het om een training van de laatste
 * dagen gaat: dan volstaat het ophalen van alleen het nieuwste deel (veel sneller tijdens het loggen).
 */
export function invalidateHistory(userId: string, { workoutDate }: { workoutDate?: string } = {}) {
  const recent = !!workoutDate && Date.now() - Date.parse(`${workoutDate}T00:00:00`) < WINDOW_MS - 24 * 60 * 60 * 1000;
  invalidate(`history:${userId}`, { soft: recent });
}
