"use client";

import { useSyncExternalStore } from "react";

/**
 * Gedeelde klok die elke minuut tikt, zodat "3 min geleden" vanzelf bijwerkt zolang de pagina
 * open staat. Eén interval voor alle onderdelen, en alleen zolang er iemand luistert.
 */
const listeners = new Set<() => void>();
let minute = Math.floor(Date.now() / 60_000);
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  const now = Math.floor(Date.now() / 60_000);
  if (now === minute) return;
  minute = now;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!timer) {
    timer = setInterval(tick, 15_000);
    // Na een tijd zonder luisteraars kan de minuut verouderd zijn.
    queueMicrotask(tick);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Huidige minuut (epoch-minuten); verandert eens per minuut en laat het onderdeel opnieuw renderen. */
export function useMinuteTick(): number {
  return useSyncExternalStore(
    subscribe,
    () => minute,
    () => minute,
  );
}
