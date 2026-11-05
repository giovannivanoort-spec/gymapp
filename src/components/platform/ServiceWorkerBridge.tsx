"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { prepareOffline } from "@/lib/platform/offlinePrefetch";
import { supabase } from "@/lib/supabase";

/** Hoe vaak (ms) we bij terugkeren naar de app maximaal op een nieuwe service worker controleren. */
const UPDATE_CHECK_MS = 30 * 60 * 1000;
/** Na het openen even wachten met klaarzetten voor offline, zodat het eerste scherm voorgaat. */
const PREFETCH_DELAY_MS = 6_000;

/**
 * Verbindt de app met de service worker:
 * - Tik op een pushmelding terwijl de app al open is: de worker vraagt de app om via de router
 *   naar de juiste pagina te gaan (zonder herladen, je blijft ingelogd en de cache blijft warm).
 * - Staat er een nieuwe versie van de worker klaar, dan verschijnt een blijvende melding (toast)
 *   met "Herladen". Pas na die tik neemt de nieuwe versie het over (niet midden in een training).
 * - "Offline klaar": bij een goede verbinding worden de trainingen van vandaag en morgen alvast
 *   opgehaald (zie lib/platform/offlinePrefetch), zodat loggen ook zonder bereik werkt.
 *
 * Eén keer renderen, bijvoorbeeld naast <OfflineSync /> in de AuthProvider.
 */
export function ServiceWorkerBridge() {
  const router = useRouter();
  const routerRef = useRef(router);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  /** Worker waarvoor de updatemelding al getoond is (niet dubbel tonen). */
  const shownFor = useRef<ServiceWorker | null>(null);
  const toastId = useRef<number | null>(null);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    let cancelled = false;
    let lastCheck = Date.now();
    let reg: ServiceWorkerRegistration | undefined;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type !== "navigate" || typeof data.url !== "string" || !data.url.startsWith("/")) return;
      routerRef.current.push(data.url);
      event.ports?.[0]?.postMessage({ ok: true });
    };
    sw.addEventListener("message", onMessage);

    /** Een worker die klaarstaat terwijl er al een actieve is, is een update. */
    const track = (r: ServiceWorkerRegistration) => {
      if (r.waiting && sw.controller && !cancelled) setWaiting(r.waiting);
    };
    const onUpdateFound = () => {
      const installing = reg?.installing;
      installing?.addEventListener("statechange", () => {
        if (installing.state === "installed" && reg) track(reg);
      });
    };

    // Registreren gebeurt in OfflineSync (één adres, zie lib/platform/serviceWorker); hier alleen volgen.
    sw.getRegistration()
      .then((r) => {
        if (!r || cancelled) return;
        reg = r;
        track(r);
        r.addEventListener("updatefound", onUpdateFound);
      })
      .catch(() => {});

    // Bij terugkeren naar de app af en toe kijken of er een nieuwe worker is.
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !reg || Date.now() - lastCheck < UPDATE_CHECK_MS) return;
      lastCheck = Date.now();
      reg.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      sw.removeEventListener("message", onMessage);
      reg?.removeEventListener("updatefound", onUpdateFound);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Offline klaarzetten: kort na het openen, bij terugkeren naar de app en als de verbinding terugkomt.
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      supabase.auth
        .getSession()
        .then(({ data }) => {
          const uid = data.session?.user.id;
          if (uid && !cancelled) return prepareOffline(uid);
        })
        .catch(() => {});
    };
    const timer = setTimeout(run, PREFETCH_DELAY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", run);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", run);
    };
  }, []);

  // Nieuwe versie klaar: één blijvende melding per wachtende worker, via het gedeelde meldingensysteem.
  useEffect(() => {
    if (!waiting || shownFor.current === waiting) return;
    shownFor.current = waiting;
    const worker = waiting;
    toastId.current = toast("Nieuwe versie beschikbaar", {
      duration: 0,
      action: { label: "Herladen", run: () => applyUpdate(worker) },
    });
  }, [waiting]);

  // Uitgelogd (component verdwijnt): de updatemelding niet laten staan.
  useEffect(
    () => () => {
      if (toastId.current !== null) toast.dismiss(toastId.current);
    },
    [],
  );

  return null;
}

/** Laat de wachtende worker het overnemen en herlaadt de pagina daarna. */
function applyUpdate(worker: ServiceWorker) {
  let done = false;
  const reload = () => {
    if (done) return;
    done = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
  worker.postMessage({ type: "skip-waiting" });
  // Vangnet als controllerchange uitblijft.
  setTimeout(reload, 3000);
}
