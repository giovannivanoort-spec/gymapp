"use client";

import { useEffect, useId, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { cacheStats, resetCache, useCachedState, type CacheStats } from "@/lib/cache";
import { formatDate, relativeDay } from "@/lib/dates";
import { useFailed, useQueue } from "@/lib/offlineQueue";
import { offlineReadyKey, prepareOffline, type OfflineReady } from "@/lib/platform/offlinePrefetch";
import { BUILD_ID, serviceWorkerVersion } from "@/lib/platform/serviceWorker";
import { errorMessage } from "@/lib/supabase";

function formatSize(chars: number): string {
  // localStorage en de cache tellen in tekens (UTF-16): ongeveer 2 bytes per teken.
  const bytes = chars * 2;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / 1024 / 1024).toLocaleString("nl-NL", { maximumFractionDigits: 1 })} MB`;
}

function formatTime(ms: number): string {
  if (!ms) return "nog niet";
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `vandaag om ${time}` : `${d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })} om ${time}`;
}

const sets = (n: number) => `${n} ${n === 1 ? "set" : "sets"}`;

/**
 * "Opslag en synchronisatie" voor in Profiel: welke trainingen offline klaarstaan (met een knop
 * om dat nu te doen), wat er nog in de wachtrij staat, hoeveel er op dit toestel bewaard is,
 * wanneer er voor het laatst gesynchroniseerd is, de app-versie en een knop om de cache te wissen.
 */
export function StorageSettings({ className = "" }: { className?: string }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const headingId = useId();
  const ready = useCachedState<OfflineReady | null>(userId ? offlineReadyKey(userId) : null, () => prepareOffline(userId!), {
    persist: true,
    maxAge: 30 * 60 * 1000,
  });
  const queue = useQueue();
  const failed = useFailed();
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [statsTick, setStatsTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    cacheStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [statsTick, ready.data]);

  useEffect(() => {
    let cancelled = false;
    serviceWorkerVersion().then((v) => {
      if (!cancelled) setVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Bevestiging voor wissen vervalt vanzelf.
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 4_000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  if (!userId) return null;

  async function prepareNow() {
    if (!userId || preparing) return;
    setPreparing(true);
    setMessage(null);
    try {
      const r = await prepareOffline(userId, { force: true });
      const n = r?.workouts.length ?? 0;
      setMessage(
        !r?.complete
          ? { tone: "error", text: "Niet alles kon worden klaargezet. Probeer het opnieuw met een betere verbinding." }
          : { tone: "ok", text: n ? `${n} ${n === 1 ? "training staat" : "trainingen staan"} klaar voor offline gebruik.` : "Geen trainingen gepland voor vandaag of morgen." },
      );
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err) });
    } finally {
      setPreparing(false);
      setStatsTick((t) => t + 1);
    }
  }

  function clearNow() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    resetCache();
    setMessage({ tone: "ok", text: "Cache gewist. Wat op je scherm staat, wordt opnieuw geladen. Sets in de wachtrij blijven bewaard." });
    setStatsTick((t) => t + 1);
  }

  const r = ready.data;
  const workouts = r?.workouts ?? [];
  const pending = queue.length;
  const failedCount = failed.length;
  const used = stats ? stats.localChars + (stats.deviceChars ?? 0) : null;
  const appVersion = version ? `${BUILD_ID === "dev" ? "dev" : BUILD_ID.slice(0, 7)} · ${version}` : BUILD_ID === "dev" ? "dev" : BUILD_ID.slice(0, 7);

  return (
    <section className={`card space-y-4 ${className}`} aria-labelledby={headingId}>
      <div>
        <h2 id={headingId} className="font-semibold">
          Opslag en synchronisatie
        </h2>
        <p className="text-xs text-muted">Zo werkt de app ook in een sportschool zonder bereik.</p>
      </div>

      {/* Offline klaar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Offline klaar</p>
            <p className="text-xs text-muted">
              {r === undefined
                ? "Bezig met controleren…"
                : r
                  ? `Trainingen van vandaag en morgen, bijgewerkt ${formatTime(r.at)}.`
                  : "Nog niet klaargezet. Gebeurt vanzelf bij een goede verbinding."}
            </p>
          </div>
          <button
            type="button"
            onClick={prepareNow}
            disabled={preparing}
            aria-busy={preparing}
            className="btn btn-ghost min-h-10 shrink-0 px-3 text-xs transition active:scale-95 disabled:opacity-60 motion-reduce:transform-none"
          >
            {preparing ? "Bezig…" : "Nu klaarzetten"}
          </button>
        </div>
        {r === undefined ? (
          <div className="space-y-1.5" aria-hidden>
            <span className="skeleton block h-9 w-full rounded-xl" />
          </div>
        ) : workouts.length ? (
          <ul className="space-y-1.5">
            {workouts.map((w, i) => (
              <li
                key={w.id}
                className="animate-fade-up flex items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2 text-sm"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{w.title}</span>
                <span className="shrink-0 text-xs text-muted" title={formatDate(w.date)}>
                  {relativeDay(w.date)}
                  {w.group ? ` · ${w.group}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : r ? (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">Geen trainingen gepland voor vandaag of morgen.</p>
        ) : null}
      </div>

      {/* Overzicht */}
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface-2 px-3 py-2">
          <dt className="text-xs text-muted">Wachtrij</dt>
          <dd className={`font-semibold tabular-nums ${failedCount ? "text-danger" : pending ? "text-warn" : ""}`}>
            {failedCount ? `${sets(failedCount)} mislukt` : pending ? `${sets(pending)} wachten` : "Alles verstuurd"}
          </dd>
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2">
          <dt className="text-xs text-muted">Laatste sync</dt>
          <dd className="font-semibold">{stats ? formatTime(stats.lastSyncAt) : <span className="skeleton inline-block h-4 w-20 align-middle" aria-label="Laden" />}</dd>
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2">
          <dt className="text-xs text-muted">Op dit toestel</dt>
          <dd className="font-semibold tabular-nums">{used == null ? <span className="skeleton inline-block h-4 w-14 align-middle" aria-label="Laden" /> : formatSize(used)}</dd>
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2">
          <dt className="text-xs text-muted">Versie</dt>
          <dd className="truncate font-semibold tabular-nums" title={appVersion}>
            {appVersion}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <p className="min-w-0 flex-1 text-xs text-muted">
          {confirmClear ? "Nog een keer tikken om te wissen." : "Iets lijkt niet te kloppen? Wis de bewaarde kopieën en laad alles opnieuw."}
        </p>
        <button
          type="button"
          onClick={clearNow}
          className={`btn min-h-10 shrink-0 px-3 text-xs transition active:scale-95 motion-reduce:transform-none ${confirmClear ? "btn-danger" : "btn-ghost"}`}
        >
          {confirmClear ? "Ja, wissen" : "Cache wissen"}
        </button>
      </div>

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`animate-fade-in text-xs ${message.tone === "error" ? "text-danger" : "text-muted"}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
