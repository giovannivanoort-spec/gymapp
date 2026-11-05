"use client";

import { useState, useSyncExternalStore } from "react";
import { APP_NAME } from "@/lib/brand";
import { AddSquareIcon, CloseIcon, DownloadIcon, ShareIosIcon } from "../Icons";
import { Sheet } from "../Sheet";

/*
 * "Installeer Spotter": een kleine, wegklikbare kaart voor wie de app nog in de browser gebruikt.
 * - iPhone/iPad: iOS kent geen installatieknop, dus we leggen Delen > Zet op beginscherm uit.
 * - Android/desktop Chrome: de browser geeft een installatieprompt (beforeinstallprompt) die we bewaren.
 */

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
type HintKind = "hidden" | "ios" | "prompt";

const DISMISS_KEY = "spotter:install-hint-dismissed";
/** Weggeklikt: zo lang (ms) niet meer tonen. */
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    emit();
  });
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function dismissedRecently() {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
    return at > 0 && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

function getKind(): HintKind {
  if (installed || isStandalone() || dismissedRecently()) return "hidden";
  if (deferred) return "prompt";
  return isIos() ? "ios" : "hidden";
}

export function InstallHint() {
  const kind = useSyncExternalStore(subscribe, getKind, () => "hidden" as HintKind);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (kind === "hidden" && !stepsOpen) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // geen opslag: dan alleen voor nu verbergen
      installed = true;
    }
    emit();
  }

  async function install() {
    if (kind === "ios") {
      setStepsOpen(true);
      return;
    }
    if (!deferred) return;
    setBusy(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") installed = true;
    } catch {
      // prompt al gebruikt of geweigerd door de browser
    } finally {
      deferred = null;
      setBusy(false);
      emit();
    }
  }

  return (
    <>
      {kind !== "hidden" && (
        <div className="animate-fade-up mb-4 flex items-center gap-3 rounded-2xl border border-line bg-surface py-2 pl-3 pr-1.5" role="region" aria-label={`${APP_NAME} installeren`}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent" aria-hidden>
            <DownloadIcon size={17} />
          </span>
          <p className="min-w-0 flex-1 text-sm leading-tight">
            <span className="block font-semibold">Zet {APP_NAME} op je beginscherm</span>
            <span className="block text-xs text-muted">Opent als app, sneller en met meldingen.</span>
          </p>
          <button type="button" className="btn-primary shrink-0 px-3 py-2 text-xs" onClick={install} disabled={busy}>
            {busy && <span className="spinner" aria-hidden />}
            {kind === "ios" ? "Hoe?" : "Installeer"}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:text-ink"
            aria-label="Niet nu"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}

      <Sheet open={stepsOpen} onClose={() => setStepsOpen(false)} title={`${APP_NAME} op je beginscherm`}>
        <ol className="space-y-3">
          <Step n={1} icon={<ShareIosIcon size={18} />}>
            Tik in Safari op <b className="font-semibold">Delen</b> (onderin, of bovenin op een iPad).
          </Step>
          <Step n={2} icon={<AddSquareIcon size={18} />}>
            Scroll omlaag en kies <b className="font-semibold">Zet op beginscherm</b>.
          </Step>
          <Step n={3} icon={<DownloadIcon size={18} />}>
            Tik op <b className="font-semibold">Voeg toe</b>. {APP_NAME} opent voortaan schermvullend, zoals een gewone app.
          </Step>
        </ol>
        <p className="mt-4 text-xs leading-relaxed text-muted">
          Op een iPhone krijg je alleen meldingen (bijv. reacties op je training) als {APP_NAME} op je beginscherm staat.
        </p>
        <button type="button" className="btn-ghost mt-5 w-full" onClick={() => setStepsOpen(false)}>
          Begrepen
        </button>
      </Sheet>
    </>
  );
}

function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-accent" aria-hidden>
        {icon}
      </span>
      <p className="min-w-0 flex-1 pt-0.5 text-sm">
        <span className="mr-1 font-semibold text-muted">{n}.</span>
        {children}
      </p>
    </li>
  );
}
