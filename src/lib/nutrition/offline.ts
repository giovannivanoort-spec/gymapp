"use client";

import { useSyncExternalStore } from "react";
import { isRetryableError, supabase } from "../supabase";
import type { FoodLog } from "./log";

/**
 * Wachtrij voor het voedingsdagboek zonder internet (toevoegen, bevestigen, verwijderen).
 * Bewerkingen worden in de browser bewaard en verstuurd zodra er weer verbinding is. Elke regel
 * heeft al een eigen id, dus nog een keer versturen (bijv. na een wegvallend antwoord) geeft nooit
 * een dubbel item. Het dagboek voegt wachtende items samen met wat de server teruggeeft.
 */

export type NutritionOp =
  | { kind: "insert"; rows: FoodLog[]; by?: string; at: number }
  | { kind: "delete"; ids: string[]; by?: string; at: number }
  | { kind: "confirm"; ids: string[]; by?: string; at: number };

const KEY = "gymapp-nutrition-queue";
const EVENT = "gymapp-nutrition-queue-change";

function read(): NutritionOp[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(ops: NutritionOp[]) {
  // Lege bewerkingen opruimen (bijv. een insert waarvan alle items weer zijn verwijderd).
  const clean = ops.filter((o) => (o.kind === "insert" ? o.rows.length > 0 : o.ids.length > 0));
  try {
    if (clean.length) localStorage.setItem(KEY, JSON.stringify(clean));
    else localStorage.removeItem(KEY);
  } catch {
    // opslag niet beschikbaar (privévenster): dan helaas niet offline bewaren
  }
  window.dispatchEvent(new Event(EVENT));
}

async function currentUser(): Promise<string | undefined> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id;
  } catch {
    return undefined;
  }
}

/** Nieuwe items bewaren tot ze verstuurd kunnen worden. */
export async function queueInsert(rows: FoodLog[]) {
  const by = await currentUser();
  write([...read(), { kind: "insert", rows: rows.map((r) => ({ ...r, pending: undefined })), by, at: Date.now() }]);
}

/**
 * Verwijderen zonder verbinding. Items die zelf nog in de wachtrij stonden, verdwijnen daar uit.
 * De verwijdering gaat toch mee voor alle ids: een item uit de wachtrij kan de server al hebben
 * bereikt (antwoord weggevallen). Een niet-bestaand id verwijderen is onschuldig.
 */
export async function queueDelete(ids: string[]) {
  const by = await currentUser();
  const set = new Set(ids);
  const next = read().map((o) =>
    o.kind === "insert" ? { ...o, rows: o.rows.filter((r) => !set.has(r.id)) } : o.kind === "confirm" ? { ...o, ids: o.ids.filter((id) => !set.has(id)) } : o,
  );
  write(ids.length ? [...next, { kind: "delete", ids, by, at: Date.now() }] : next);
}

/**
 * Gepland eten bevestigen zonder verbinding. Ook voor items uit de wachtrij gaat er een bevestiging
 * mee (na hun insert): staat het item al op de server, dan slaat de insert het over.
 */
export async function queueConfirm(ids: string[]) {
  const by = await currentUser();
  const set = new Set(ids);
  const next = read().map((o) => (o.kind === "insert" ? { ...o, rows: o.rows.map((r) => (set.has(r.id) ? { ...r, planned: false } : r)) } : o));
  write(ids.length ? [...next, { kind: "confirm", ids, by, at: Date.now() }] : next);
}

const localIds = (ops: NutritionOp[]) => new Set(ops.flatMap((o) => (o.kind === "insert" ? o.rows.map((r) => r.id) : [])));

/**
 * Items die in de wachtrij staan, daar verwijderen. Geeft alle ids terug: ook een item uit de
 * wachtrij kan de server al hebben bereikt (insert gelukt, antwoord weggevallen, of de wachtrij was
 * het net aan het versturen), dus de verwijdering moet altijd ook naar de server.
 */
export function dropLocal(ids: string[]): string[] {
  const ops = read();
  const local = localIds(ops);
  if (!ids.some((id) => local.has(id))) return ids;
  const set = new Set(ids);
  write(ops.map((o) => (o.kind === "insert" ? { ...o, rows: o.rows.filter((r) => !set.has(r.id)) } : o)));
  return ids;
}

/** Als dropLocal, maar dan bevestigen: wachtende items worden in de wachtrij én op de server bevestigd. */
export function confirmLocal(ids: string[]): string[] {
  const ops = read();
  const local = localIds(ops);
  if (!ids.some((id) => local.has(id))) return ids;
  const set = new Set(ids);
  write(ops.map((o) => (o.kind === "insert" ? { ...o, rows: o.rows.map((r) => (set.has(r.id) ? { ...r, planned: false } : r)) } : o)));
  return ids;
}

/** Staat dit item nog in de wachtrij (nog niet op de server)? */
export function isQueued(id: string): boolean {
  return localIds(read()).has(id);
}

/**
 * "Ongedaan maken" van een verwijdering die nog in de wachtrij staat: die verwijdering schrappen.
 * Geeft de ids terug die echt (online) teruggezet moeten worden.
 */
export function cancelQueuedDeletes(ids: string[]): string[] {
  const set = new Set(ids);
  const ops = read();
  const queued = new Set(ops.flatMap((o) => (o.kind === "delete" ? o.ids : [])));
  if (!ids.some((id) => queued.has(id))) return ids;
  write(ops.map((o) => (o.kind === "delete" ? { ...o, ids: o.ids.filter((id) => !set.has(id)) } : o)));
  return ids.filter((id) => !queued.has(id));
}

/** Wachtende bewerkingen toepassen op wat de server teruggaf (voor dagen van `from` t/m `to`). */
export async function applyQueue(logs: FoodLog[], from: string, to: string): Promise<FoodLog[]> {
  const ops = read();
  if (!ops.length) return logs;
  const uid = await currentUser();
  let out = logs;
  for (const op of ops) {
    if (op.by && uid && op.by !== uid) continue;
    if (op.kind === "insert") {
      const known = new Set(out.map((l) => l.id));
      const extra = op.rows.filter((r) => r.date >= from && r.date <= to && !known.has(r.id)).map((r) => ({ ...r, pending: true }));
      if (extra.length) out = [...out, ...extra];
    } else if (op.kind === "delete") {
      const set = new Set(op.ids);
      out = out.filter((l) => !set.has(l.id));
    } else {
      const set = new Set(op.ids);
      out = out.map((l) => (set.has(l.id) ? { ...l, planned: false } : l));
    }
  }
  return [...out].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Een rij zoals de database hem verwacht (zonder lokale velden). */
function dbRow(r: FoodLog) {
  return {
    id: r.id,
    date: r.date,
    meal: r.meal,
    food_id: r.food_id,
    source: r.source,
    name: r.name,
    brand: r.brand,
    grams: r.grams,
    portion_label: r.portion_label,
    per100: r.per100,
    kcal: r.kcal,
    protein: r.protein,
    carbs: r.carbs,
    fat: r.fat,
    planned: r.planned,
    created_at: r.created_at,
  };
}

let flushing = false;

/**
 * Een insert is verstuurd: hem uit de wachtrij halen. Werd er intussen (tijdens het versturen) een
 * item uit verwijderd of bevestigd, dan stond de oude versie al op de server: die wijziging gaat
 * er als eigen bewerking direct achteraan (alleen als de insert lukte: `ok`). Geeft true als er
 * zo'n vervolgbewerking bij kwam.
 */
function settleInsert(op: Extract<NutritionOp, { kind: "insert" }>, ok: boolean): boolean {
  const sent = new Map(op.rows.map((r) => [r.id, r]));
  const ops = read();
  const i = ops.findIndex((o) => o.kind === "insert" && o.at === op.at && o.by === op.by && o.rows.some((r) => sent.has(r.id)));
  const current = i >= 0 ? (ops[i] as Extract<NutritionOp, { kind: "insert" }>) : null;
  const now = new Map((current?.rows ?? []).map((r) => [r.id, r]));
  const gone = [...sent.keys()].filter((id) => !now.has(id));
  const confirmed = [...sent.values()].filter((r) => r.planned && now.get(r.id)?.planned === false).map((r) => r.id);
  const follow: NutritionOp[] = !ok ? [] : [
    ...(gone.length ? [{ kind: "delete" as const, ids: gone, by: op.by, at: Date.now() }] : []),
    ...(confirmed.length ? [{ kind: "confirm" as const, ids: confirmed, by: op.by, at: Date.now() }] : []),
  ];
  // Op dezelfde plek, zodat een latere bewerking (bijv. ongedaan maken) er nog steeds na komt.
  if (current) write([...ops.slice(0, i), ...follow, ...ops.slice(i + 1)]);
  else if (follow.length) write([...follow, ...ops]);
  return follow.length > 0;
}

/**
 * Verstuurt de wachtrij in volgorde. Stopt bij netwerk-, sessie- of serverproblemen (die blijven
 * staan); een echte fout (bijv. ongeldige waarde) gooit alleen die bewerking weg en telt als mislukt.
 */
export async function flushNutritionQueue(): Promise<{ sent: number; failed: number }> {
  if (flushing || typeof navigator === "undefined" || !navigator.onLine || !read().length) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0;
  let failed = 0;
  try {
    const uid = await currentUser();
    if (!uid) return { sent, failed };
    // Een paar rondes: vervolgbewerkingen (zie settleInsert) gaan dan meteen mee.
    for (let pass = 0; pass < 3; pass++) {
      let again = false;
      let stop = false;
      for (const op of read()) {
        if (op.by && op.by !== uid) continue;
        const res =
          op.kind === "insert"
            ? await supabase.from("food_logs").upsert(op.rows.map(dbRow), { onConflict: "id", ignoreDuplicates: true })
            : op.kind === "delete"
              ? await supabase.from("food_logs").delete().in("id", op.ids)
              : await supabase.from("food_logs").update({ planned: false }).in("id", op.ids);
        if (res.error && isRetryableError({ ...res.error, status: res.status })) {
          stop = true;
          break;
        }
        if (op.kind === "insert") {
          if (settleInsert(op, !res.error)) again = true;
        } else {
          // Alleen deze bewerking weghalen; wat er intussen bij kwam blijft staan.
          const raw = JSON.stringify(op);
          write(read().filter((o) => JSON.stringify(o) !== raw));
        }
        if (res.error) failed++;
        else sent++;
      }
      if (stop || !again) break;
    }
  } finally {
    flushing = false;
  }
  return { sent, failed };
}

/* ───────── React: live meekijken ───────── */

let rawSnap: string | null = null;
let snap: NutritionOp[] = [];
const EMPTY: NutritionOp[] = [];

function snapshot(): NutritionOp[] {
  let next: string | null = null;
  try {
    next = localStorage.getItem(KEY);
  } catch {
    next = null;
  }
  if (next !== rawSnap) {
    rawSnap = next;
    snap = next ? read() : EMPTY;
  }
  return snap;
}

function subscribe(fn: () => void) {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}

/** Aantal wachtende wijzigingen (items) in het voedingsdagboek. */
export function useNutritionQueue(): number {
  const ops = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  return ops.reduce((a, o) => a + (o.kind === "insert" ? o.rows.length : o.ids.length), 0);
}
