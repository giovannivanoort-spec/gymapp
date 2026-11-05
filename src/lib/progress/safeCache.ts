"use client";

import { getCached, invalidate, useCached } from "@/lib/cache";
import { errorMessage } from "@/lib/supabase";

type Result<T> = { ok: true; data: T } | { ok: false; error: string; data?: T };

/**
 * Zoals useCached, maar een mislukte fetch overschrijft nooit eerder opgehaalde data: bij een fout
 * blijft de vorige stand staan en krijg je `error` en `retry` voor een "Opnieuw proberen"-knop.
 * De fetcher hoort bij een fout te gooien (bijv. `if (error) throw error`).
 */
export function useSafeCached<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts: { persist?: boolean; maxAge?: number } = {},
): { data: T | undefined; error: string | null; retry: () => void } {
  const result = useCached<Result<T>>(
    key,
    async () => {
      try {
        return { ok: true, data: await fetcher() };
      } catch (e) {
        const prev = key ? getCached<Result<T>>(key) : undefined;
        return { ok: false, error: friendlyError(e), data: prev?.data };
      }
    },
    opts,
  );
  return {
    data: result?.data,
    error: result && !result.ok ? result.error : null,
    retry: () => {
      if (key) invalidate(key);
    },
  };
}

function friendlyError(e: unknown): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "Je bent offline. Probeer het opnieuw zodra je verbinding hebt.";
  const msg = errorMessage(e);
  return /fetch|network|failed/i.test(msg) ? "Geen verbinding met de server. Probeer het opnieuw." : msg;
}
