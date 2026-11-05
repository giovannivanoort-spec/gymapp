"use client";

import { errorMessage, isNetworkError } from "@/lib/supabase";
import { updatedLabel } from "@/lib/dates";
import { ErrorState, useOffline } from "../ui/States";

type Props = {
  /** De fout uit useCachedState / useHistoryState. */
  error: unknown;
  /** Opnieuw proberen (retry uit useCachedState). */
  onRetry?: () => void;
  /** Bezig met opnieuw ophalen (refreshing uit useCachedState). */
  retrying?: boolean;
  /** Korte titel, standaard "Laden mislukt". */
  title?: string;
  /** Compacte variant (één regel) voor als er al (oudere) data op het scherm staat. */
  compact?: boolean;
  /** Compacte variant: wanneer de getoonde data is opgehaald (updatedAt uit useCachedState). */
  updatedAt?: number | null;
  className?: string;
};

/**
 * Foutmelding voor data die niet geladen kon worden, met een "Opnieuw"-knop. Gebruik de
 * volledige variant in plaats van een skeleton als er nog niets is, en de compacte variant
 * boven verouderde data (zie ook DataStatus, die de juiste variant kiest).
 */
export function LoadError({ error, onRetry, retrying = false, title, compact = false, updatedAt, className = "" }: Props) {
  // Live: valt de verbinding weg terwijl de fout in beeld staat, dan rendert dit opnieuw en past de
  // melding zich aan (isNetworkError en errorMessage kijken zelf ook naar navigator.onLine).
  const liveOffline = useOffline();
  const offline = liveOffline || isNetworkError(error);
  const message = errorMessage(error);
  const heading = title ?? (offline ? "Geen verbinding" : "Laden mislukt");

  if (compact) {
    const when = updatedLabel(updatedAt);
    const text = offline
      ? when
        ? `Offline, ${when}.`
        : "Offline, je ziet de laatst geladen gegevens."
      : when
        ? `Verversen mislukt, ${when}.`
        : `${heading}. Je ziet de laatst geladen gegevens.`;
    return (
      <div
        role="status"
        className={`animate-fade-in flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs ${className}`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${offline ? "bg-warn" : "bg-danger"}`} aria-hidden />
        <span className="min-w-0 flex-1 text-muted">{text}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            aria-label={retrying ? "Bezig met opnieuw laden" : "Opnieuw laden"}
            className="-my-1 shrink-0 rounded-lg px-2 py-1.5 font-semibold text-accent transition-opacity active:opacity-70 disabled:opacity-50"
          >
            {retrying ? "Bezig…" : "Opnieuw"}
          </button>
        )}
      </div>
    );
  }

  // Volledige variant: dezelfde foutweergave als overal in de app (ui/States).
  return (
    <ErrorState
      title={heading}
      message={message}
      offline={offline}
      onRetry={onRetry}
      retrying={retrying}
      className={className}
    />
  );
}
