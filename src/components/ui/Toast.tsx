"use client";

import { useSyncExternalStore } from "react";
import { CloseIcon } from "../Icons";
import { Portal } from "../Portal";

/*
 * Eén meldingensysteem voor de hele app. Overal aan te roepen (ook buiten React):
 *
 *   toast("Training opgeslagen");
 *   toast.error("Opslaan lukte niet");
 *   toast("Set verwijderd", { action: { label: "Ongedaan maken", run: undo } });
 *
 * <Toaster /> staat één keer in de AuthProvider. Meldingen staan altijd op dezelfde plek (boven de
 * onderbalk), boven panelen en banners (z-index --z-toast), met dezelfde in- en uitgaande animatie.
 */

export type ToastTone = "info" | "success" | "error" | "warn";
export type ToastAction = { label: string; run: () => void };
export type ToastOptions = {
  tone?: ToastTone;
  /** Knop rechts, bijv. "Ongedaan maken". Verlengt de tijd dat de melding blijft staan. */
  action?: ToastAction;
  /** Hoe lang zichtbaar in ms. Standaard 2,8 s, met actie 6 s, bij een fout 5 s. 0 = tot wegklikken. */
  duration?: number;
};

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  leaving: boolean;
  /** Blijft staan tot wegklikken (duration 0): een nieuwe melding duwt hem niet weg. */
  sticky: boolean;
};

const EXIT_MS = 180;
let items: ToastItem[] = [];
let counter = 0;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
/**
 * Resterende tijd per melding, zodat de timer kan pauzeren zolang je erop wijst of de knop
 * focus heeft (anders verdwijnt "Ongedaan maken" net terwijl je hem wilt aantikken).
 */
const timing = new Map<number, { remaining: number; start: number; holds: Set<string> }>();
/** Na het hervatten blijft een melding in elk geval nog zo lang staan. */
const MIN_AFTER_RESUME = 1500;

function schedule(id: number, ms: number) {
  const t = timing.get(id);
  if (t) {
    t.remaining = ms;
    t.start = Date.now();
  } else {
    timing.set(id, { remaining: ms, start: Date.now(), holds: new Set() });
  }
  timers.set(id, setTimeout(() => dismissToast(id), ms));
}

/** Timer van een melding pauzeren (reden: "hover" of "focus"). */
function holdToast(id: number, reason: string) {
  const t = timing.get(id);
  if (!t) return;
  if (!t.holds.size) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    t.remaining -= Date.now() - t.start;
  }
  t.holds.add(reason);
}

/** Pauze opheffen; loopt weer zodra er geen reden meer is om te wachten. */
function releaseToast(id: number, reason: string) {
  const t = timing.get(id);
  if (!t || !t.holds.delete(reason) || t.holds.size) return;
  schedule(id, Math.max(t.remaining, MIN_AFTER_RESUME));
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const getSnapshot = () => items;
const EMPTY: ToastItem[] = [];
const getServerSnapshot = () => EMPTY;

function defaultDuration(o: ToastOptions) {
  if (o.action) return 6000;
  if (o.tone === "error") return 5000;
  return 2800;
}

/** Verbergt een melding (met uitgaande animatie). Zonder id: alle meldingen. */
export function dismissToast(id?: number) {
  hide(items.filter((t) => !t.leaving && (id === undefined || t.id === id)));
}

function hide(targets: ToastItem[]) {
  if (!targets.length) return;
  for (const t of targets) {
    clearTimeout(timers.get(t.id));
    timing.delete(t.id);
    timers.set(
      t.id,
      setTimeout(() => {
        timers.delete(t.id);
        items = items.filter((x) => x.id !== t.id);
        emit();
      }, EXIT_MS),
    );
  }
  const ids = new Set(targets.map((t) => t.id));
  items = items.map((t) => (ids.has(t.id) ? { ...t, leaving: true } : t));
  emit();
}

function show(message: string, options: ToastOptions = {}): number {
  const id = ++counter;
  const ms = options.duration ?? defaultDuration(options);
  // 0 of Infinity: blijft staan tot hij wordt weggeklikt (bijv. "Nieuwe versie, herladen").
  const sticky = !(ms > 0 && Number.isFinite(ms));
  // Eén tijdelijke melding tegelijk: een nieuwe vervangt de vorige (die schuift netjes weg).
  // Blijvende meldingen blijven staan; die verdwijnen alleen via hun eigen knop of dismissToast(id).
  hide(items.filter((t) => !t.leaving && !t.sticky));
  items = [...items, { id, message, tone: options.tone ?? "info", action: options.action, leaving: false, sticky }];
  emit();
  if (!sticky) schedule(id, ms);
  return id;
}

type ToastFn = ((message: string, options?: ToastOptions) => number) & {
  success: (message: string, options?: Omit<ToastOptions, "tone">) => number;
  error: (message: string, options?: Omit<ToastOptions, "tone">) => number;
  warn: (message: string, options?: Omit<ToastOptions, "tone">) => number;
  dismiss: (id?: number) => void;
};

export const toast: ToastFn = Object.assign((message: string, options?: ToastOptions) => show(message, options), {
  success: (message: string, options?: Omit<ToastOptions, "tone">) => show(message, { ...options, tone: "success" }),
  error: (message: string, options?: Omit<ToastOptions, "tone">) => show(message, { ...options, tone: "error" }),
  warn: (message: string, options?: Omit<ToastOptions, "tone">) => show(message, { ...options, tone: "warn" }),
  dismiss: dismissToast,
});

/** Hook-vorm voor componenten die dat prettiger vinden: `const { show, dismiss } = useToast()`. */
export function useToast() {
  return { show: toast, dismiss: dismissToast };
}

const DOT: Record<ToastTone, string> = {
  info: "bg-muted",
  success: "bg-accent",
  error: "bg-danger",
  warn: "bg-warn",
};

const BORDER: Record<ToastTone, string> = {
  info: "border-line",
  success: "border-accent/40",
  error: "border-danger/50",
  warn: "border-warn/50",
};

/** Plek waar meldingen verschijnen. Eén keer renderen (gebeurt in de AuthProvider). */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <Portal>
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 z-(--z-toast) flex flex-col items-center gap-2 px-4"
        // --toast-lift: extra ruimte als een scherm onderin een vaste balk heeft (bijv. Opslaan in de planner).
        style={{ bottom: "calc(env(safe-area-inset-bottom) + var(--nav-h) + 1.75rem + var(--toast-lift, 0px))" }}
      >
        {list.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border bg-surface/95 py-1.5 pl-4 pr-1.5 text-sm shadow-2xl shadow-black/40 backdrop-blur-xl ${BORDER[t.tone]} ${
              t.leaving ? "animate-fade-out" : "animate-toast-in"
            }`}
            // Een vertrekkende melding schuift niet omhoog weg, maar vervaagt op dezelfde plek onder de nieuwe.
            style={t.leaving && list.length > 1 ? { position: "absolute", bottom: 0, left: 16, right: 16, margin: "0 auto" } : undefined}
            // Alleen met een muis: op een touchscreen blijft "hover" na een tik hangen.
            onPointerEnter={(e) => e.pointerType === "mouse" && holdToast(t.id, "hover")}
            onPointerLeave={(e) => e.pointerType === "mouse" && releaseToast(t.id, "hover")}
            onFocus={() => holdToast(t.id, "focus")}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) releaseToast(t.id, "focus");
            }}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[t.tone]}`} aria-hidden />
            <p className={`min-w-0 flex-1 py-2 ${t.tone === "error" ? "text-danger" : "text-ink"}`}>{t.message}</p>
            {t.action ? (
              <button
                type="button"
                className="min-h-11 shrink-0 rounded-xl bg-surface-2 px-3 text-sm font-semibold text-accent transition active:scale-95"
                onClick={() => {
                  t.action!.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            ) : (
              <button
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:text-ink"
                onClick={() => dismissToast(t.id)}
                aria-label="Melding sluiten"
              >
                <CloseIcon size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
    </Portal>
  );
}
