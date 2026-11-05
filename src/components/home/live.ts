"use client";

import { useEffect, useSyncExternalStore } from "react";
import { fetchCached, useCached } from "@/lib/cache";
import { toISODate } from "@/lib/dates";

/**
 * Hulpjes voor Home, dat vaak in de sportschool met slecht bereik wordt geopend:
 * - `strict`: een mislukt of offline verzoek gooit een fout, zodat de cache de vorige (goede) data houdt
 *   in plaats van die te overschrijven met een lege lijst;
 * - `useLive`: `useCached` plus een register, zodat alles op de pagina opnieuw kan worden opgehaald
 *   wanneer de app terug op de voorgrond komt of weer online is;
 * - `useClock`: de datum en het dagdeel, die meelopen als de PWA dagen open blijft staan.
 */

// ───────────────────────── Status (offline / verversen mislukt) ─────────────────────────

const failing = new Set<string>();
const statusSubs = new Set<() => void>();

function mark(name: string, failed: boolean) {
  if (failed === failing.has(name)) return;
  if (failed) failing.add(name);
  else failing.delete(name);
  statusSubs.forEach((fn) => fn());
}

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** Verpakt een fetcher: offline of bij een fout wordt er gegooid (en onthouden dat verversen mislukte). */
export function strict<T>(name: string, fetcher: () => Promise<T>): () => Promise<T> {
  return async () => {
    if (isOffline()) {
      mark(name, true);
      throw new Error("offline");
    }
    try {
      const data = await fetcher();
      mark(name, false);
      return data;
    } catch (e) {
      mark(name, true);
      throw e;
    }
  };
}

export type SyncStatus = "ok" | "offline" | "error";

function subscribeStatus(fn: () => void) {
  statusSubs.add(fn);
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    statusSubs.delete(fn);
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
}

function statusSnapshot(): SyncStatus {
  if (isOffline()) return "offline";
  return failing.size ? "error" : "ok";
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeStatus, statusSnapshot, () => "ok");
}

// ───────────────────────── Live data ─────────────────────────

type Registered = { fetcher: () => Promise<unknown>; persist: boolean };
const registry = new Map<string, Registered>();

/** Zoals `useCached`, maar wordt ook ververst door `refreshLive()`. */
export function useLive<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts: { persist?: boolean; maxAge?: number } = {},
): T | undefined {
  const data = useCached(key, fetcher, opts);
  const persist = !!opts.persist;
  // Elke render de nieuwste fetcher registreren (goedkoop, geen state).
  useEffect(() => {
    if (!key) return;
    const entry: Registered = { fetcher, persist };
    registry.set(key, entry);
    return () => {
      if (registry.get(key) === entry) registry.delete(key);
    };
  });
  return data;
}

/** Alles wat nu op het scherm staat opnieuw ophalen (fouten laten de vorige data staan). */
export function refreshLive(prefix = "") {
  // Opnieuw beginnen: wat nu weer mislukt, wordt direct opnieuw gemeld.
  if (!prefix && failing.size) {
    failing.clear();
    statusSubs.forEach((fn) => fn());
  }
  for (const [key, { fetcher, persist }] of registry) {
    if (key.startsWith(prefix)) fetchCached(key, fetcher, persist).catch(() => {});
  }
}

/**
 * Ververst bij terugkeer naar de app (na `minAway` ms) en bij weer online komen. Een nieuwe dag
 * regelt Home zelf (nieuwe sleutels met de datum van vandaag).
 */
export function useRefreshOnResume(minAway = 20_000) {
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > minAway) {
        hiddenAt = 0;
        refreshLive();
      }
    };
    const onOnline = () => refreshLive();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [minAway]);
}

// ───────────────────────── Klok ─────────────────────────

/** 0 = nacht, 1 = ochtend, 2 = middag, 3 = avond. */
export type DayPart = 0 | 1 | 2 | 3;
export const GREETINGS = ["Goedenacht", "Goedemorgen", "Goedemiddag", "Goedenavond"] as const;
const BOUNDARIES = [6, 12, 18, 24];

const partOf = (h: number): DayPart => (h < 6 ? 0 : h < 12 ? 1 : h < 18 ? 2 : 3);

function clockSnapshot() {
  const d = new Date();
  return `${toISODate(d)}|${partOf(d.getHours())}`;
}

function msToNextBoundary(now: Date) {
  const next = BOUNDARIES.find((b) => b > now.getHours()) ?? 24;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), next, 0, 1).getTime() - now.getTime();
}

function subscribeClock(fn: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    // Hooguit een uur wachten: timers op de achtergrond lopen op iOS niet betrouwbaar.
    timer = setTimeout(() => {
      fn();
      schedule();
    }, Math.min(msToNextBoundary(new Date()), 3_600_000));
  };
  const wake = () => {
    fn();
    schedule();
  };
  schedule();
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("pageshow", wake);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("focus", wake);
    window.removeEventListener("pageshow", wake);
  };
}

/** Datum van vandaag (YYYY-MM-DD) en het dagdeel; loopt mee over middernacht en bij terugkeer naar de app. */
export function useClock(): { today: string; part: DayPart } {
  const snap = useSyncExternalStore(subscribeClock, clockSnapshot, clockSnapshot);
  const [today, part] = snap.split("|");
  return { today, part: Number(part) as DayPart };
}
