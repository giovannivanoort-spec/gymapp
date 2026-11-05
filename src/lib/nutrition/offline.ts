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
 * Verwijderen zonder verbinding. Items die zelf nog in de wachtrij stonden, verdwijnen daar gewoon
 * uit (ze hebben de server nooit bereikt).
 */
export async function queueDelete(ids: string[]) {
  const by = await currentUser();
  const set = new Set(ids);
  const ops = read();
  const local = new Set(ops.flatMap((o) => (o.kind === "insert" ? o.rows.map((r) => r.id) : [])));
  const next = ops.map((o) =>
    o.kind === "insert" ? { ...o, rows: o.rows.filter((r) => !set.has(r.id)) } : o.kind === "confirm" ? { ...o, ids: o.ids.filter((id) => !set.has(id)) } : o,
  );
  const remote = ids.filter((id) => !local.has(id));
  write(remote.length ? [...next, { kind: "delete", ids: remote, by, at: Date.now() }] : next);
}

/** Gepland eten bevestigen zonder verbinding. */
export async function queueConfirm(ids: string[]) {
  const by = await currentUser();
  const set = new Set(ids);
  const ops = read();
  const local = new Set(ops.flatMap((o) => (o.kind === "insert" ? o.rows.map((r) => r.id) : [])));
  const next = ops.map((o) => (o.kind === "insert" ? { ...o, rows: o.rows.map((r) => (set.has(r.id) ? { ...r, planned: false } : r)) } : o));
  const remote = ids.filter((id) => !local.has(id));
  write(remote.length ? [...next, { kind: "confirm", ids: remote, by, at: Date.now() }] : next);
}

const localIds = (ops: NutritionOp[]) => new Set(ops.flatMap((o) => (o.kind === "insert" ? o.rows.map((r) => r.id) : [])));

/**
 * Items die nog alleen in de wachtrij staan, daar verwijderen. Geeft de ids terug die wel op de
 * server staan (die moeten echt verwijderd worden).
 */
export function dropLocal(ids: string[]): string[] {
  const ops = read();
  const local = localIds(ops);
  if (!ids.some((id) => local.has(id))) return ids;
  const set = new Set(ids);
  write(ops.map((o) => (o.kind === "insert" ? { ...o, rows: o.rows.filter((r) => !set.has(r.id)) } : o)));
  return ids.filter((id) => !local.has(id));
}

/** Als dropLocal, maar dan bevestigen: wachtende items worden in de wachtrij zelf bevestigd. */
export function confirmLocal(ids: string[]): string[] {
  const ops = read();
  const local = localIds(ops);
  if (!ids.some((id) => local.has(id))) return ids;
  const set = new Set(ids);
  write(ops.map((o) => (o.kind === "insert" ? { ...o, rows: o.rows.map((r) => (set.has(r.id) ? { ...r, planned: false } : r)) } : o)));
  return ids.filter((id) => !local.has(id));
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
    for (const op of read()) {
      if (op.by && op.by !== uid) continue;
      const res =
        op.kind === "insert"
          ? await supabase.from("food_logs").upsert(op.rows.map(dbRow), { onConflict: "id", ignoreDuplicates: true })
          : op.kind === "delete"
            ? await supabase.from("food_logs").delete().in("id", op.ids)
            : await supabase.from("food_logs").update({ planned: false }).in("id", op.ids);
      if (res.error && isRetryableError({ ...res.error, status: res.status })) break;
      // Alleen deze bewerking weghalen; wat er intussen bij kwam blijft staan.
      const raw = JSON.stringify(op);
      write(read().filter((o) => JSON.stringify(o) !== raw));
      if (res.error) failed++;
      else sent++;
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
