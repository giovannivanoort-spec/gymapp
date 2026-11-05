"use client";

import { useEffect, useState } from "react";
import type { CachedState } from "@/lib/cache";
import { updatedLabel } from "@/lib/dates";
import { LoadError } from "./LoadError";

/** Na zoveel minuten zonder verse data tonen we wanneer het laatst is bijgewerkt (ook online). */
const OLD_AFTER_MS = 10 * 60 * 1000;

/** Huidige tijd, elke minuut opnieuw (voor labels die met de tijd veranderen). */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

type Props = {
  /** Resultaat van useCachedState / useHistoryState. */
  state: Pick<CachedState<unknown>, "data" | "error" | "refreshing" | "updatedAt" | "stale" | "offline" | "retry">;
  /** Titel van de foutkaart als er nog niets te tonen is, standaard "Laden mislukt" / "Geen verbinding". */
  title?: string;
  /** Ook "bijgewerkt om" tonen als alles goed gaat maar de data al wat ouder is. */
  showAge?: boolean;
  className?: string;
};

/**
 * Eerlijke status van data op een scherm, in één regel:
 * - nog niets geladen en het lukt niet: een foutkaart met "Opnieuw proberen" (in plaats van een
 *   eindeloze skeleton);
 * - wel data maar de laatste poging mislukte of het is een offline kopie: een compacte regel als
 *   "Offline, bijgewerkt om 18:42" met "Opnieuw";
 * - anders niets (of met `showAge` een stille "bijgewerkt om" als de data ouder is dan 10 minuten).
 *
 * Gebruik: `const st = useHistoryState(uid)`, dan `<DataStatus state={st} />` boven de inhoud en
 * de skeleton alleen zolang `st.data === undefined && !st.error`.
 */
export function DataStatus({ state, title, showAge = false, className = "" }: Props) {
  const now = useMinuteClock();
  const { data, error, refreshing, updatedAt, stale, retry } = state;

  if (data === undefined) {
    if (!error) return null;
    return <LoadError error={error} onRetry={retry} retrying={refreshing} title={title} className={className} />;
  }

  if (stale && error) {
    return (
      <LoadError
        error={error}
        onRetry={retry}
        retrying={refreshing}
        compact
        updatedAt={updatedAt}
        className={className}
      />
    );
  }

  if (showAge && updatedAt && now - updatedAt > OLD_AFTER_MS) {
    const label = updatedLabel(updatedAt, now);
    if (!label) return null;
    return (
      <p className={`animate-fade-in text-xs text-muted ${className}`} aria-live="polite">
        {refreshing ? "Bijwerken…" : label.charAt(0).toUpperCase() + label.slice(1)}
      </p>
    );
  }
  return null;
}
