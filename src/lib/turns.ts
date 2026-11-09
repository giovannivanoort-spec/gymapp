"use client";

import { useSyncExternalStore } from "react";

/*
 * Om de beurt trainen (trainer logt voor meerdere personen op dezelfde oefening). Op dit toestel
 * bewaard, per account (een gedeelde telefoon of een ander account neemt de keuze niet over):
 * - of het aanstaat (`spotter:turns:<userId>`), standaard uit;
 * - per training wie er vandaag niet meedoet (`spotter:turns-skip:<userId>`), standaard doet iedereen mee.
 *
 * Elke lees- en schrijfactie op de opslag staat in try/catch: in een privévenster of met
 * geblokkeerde opslag geldt de keuze alleen tot de pagina opnieuw wordt geladen.
 */

const prefKey = (userId: string) => `spotter:turns:${userId}`;
const skipKey = (userId: string) => `spotter:turns-skip:${userId}`;
const isTurnsKey = (key: string) => key.startsWith("spotter:turns:") || key.startsWith("spotter:turns-skip:");
/** Alleen de laatste trainingen onthouden: oude keuzes zijn niet meer nodig. */
const SKIP_KEEP = 20;

type SkipStore = Record<string, { uids: string[]; at: number }>;

const listeners = new Set<() => void>();
/** Laatst gekozen waarden per sleutel als bewaren niet lukt. */
const memory = new Map<string, boolean | SkipStore>();
/** Gelezen snapshot per sleutel, zodat useSyncExternalStore steeds hetzelfde object terugkrijgt. */
const parsed = new Map<string, { raw: string | null; value: SkipStore }>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Aangepast in een ander tabblad: dat overnemen.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && !isTurnsKey(e.key)) return;
    if (e.key === null) memory.clear();
    else memory.delete(e.key);
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

// ─── Aan of uit ───

function readPref(userId: string): boolean {
  if (!userId) return false;
  const key = prefKey(userId);
  const mem = memory.get(key);
  if (typeof mem === "boolean") return mem;
  return readRaw(key) === "1";
}

/** Staat "om de beurt" aan voor deze kijker op dit toestel? Op de server altijd uit. */
export function useTurnsPref(userId: string): boolean {
  return useSyncExternalStore(subscribe, () => readPref(userId), () => false);
}

export function setTurnsPref(userId: string, on: boolean) {
  if (!userId) return;
  const key = prefKey(userId);
  memory.set(key, on);
  try {
    if (on) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
    // Bewaard: weer gewoon uit de opslag lezen (en wijzigingen uit andere tabbladen volgen).
    memory.delete(key);
  } catch {
    // Niet te bewaren: dan geldt de keuze tot de pagina opnieuw wordt geladen.
  }
  emit();
}

// ─── Wie doet er mee (per training) ───

function parseSkip(raw: string | null): SkipStore {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const out: SkipStore = {};
    for (const [workout, v] of Object.entries(data as Record<string, unknown>)) {
      const entry = v as { uids?: unknown; at?: unknown } | null;
      if (!entry || !Array.isArray(entry.uids)) continue;
      out[workout] = { uids: entry.uids.filter((u): u is string => typeof u === "string"), at: Number(entry.at) || 0 };
    }
    return out;
  } catch {
    return {};
  }
}

function readSkipStore(userId: string): SkipStore {
  const key = skipKey(userId);
  const mem = memory.get(key);
  if (mem && typeof mem === "object") return mem;
  const raw = readRaw(key);
  const cached = parsed.get(key);
  if (cached && cached.raw === raw) return cached.value;
  const value = parseSkip(raw);
  parsed.set(key, { raw, value });
  return value;
}

const NONE: readonly string[] = [];
const serverSkip = () => NONE;

/** Wie er bij deze training niet meedoet met om de beurt (standaard niemand). */
export function useTurnsSkip(userId: string, workoutId: string): readonly string[] {
  return useSyncExternalStore(subscribe, () => (userId ? (readSkipStore(userId)[workoutId]?.uids ?? NONE) : NONE), serverSkip);
}

/** Iemand wel of niet laten meedoen bij deze training. */
export function setTakesPart(userId: string, workoutId: string, uid: string, takesPart: boolean) {
  if (!userId) return;
  const key = skipKey(userId);
  const store = readSkipStore(userId);
  const current = store[workoutId]?.uids ?? NONE;
  if (current.includes(uid) !== takesPart) return;
  const uids = takesPart ? current.filter((u) => u !== uid) : [...current, uid];
  const next: SkipStore = { ...store };
  if (uids.length) next[workoutId] = { uids, at: Date.now() };
  else delete next[workoutId];
  // Alleen de laatste trainingen bewaren.
  const trimmed: SkipStore = Object.fromEntries(
    Object.entries(next)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, SKIP_KEEP),
  );
  memory.set(key, trimmed);
  try {
    const raw = Object.keys(trimmed).length ? JSON.stringify(trimmed) : null;
    if (raw) window.localStorage.setItem(key, raw);
    else window.localStorage.removeItem(key);
    memory.delete(key);
    parsed.set(key, { raw, value: trimmed });
  } catch {
    // Niet te bewaren: in het geheugen houden tot de pagina opnieuw wordt geladen.
  }
  emit();
}
