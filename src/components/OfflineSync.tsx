"use client";

import { useEffect, useState } from "react";
import { flushQueue, QUEUE_EVENT, readQueue } from "@/lib/offlineQueue";

/**
 * Registreert de service worker, verstuurt offline ingevulde sets zodra er weer verbinding is,
 * en toont een melding zolang je offline bent of er sets wachten.
 */
export function OfflineSync() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [pending, setPending] = useState(() => (typeof window === "undefined" ? 0 : readQueue().length));

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const update = () => {
      setOnline(navigator.onLine);
      setPending(readQueue().length);
    };
    const goOnline = () => {
      update();
      flushQueue().then(update);
    };
    flushQueue().then(update);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", update);
    window.addEventListener(QUEUE_EVENT, update);
    // Vangnet: af en toe opnieuw proberen (bijv. als "online" al true was maar het netwerk haperde).
    const timer = setInterval(() => readQueue().length && flushQueue().then(update), 20000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", update);
      window.removeEventListener(QUEUE_EVENT, update);
      clearInterval(timer);
    };
  }, []);

  if (online && pending === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <div className="animate-fade-in flex items-center gap-2 rounded-full border border-line bg-surface/95 px-3.5 py-1.5 text-xs shadow-lg backdrop-blur">
        <span className={`h-2 w-2 rounded-full ${online ? "animate-pulse bg-accent" : "bg-warn"}`} />
        {online
          ? `Verbinding terug, ${pending} ${pending === 1 ? "set wordt" : "sets worden"} verstuurd`
          : pending
            ? `Offline · ${pending} ${pending === 1 ? "set wacht" : "sets wachten"} op verbinding`
            : "Offline · je sets worden bewaard en later verstuurd"}
      </div>
    </div>
  );
}
