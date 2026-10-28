"use client";

import { supabase } from "./supabase";

/**
 * Wachtrij voor sets die zonder internet zijn ingevuld. Ze worden in de browser bewaard
 * (localStorage) en verstuurd zodra er weer verbinding is.
 */

type SetKey = { workout_exercise_id: string; user_id: string; set_number: number };
export type QueuedOp =
  | { kind: "upsert"; row: SetKey & { weight: number | null; reps: number | null } }
  | { kind: "delete"; key: SetKey };

const STORAGE_KEY = "gymapp-offline-queue";
export const QUEUE_EVENT = "gymapp-queue-change";
export const SYNCED_EVENT = "gymapp-synced";

export function readQueue(): QueuedOp[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedOp[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(q));
  } catch {
    // opslag niet beschikbaar (privévenster): dan helaas niet offline bewaren
  }
  window.dispatchEvent(new Event(QUEUE_EVENT));
}

const sameSet = (a: SetKey, b: SetKey) =>
  a.workout_exercise_id === b.workout_exercise_id && a.user_id === b.user_id && a.set_number === b.set_number;

/** Voegt een bewerking toe; een nieuwere bewerking op dezelfde set vervangt de oude. */
export function enqueue(op: QueuedOp) {
  const key = op.kind === "upsert" ? op.row : op.key;
  const q = readQueue().filter((o) => !sameSet(o.kind === "upsert" ? o.row : o.key, key));
  writeQueue([...q, op]);
}

/** Is dit een netwerkfout (geen verbinding) en geen echte fout van de database? */
export function isNetworkError(error: { message?: string } | null | undefined): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return !!error?.message && /failed to fetch|networkerror|load failed|network request failed/i.test(error.message);
}

let flushing = false;

/** Verstuurt de wachtrij. Stopt bij de eerste netwerkfout; echte fouten worden overgeslagen. */
export async function flushQueue(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const op of readQueue()) {
      const { error } =
        op.kind === "upsert"
          ? await supabase.from("set_logs").upsert(op.row, { onConflict: "workout_exercise_id,user_id,set_number" })
          : await supabase
              .from("set_logs")
              .delete()
              .eq("workout_exercise_id", op.key.workout_exercise_id)
              .eq("user_id", op.key.user_id)
              .eq("set_number", op.key.set_number);
      if (error && isNetworkError(error)) break;
      const key = op.kind === "upsert" ? op.row : op.key;
      writeQueue(readQueue().filter((o) => !sameSet(o.kind === "upsert" ? o.row : o.key, key)));
      sent++;
    }
  } finally {
    flushing = false;
  }
  if (sent) window.dispatchEvent(new Event(SYNCED_EVENT));
  return sent;
}
