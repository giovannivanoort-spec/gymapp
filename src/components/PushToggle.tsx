"use client";

import { useEffect, useState } from "react";
import { errorMessage, supabase } from "@/lib/supabase";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Meldingen aan/uit voor dit apparaat (records van groepsleden en geplande trainingen). */
export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      // Op iPhone werken meldingen alleen als de app op het beginscherm staat.
      Promise.resolve().then(() => setState(isIOS && !standalone ? "ios-install" : "unsupported"));
      return;
    }
    if (Notification.permission === "denied") {
      Promise.resolve().then(() => setState("denied"));
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) throw new Error("Meldingen zijn nog niet ingesteld op de server.");
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      const json = sub.toJSON();
      const { error } = await supabase
        .from("push_subscriptions")
        .upsert({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }, { onConflict: "endpoint" });
      if (error) throw error;
      setState("on");
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Meldingen</p>
          <p className="text-xs text-muted">Records en promoties van je groep, en een herinnering als er vandaag een training gepland staat.</p>
        </div>
        {(state === "on" || state === "off") && (
          <button
            role="switch"
            aria-checked={state === "on"}
            disabled={busy}
            onClick={state === "on" ? disable : enable}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${state === "on" ? "bg-accent" : "bg-surface-2 ring-1 ring-line"}`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full shadow transition-all duration-200 ${
                state === "on" ? "left-6 bg-accent-ink" : "left-1 bg-muted"
              }`}
            />
          </button>
        )}
      </div>
      {state === "ios-install" && (
        <p className="text-xs text-warn">Op iPhone werken meldingen alleen als je de app eerst op je beginscherm zet (deelknop, “Zet op beginscherm”) en hem van daaruit opent.</p>
      )}
      {state === "denied" && <p className="text-xs text-warn">Meldingen zijn geblokkeerd. Zet ze aan in de instellingen van je browser of telefoon.</p>}
      {state === "unsupported" && <p className="text-xs text-muted">Deze browser ondersteunt geen pushmeldingen.</p>}
    </div>
  );
}
