"use client";

import { useEffect, useId, useRef, useState } from "react";
import { registerServiceWorker } from "@/lib/platform/serviceWorker";
import { errorMessage, supabase } from "@/lib/supabase";

type State = "loading" | "unsupported" | "ios-install" | "ios-update" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** iPhone, iPod of iPad (iPadOS doet zich voor als Mac, maar heeft een touchscreen). */
function isIOSDevice() {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);
}

/**
 * De actieve service worker, of undefined als er (nog) geen is. `serviceWorker.ready` wacht anders
 * eeuwig als er nooit een geregistreerd wordt (bijv. in ontwikkeling, privémodus of geblokkeerde opslag).
 */
async function activeRegistration(ms = 3000): Promise<ServiceWorkerRegistration | undefined> {
  const ready = await withTimeout(navigator.serviceWorker.ready, ms);
  return ready ?? (await navigator.serviceWorker.getRegistration());
}

/** Zoekt uit of meldingen op dit apparaat (voor deze gebruiker) aan staan. */
async function detectState(): Promise<State> {
  const ios = isIOSDevice();
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    // Op iPhone/iPad werken meldingen alleen als de app op het beginscherm staat (iOS 16.4+).
    return ios ? (standalone ? "ios-update" : "ios-install") : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await activeRegistration();
    // Geen service worker: "uit", dan registreert aanzetten hem zelf.
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub || Notification.permission !== "granted") return "off";
    // Het abonnement van de browser kan nog van een vorige gebruiker zijn: alleen "aan" als het
    // bij deze gebruiker hoort.
    const { data, error } = await supabase.from("push_subscriptions").select("endpoint").eq("endpoint", sub.endpoint).maybeSingle();
    return error ? "on" : data ? "on" : "off";
  } catch {
    return "off";
  }
}

/**
 * Meldingen op dit apparaat uitzetten en de koppeling uit de database halen. Aanroepen vóór het
 * uitloggen, zodat iemand anders op dit toestel niet de meldingen van de vorige gebruiker krijgt.
 * Gooit nooit een fout en wacht maximaal een paar seconden.
 */
export async function removePushSubscription(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    await withTimeout(
      (async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager?.getSubscription();
        if (!sub) return;
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      })(),
      4000,
    );
  } catch {
    // Uitloggen moet altijd doorgaan.
  }
}

/** Browserfouten bij pushmeldingen in gewone taal. */
function pushErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") return "Je browser staat meldingen niet toe voor deze site.";
  if (name === "AbortError" || name === "InvalidStateError") return "Je browser kon zich niet aanmelden voor meldingen. Probeer het zo opnieuw.";
  if (name === "NotSupportedError") return "Deze browser ondersteunt geen pushmeldingen.";
  return errorMessage(err);
}

/** Meldingen aan/uit voor dit apparaat (welke soorten: zie platform/NotificationSettings). */
export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();
  const descId = useId();

  // Na enable/disable niet laten overschrijven door een controle die nog liep.
  const actionGen = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      const gen = actionGen.current;
      detectState().then((s) => {
        if (!cancelled && gen === actionGen.current) setState(s);
      });
    };
    check();
    // Terug uit de systeeminstellingen (meldingen toegestaan of geblokkeerd): opnieuw kijken.
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  async function enable() {
    actionGen.current++;
    setBusy(true);
    setError(null);
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key) {
      setError("Aanzetten lukte niet. Meldingen zijn nog niet ingesteld op de server.");
      setBusy(false);
      return;
    }
    // Toestemming meteen vragen, nog binnen de tik: Safari op iPhone toont de vraag anders niet
    // als er eerst gewacht moet worden op de achtergronddienst.
    let permissionRequest: Promise<NotificationPermission>;
    try {
      permissionRequest = Promise.resolve(Notification.requestPermission());
    } catch (err) {
      permissionRequest = Promise.reject(err);
    }
    try {
      const permission = (await permissionRequest) ?? Notification.permission;
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      // Altijd via registerServiceWorker (één adres voor de hele app, zie lib/platform/serviceWorker).
      let reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
      // Wachten tot hij actief is, maar niet eindeloos.
      reg = (await activeRegistration(10_000)) ?? reg;
      if (!reg || (!reg.active && !reg.waiting && !reg.installing)) throw new Error("De achtergronddienst van de app kon niet starten. Herlaad de pagina en probeer het opnieuw.");
      // Een oud abonnement (bijv. van een vorige gebruiker) eerst opzeggen, dan een nieuw maken.
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe().catch(() => false);
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      const json = sub.toJSON();
      // Via de functie: die neemt ook een abonnement over dat nog bij een vorige gebruiker op dit
      // toestel hoorde (een gewone upsert loopt dan vast op de beveiliging).
      let { error } = await supabase.rpc("claim_push_subscription", {
        p_endpoint: sub.endpoint,
        p_p256dh: json.keys?.p256dh,
        p_auth: json.keys?.auth,
      });
      if (error && (error.code === "PGRST202" || error.code === "42883")) {
        // Functie bestaat nog niet (database niet bijgewerkt): de oude manier.
        ({ error } = await supabase
          .from("push_subscriptions")
          .upsert({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }, { onConflict: "endpoint" }));
      }
      if (error) {
        await sub.unsubscribe().catch(() => false);
        throw error;
      }
      setState("on");
      // Bevestiging op het toestel zelf, zodat je ziet dat het werkt.
      reg
        .showNotification("Meldingen staan aan", {
          body: "Je krijgt meldingen over je trainingen, je groep en vriendschapsverzoeken. Kies hieronder welke.",
          icon: "/icons/icon-192.png",
          badge: "/icons/badge-96.png",
          tag: "push-enabled",
        })
        .catch(() => {});
    } catch (err) {
      setError(`Aanzetten lukte niet. ${pushErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    actionGen.current++;
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        if (error) throw error;
        await sub.unsubscribe();
      }
      setState("off");
    } catch (err) {
      setError(`Uitzetten lukte niet. ${pushErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const on = state === "on";

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p id={labelId} className="font-semibold">
            Meldingen op dit apparaat
          </p>
          <p id={descId} className="text-xs text-muted">
            Geplande trainingen (ook &rsquo;s avonds wat er morgen gepland staat), een herinnering als je nog niet gelogd hebt,
            records van je groep en vriendschapsverzoeken. Per soort aan of uit te zetten.
          </p>
        </div>
        {state === "loading" ? (
          <span className="skeleton h-7 w-12 shrink-0 rounded-full" aria-hidden />
        ) : (
          (state === "on" || state === "off") && (
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-labelledby={labelId}
              aria-describedby={descId}
              aria-busy={busy}
              disabled={busy}
              onClick={on ? disable : enable}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 ${on ? "bg-accent" : "bg-surface-2 ring-1 ring-line"}`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full shadow transition-all duration-200 ${
                  on ? "left-6 bg-accent-ink" : "left-1 bg-muted"
                } ${busy ? "animate-pulse" : ""}`}
              />
            </button>
          )
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {state === "ios-install" && (
        <p className="text-xs text-warn">
          Op iPhone en iPad werken meldingen alleen als je de app eerst op je beginscherm zet (deelknop, “Zet op beginscherm”) en hem van daaruit opent.
        </p>
      )}
      {state === "ios-update" && (
        <p className="text-xs text-warn">Meldingen werken vanaf iOS 16.4. Werk je toestel bij om ze aan te zetten.</p>
      )}
      {state === "denied" && <p className="text-xs text-warn">Meldingen zijn geblokkeerd. Zet ze aan in de instellingen van je browser of telefoon.</p>}
      {state === "unsupported" && <p className="text-xs text-muted">Deze browser ondersteunt geen pushmeldingen.</p>}
    </div>
  );
}
