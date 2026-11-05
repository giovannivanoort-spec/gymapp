"use client";

import { useState } from "react";
import { RefreshIcon, WifiOffIcon } from "@/components/Icons";
import { toISODate } from "@/lib/dates";

export type HomeSyncStatus = "ok" | "offline" | "error";

/** Tijdstip als tekst: "om 14:05", of "op 3 nov. om 14:05" als het niet van vandaag is. */
function syncedLabel(at: number, today: string): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  return toISODate(d) === today ? `om ${time}` : `op ${d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })} om ${time}`;
}

/**
 * Kleine melding als we (deels) oude gegevens tonen, met hoe oud die zijn. Ook bij "lie-fi" (wel
 * wifi, geen internet): dan kwam er een offline kopie van de service worker terug en zeggen we
 * eerlijk dat het offline is, met een knop om het opnieuw te proberen.
 */
export function SyncNote({
  status,
  syncedAt,
  today,
  canRetry,
  onRetry,
}: {
  status: Exclude<HomeSyncStatus, "ok">;
  syncedAt: number | null;
  today: string;
  /** false als het apparaat zelf zegt dat er geen verbinding is (opnieuw proberen heeft dan geen zin). */
  canRetry: boolean;
  onRetry: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      role="status"
      className="animate-fade-in -mt-2 flex items-center gap-2 rounded-xl border border-warn/30 bg-warn/10 px-3 py-1 text-xs text-warn"
    >
      {status === "offline" ? (
        <WifiOffIcon size={14} className="shrink-0" />
      ) : (
        <span className="mx-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
      )}
      <p className="min-w-0 flex-1 py-2">
        {status === "offline" ? "Offline." : "Verversen lukt niet."}{" "}
        {syncedAt ? <>Bijgewerkt {syncedLabel(syncedAt, today)}.</> : "Je ziet de laatst bekende gegevens."}
      </p>
      {canRetry && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onRetry().finally(() => setBusy(false));
          }}
          className="-mr-1 flex min-h-11 shrink-0 items-center gap-1.5 px-1 font-semibold underline underline-offset-2 disabled:no-underline disabled:opacity-70"
        >
          {busy ? <span className="spinner text-[12px]" aria-hidden /> : <RefreshIcon size={12} />}
          {busy ? "Bezig" : "Opnieuw"}
        </button>
      )}
    </div>
  );
}
