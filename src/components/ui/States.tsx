"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { AlertIcon, RefreshIcon, WifiOffIcon } from "../Icons";

/*
 * Vaste vormen voor lege, ladende en mislukte schermen, zodat elke pagina ze hetzelfde toont:
 *
 *   <EmptyState icon={<DumbbellIcon size={22} />} title="Nog geen trainingen" text="..." action={{ label: "Plannen", href: "/new" }} />
 *   <ErrorState message="Je trainingen konden niet geladen worden." onRetry={retry} />
 *   <ListSkeleton rows={3} />
 */

type Action = { label: string; href?: string; onClick?: () => void; icon?: React.ReactNode };

function ActionButton({ action, primary }: { action: Action; primary: boolean }) {
  const cls = `${primary ? "btn-primary" : "btn-ghost"} w-full sm:w-auto`;
  if (action.href) {
    return (
      <Link href={action.href} className={cls} onClick={action.onClick}>
        {action.icon}
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={action.onClick}>
      {action.icon}
      {action.label}
    </button>
  );
}

/** Lege staat: rustig icoon, korte titel, één zin uitleg en (optioneel) wat je nu kunt doen. */
export function EmptyState({
  icon,
  title,
  text,
  action,
  secondary,
  compact = false,
  className = "",
}: {
  icon?: React.ReactNode;
  title: string;
  text?: React.ReactNode;
  action?: Action;
  secondary?: Action;
  /** Kleinere variant voor binnen een kaart of paneel. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={`animate-fade-in flex flex-col items-center text-center ${compact ? "py-5" : "py-10"} ${className}`}>
      {icon && (
        <span
          className={`mb-3 flex items-center justify-center rounded-2xl border border-line bg-surface-2 text-accent ${
            compact ? "h-11 w-11" : "h-14 w-14"
          }`}
          aria-hidden
        >
          {icon}
        </span>
      )}
      <p className={`font-semibold ${compact ? "text-sm" : "text-base"}`}>{title}</p>
      {text && <p className="mt-1 max-w-xs text-sm text-muted">{text}</p>}
      {(action || secondary) && (
        <div className={`flex w-full flex-col items-center gap-2 sm:flex-row sm:justify-center ${compact ? "mt-4" : "mt-5"}`}>
          {action && <ActionButton action={action} primary />}
          {secondary && <ActionButton action={secondary} primary={false} />}
        </div>
      )}
    </div>
  );
}

const subscribeOnline = (fn: () => void) => {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
};

/** true zolang het apparaat geen verbinding heeft (live bijgewerkt). */
export function useOffline() {
  return useSyncExternalStore(
    subscribeOnline,
    () => !navigator.onLine,
    () => false,
  );
}

/**
 * Laden mislukt: wat er misging en een "Opnieuw proberen"-knop. Zonder verbinding past de tekst
 * zich vanzelf aan, en zodra je weer online bent kun je direct opnieuw proberen.
 */
export function ErrorState({
  title = "Dat lukte niet",
  message = "Er ging iets mis bij het laden.",
  onRetry,
  retrying = false,
  compact = false,
  offline: offlineProp,
  className = "",
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  /** Toon een spinner in de knop terwijl het opnieuw geprobeerd wordt. */
  retrying?: boolean;
  compact?: boolean;
  /**
   * Zelf bepalen of dit een verbindingsfout is (bijv. via isNetworkError). Dan worden title en
   * message altijd getoond, alleen icoon en kleur volgen deze waarde. Zonder: live de verbinding
   * van het apparaat, met een vaste offline-tekst.
   */
  offline?: boolean;
  className?: string;
}) {
  const liveOffline = useOffline();
  const offline = offlineProp ?? liveOffline;
  // Alleen de vaste offline-tekst als de aanroeper zelf niets over de soort fout zegt.
  const offlineText = offlineProp === undefined && liveOffline;
  return (
    <div role="alert" className={`animate-fade-in flex flex-col items-center text-center ${compact ? "py-5" : "py-10"} ${className}`}>
      <span
        className={`mb-3 flex items-center justify-center rounded-2xl ${offline ? "bg-warn/10 text-warn" : "bg-danger/10 text-danger"} ${
          compact ? "h-11 w-11" : "h-14 w-14"
        }`}
        aria-hidden
      >
        {offline ? <WifiOffIcon size={22} /> : <AlertIcon size={22} />}
      </span>
      <p className={`font-semibold ${compact ? "text-sm" : "text-base"}`}>{offlineText ? "Je bent offline" : title}</p>
      <p className="mt-1 max-w-xs text-sm text-muted">
        {offlineText ? "Maak verbinding met internet en probeer het opnieuw." : message}
      </p>
      {onRetry && (
        <button
          type="button"
          className={`btn-ghost w-full sm:w-auto ${compact ? "mt-4" : "mt-5"}`}
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying ? <span className="spinner" aria-hidden /> : <RefreshIcon size={16} />}
          Opnieuw proberen
        </button>
      )}
    </div>
  );
}

/** Skeleton voor een lijst kaarten, in dezelfde maat als `card` met een titel en een regel tekst. */
export function ListSkeleton({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-busy="true" aria-label="Laden">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4" style={{ opacity: 1 - i * 0.18 }}>
          <span className="skeleton h-11 w-11 shrink-0 rounded-xl" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="skeleton block h-4 w-2/5" />
            <span className="skeleton block h-3 w-3/5" />
          </span>
        </div>
      ))}
    </div>
  );
}
