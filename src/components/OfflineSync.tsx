"use client";

import { useCallback, useEffect, useState } from "react";
import { useUserId } from "@/components/AuthProvider";
import {
  clearFailed,
  flushQueue,
  getLastFlush,
  hasPendingWork,
  isOwnOp,
  QUEUE_EVENT,
  QUEUE_FULL_EVENT,
  readFailed,
  readQueue,
  retryFailed,
  SYNCED_EVENT,
  type SyncedDetail,
} from "@/lib/offlineQueue";
import { registerServiceWorker } from "@/lib/platform/serviceWorker";
import { toast } from "@/components/ui/Toast";

/** Hoe lang de melding "opslag vol" blijft staan. */
const FULL_MS = 8000;

/**
 * Registreert de service worker, verstuurt offline ingevulde sets zodra er weer verbinding is,
 * en toont een melding zolang je offline bent, er sets wachten of er iets mislukt is.
 */
export function OfflineSync() {
  const uid = useUserId();
  // Alleen eigen bewerkingen tellen: die van een ander account op dit toestel worden hier niet verstuurd.
  const ownPending = useCallback(() => readQueue().filter((op) => isOwnOp(op, uid)).length, [uid]);
  const ownFailed = useCallback(() => readFailed().filter((f) => isOwnOp(f.op, uid)).length, [uid]);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [pending, setPending] = useState(() => (typeof window === "undefined" ? 0 : ownPending()));
  const [failed, setFailed] = useState(() => (typeof window === "undefined" ? 0 : ownFailed()));
  // Browseropslag vol: een offline set kon niet worden bewaard (tijdstip, 0 = niet).
  const [fullAt, setFullAt] = useState(0);
  // Laatste poging liep vast (slechte wifi, captive portal, verlopen sessie).
  const [stalled, setStalled] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // Alleen "verbinding terug" zeggen als de verbinding echt weg is geweest.
  const [sawOffline, setSawOffline] = useState(() => (typeof navigator === "undefined" ? false : !navigator.onLine));
  if (sawOffline && online && pending === 0 && failed === 0) setSawOffline(false);

  const update = useCallback(() => {
    setOnline(navigator.onLine);
    setPending(ownPending());
    setFailed(ownFailed());
  }, [ownPending, ownFailed]);

  const flush = useCallback(
    () =>
      flushQueue().then(() => {
        setStalled(getLastFlush().stalled);
        update();
      }),
    [update],
  );

  useEffect(() => {
    // Eén adres voor de hele app (SW_URL); doet niets in ontwikkeling of zonder ondersteuning.
    void registerServiceWorker();

    const goOnline = () => {
      update();
      flush();
    };
    const goOffline = () => {
      setSawOffline(true);
      update();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && hasPendingWork()) flush();
    };
    let fullTimer: ReturnType<typeof setTimeout> | undefined;
    const onFull = () => {
      setFullAt(Date.now());
      clearTimeout(fullTimer);
      fullTimer = setTimeout(() => setFullAt(0), FULL_MS);
    };
    // Sets van een oefening die de trainer intussen uit het plan haalde (of een training die weg
    // is), kunnen nergens meer heen en zijn weggehaald: dat één keer rustig melden, waar je ook bent.
    const onSynced = (e: Event) => {
      const dropped = (e as CustomEvent<SyncedDetail | undefined>).detail?.dropped ?? 0;
      if (dropped > 0) toast.warn(`${setsLabel(dropped)} niet bewaard: de oefening of training bestaat niet meer`, { duration: 6000 });
    };
    flush();

    window.addEventListener("online", goOnline);
    window.addEventListener(SYNCED_EVENT, onSynced);
    window.addEventListener("offline", goOffline);
    window.addEventListener(QUEUE_EVENT, update);
    window.addEventListener(QUEUE_FULL_EVENT, onFull);
    document.addEventListener("visibilitychange", onVisible);
    // Vangnet: af en toe opnieuw proberen (bijv. als "online" al true was maar het netwerk haperde).
    const timer = setInterval(() => {
      if (hasPendingWork()) flush();
    }, 20000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener(SYNCED_EVENT, onSynced);
      window.removeEventListener(QUEUE_EVENT, update);
      window.removeEventListener(QUEUE_FULL_EVENT, onFull);
      clearTimeout(fullTimer);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [flush, update]);

  async function retry() {
    setRetrying(true);
    setStalled(false);
    await (failed ? retryFailed() : flushQueue());
    setStalled(getLastFlush().stalled);
    setRetrying(false);
    update();
  }

  function dismissFailed() {
    clearFailed();
    update();
  }

  if (online && pending === 0 && failed === 0 && !fullAt) return null;

  const sets = setsLabel;
  let tone: "warn" | "busy" | "danger" = "busy";
  let text: string;
  let actions: React.ReactNode = null;

  if (fullAt) {
    tone = "danger";
    text = "Opslag vol, set niet bewaard";
  } else if (failed > 0 && (online || pending === 0)) {
    tone = "danger";
    text = `${sets(failed)} ${failed === 1 ? "kon" : "konden"} niet worden opgeslagen`;
    actions = (
      <>
        <BannerButton onClick={retry} disabled={retrying || !online}>
          Opnieuw
        </BannerButton>
        <BannerButton onClick={dismissFailed} muted>
          Negeren
        </BannerButton>
      </>
    );
  } else if (!online) {
    tone = "warn";
    text = pending
      ? `Offline · ${sets(pending)} ${pending === 1 ? "wacht" : "wachten"} op verbinding`
      : "Offline · je sets worden bewaard en later verstuurd";
  } else if (stalled && !retrying) {
    tone = "warn";
    text = `${sets(pending)} ${pending === 1 ? "wacht" : "wachten"}, verbinding hapert`;
    actions = <BannerButton onClick={retry}>Opnieuw proberen</BannerButton>;
  } else {
    text = `${sawOffline ? "Verbinding terug, " : ""}${sets(pending)} ${pending === 1 ? "wordt" : "worden"} verstuurd`;
  }

  const dot = tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : "animate-pulse bg-accent";

  return (
    <div data-offline-banner className="pointer-events-none fixed inset-x-0 top-0 z-(--z-banner) flex justify-center px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <div
        role={tone === "danger" ? "alert" : "status"}
        aria-live="polite"
        className={`animate-fade-in flex max-w-full items-center gap-2 rounded-full border bg-surface/95 py-1 pl-3.5 text-xs shadow-lg backdrop-blur ${
          actions ? "pr-1" : "pr-3.5 py-1.5"
        } ${tone === "danger" ? "border-danger/50" : "border-line"}`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
        <span className="min-w-0 truncate">{text}</span>
        {actions && <span className="pointer-events-auto flex shrink-0 items-center gap-1">{actions}</span>}
      </div>
    </div>
  );
}

function setsLabel(n: number): string {
  return `${n} ${n === 1 ? "set" : "sets"}`;
}

function BannerButton({
  children,
  onClick,
  disabled,
  muted,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  muted?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`min-h-8 rounded-full px-3 font-semibold transition active:scale-95 disabled:opacity-50 ${
        muted ? "text-muted hover:text-ink" : "bg-surface-2 text-accent hover:brightness-110"
      }`}
    >
      {children}
    </button>
  );
}
