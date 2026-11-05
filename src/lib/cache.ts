"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Kleine cache voor opgehaalde data ("stale-while-revalidate"): een pagina toont direct wat er
 * al bekend is en ververst op de achtergrond. Data blijft bewaard tussen pagina's en (optioneel)
 * in localStorage, zodat de app bij opnieuw openen meteen iets laat zien.
 */

type Entry = { data: unknown; at: number };

const mem = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const LS_PREFIX = "gymapp-cache:v1:";
/** Grotere data niet in localStorage (die heeft ~5 MB voor de hele app). */
const MAX_PERSIST_CHARS = 1_500_000;

function load(key: string): Entry | undefined {
  const hit = mem.get(key);
  if (hit) return hit;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw) {
      const entry = JSON.parse(raw) as Entry;
      mem.set(key, entry);
      return entry;
    }
  } catch {
    // geen opslag beschikbaar
  }
  return undefined;
}

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

export function getCached<T>(key: string): T | undefined {
  return load(key)?.data as T | undefined;
}

export function setCached<T>(key: string, data: T, persist = false) {
  const entry = { data, at: Date.now() };
  mem.set(key, entry);
  if (persist) {
    try {
      const raw = JSON.stringify(entry);
      if (raw.length <= MAX_PERSIST_CHARS) localStorage.setItem(LS_PREFIX + key, raw);
      else localStorage.removeItem(LS_PREFIX + key);
    } catch {
      // opslag vol of niet beschikbaar: alleen in het geheugen
    }
  }
  notify(key);
}

/** Haalt data op (één verzoek tegelijk per sleutel) en bewaart het resultaat. */
export function fetchCached<T>(key: string, fetcher: () => Promise<T>, persist = false): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fetcher()
    .then((data) => {
      setCached(key, data, persist);
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Markeert alles dat met `prefix` begint als verouderd; actieve pagina's halen het opnieuw op. */
export function invalidate(prefix: string) {
  for (const key of [...mem.keys()]) {
    if (key.startsWith(prefix)) {
      mem.set(key, { ...mem.get(key)!, at: 0 });
      notify(key);
    }
  }
}

/** Alles wissen (bij uitloggen of wisselen van account). */
export function clearCache() {
  mem.clear();
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    // niets te wissen
  }
}

function subscribe(key: string, fn: () => void) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(fn);
  return () => {
    listeners.get(key)?.delete(fn);
  };
}

/**
 * Geeft de bekende data direct terug (of undefined) en ververst op de achtergrond als de data
 * ouder is dan `maxAge` ms. `key = null` slaat ophalen over.
 */
export function useCached<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  { persist = false, maxAge = 10_000 }: { persist?: boolean; maxAge?: number } = {},
): T | undefined {
  const data = useSyncExternalStore(
    (fn) => (key ? subscribe(key, fn) : () => {}),
    () => (key ? (load(key)?.data as T | undefined) : undefined),
    () => undefined,
  );
  const at = useSyncExternalStore(
    (fn) => (key ? subscribe(key, fn) : () => {}),
    () => (key ? (load(key)?.at ?? -1) : -1),
    () => -1,
  );

  useEffect(() => {
    if (!key) return;
    if (at >= 0 && Date.now() - at < maxAge) return;
    fetchCached(key, fetcher, persist).catch(() => {});
    // fetcher hoort bij de sleutel; een nieuwe functie-instantie per render mag geen nieuwe fetch geven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, at, maxAge, persist]);

  return data;
}
