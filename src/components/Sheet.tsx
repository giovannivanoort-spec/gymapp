"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { CloseIcon } from "./Icons";
import { Portal } from "./Portal";
import { APP_ROOT_ID } from "./shell/appRoot";

/* ───────── Gedeeld tussen alle open panelen ─────────
   Alleen het bovenste paneel reageert op Escape/Tab, en de pagina blijft vergrendeld
   tot het laatste paneel dicht is (ook bij panelen in panelen). */
const stack: { id: string; root: () => HTMLElement | null }[] = [];
let lockCount = 0;
let lockedScrollY = 0;
let lockedUrl = "";

/** Pagina vastzetten. `overflow: hidden` alleen houdt iOS niet tegen, `position: fixed` wel. */
function lockScroll() {
  lockCount++;
  if (lockCount > 1) return;
  lockedScrollY = window.scrollY;
  lockedUrl = window.location.pathname + window.location.search;
  const s = document.body.style;
  s.position = "fixed";
  s.top = `-${lockedScrollY}px`;
  s.left = "0";
  s.right = "0";
  s.width = "100%";
  s.overflow = "hidden";
}

function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0) return;
  const s = document.body.style;
  s.position = s.top = s.left = s.right = s.width = s.overflow = "";
  // Na navigatie vanuit het paneel heeft de nieuwe pagina zijn eigen scrollpositie.
  if (window.location.pathname + window.location.search === lockedUrl) window.scrollTo(0, lockedScrollY);
}

/**
 * Alles behalve het bovenste paneel `inert` maken: de app zelf en eventuele panelen eronder.
 * `aria-modal` alleen houdt VoiceOver op iOS niet tegen; met veegbewegingen kom je anders
 * gewoon in de pagina achter het paneel terecht. Meldingen (Toaster) staan los in <body>
 * en blijven dus bruikbaar, zodat "Ongedaan maken" ook boven een paneel werkt.
 */
function syncInert() {
  const app = document.getElementById(APP_ROOT_ID);
  if (app) app.inert = stack.length > 0;
  stack.forEach((entry, i) => {
    const el = entry.root();
    if (el) el.inert = i < stack.length - 1;
  });
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapTab(e: KeyboardEvent, panel: HTMLElement) {
  const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
  if (items.length === 0) {
    e.preventDefault();
    panel.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === panel)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  } else if (!panel.contains(active)) {
    e.preventDefault();
    first.focus();
  }
}

/* ───────── Omlaag vegen om te sluiten ───────── */

/** Paneel meebewegen met de vinger. Omhoog trekken geeft weerstand. Geeft de toegepaste afstand terug. */
function dragTo(panel: HTMLElement, backdrop: HTMLElement | null, raw: number): number {
  const dy = raw > 0 ? raw : raw / 6;
  panel.style.transition = "none";
  panel.style.transform = `translateY(${dy}px)`;
  if (backdrop) backdrop.style.opacity = String(Math.max(0.2, 1 - Math.max(0, dy) / panel.offsetHeight));
  return dy;
}

/** Ver genoeg, of snel genoeg, omlaag geveegd om te sluiten? */
function shouldDismiss(panel: HTMLElement, dy: number, ms: number): boolean {
  const velocity = dy / Math.max(1, ms);
  return dy > Math.min(140, panel.offsetHeight * 0.3) || (dy > 24 && velocity > 0.5);
}

/** Terugveren naar de open stand. */
function snapBack(panel: HTMLElement, backdrop: HTMLElement | null) {
  panel.style.transition = "transform 0.25s cubic-bezier(0.2, 0.9, 0.25, 1)";
  panel.style.transform = "";
  if (backdrop) backdrop.style.opacity = "";
}

/** Hier begint nooit een veeggebaar (schuifregelaars, tekstvelden, of expliciet uitgezet). */
const NO_DRAG = 'input, textarea, select, [contenteditable="true"], [data-sheet-nodrag]';

/**
 * Onderaan uitschuivend paneel (mobiel), gecentreerd op grotere schermen.
 * Sluit met Escape, een tik naast het paneel, de sluitknop of door het omlaag te vegen.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number; pointer: number } | null>(null);

  // Open/dicht met een uitgaande animatie: na `open = false` blijft het paneel nog even staan.
  const [prevOpen, setPrevOpen] = useState(open);
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  // Laatst getoonde inhoud, zodat het paneel tijdens het sluiten niet leeg wegschuift.
  const [shown, setShown] = useState({ title, children });
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
    }
  }
  if (open && (shown.title !== title || shown.children !== children)) setShown({ title, children });

  const requestClose = useEffectEvent(() => onClose());

  // Focus, toetsen en scroll-vergrendeling zolang het paneel in beeld is.
  useEffect(() => {
    if (!mounted) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push({ id, root: () => rootRef.current });
    syncInert();
    lockScroll();
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1]?.id !== id) return;
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
      } else if (e.key === "Tab" && panelRef.current) {
        trapTab(e, panelRef.current);
      }
    };
    document.addEventListener("keydown", onKey);

    /*
     * Omlaag vegen vanaf de inhoud, net als bij native panelen: alleen als de inhoud helemaal
     * bovenaan staat en het gebaar omlaag gaat. Anders scrollt de inhoud gewoon. Met touch-events
     * (niet passief), omdat de browser het gebaar anders zelf als scrollen opeist.
     */
    const content = contentRef.current;
    let touch: { y: number; x: number; t: number; dy: number; active: boolean } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touch = null;
      if (e.touches.length !== 1 || rootRef.current?.dataset.closing) return;
      const target = e.target as Element | null;
      if (!content || target?.closest?.(NO_DRAG)) return;
      // Een lijst binnen de inhoud die zelf gescrold is, moet eerst terug omhoog kunnen scrollen.
      for (let el: Element | null = target; el && el !== content; el = el.parentElement) {
        if (el.scrollTop > 0) return;
      }
      const p = e.touches[0];
      touch = { y: p.clientY, x: p.clientX, t: e.timeStamp, dy: 0, active: false };
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = touch;
      const panelEl = panelRef.current;
      if (!t || !content || !panelEl) return;
      const p = e.touches[0];
      const dy = p.clientY - t.y;
      if (!t.active) {
        const dx = Math.abs(p.clientX - t.x);
        if (dy === 0 && dx === 0) return;
        // Al gescrold, omhoog, of vooral zijwaarts: dat is scrollen, geen sluiten.
        if (content.scrollTop > 0 || dy <= 0 || dx > dy) {
          touch = null;
          return;
        }
        t.active = true;
        t.t = e.timeStamp;
      }
      if (e.cancelable) e.preventDefault();
      t.dy = dragTo(panelEl, backdropRef.current, dy);
    };
    const onTouchEnd = (e: TouchEvent) => {
      const t = touch;
      touch = null;
      const panelEl = panelRef.current;
      if (!t?.active || !panelEl) return;
      if (e.type === "touchend" && shouldDismiss(panelEl, t.dy, e.timeStamp - t.t)) requestClose();
      else snapBack(panelEl, backdropRef.current);
    };
    content?.addEventListener("touchstart", onTouchStart, { passive: true });
    content?.addEventListener("touchmove", onTouchMove, { passive: false });
    content?.addEventListener("touchend", onTouchEnd);
    content?.addEventListener("touchcancel", onTouchEnd);

    /*
     * Toetsenbord op iOS: het paneel hangt aan de onderkant van het layout-venster, en dat valt
     * achter het toetsenbord. We meten hoeveel van de onderkant bedekt is en tillen het paneel
     * zo ver op (CSS-variabele --kb), zodat het veld en de knop eronder zichtbaar blijven.
     */
    const vv = window.visualViewport;
    let frame = 0;
    const onViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = rootRef.current;
        if (!root || !vv) return;
        const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        root.style.setProperty("--kb", `${inset}px`);
        const active = document.activeElement;
        if (inset > 0 && active instanceof HTMLElement && panelRef.current?.contains(active) && active.matches("input, textarea, select")) {
          active.scrollIntoView({ block: "nearest" });
        }
      });
    };
    vv?.addEventListener("resize", onViewport);
    vv?.addEventListener("scroll", onViewport);
    onViewport();

    return () => {
      document.removeEventListener("keydown", onKey);
      content?.removeEventListener("touchstart", onTouchStart);
      content?.removeEventListener("touchmove", onTouchMove);
      content?.removeEventListener("touchend", onTouchEnd);
      content?.removeEventListener("touchcancel", onTouchEnd);
      vv?.removeEventListener("resize", onViewport);
      vv?.removeEventListener("scroll", onViewport);
      cancelAnimationFrame(frame);
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].id === id) {
          stack.splice(i, 1);
          break;
        }
      }
      // Eerst de pagina weer bruikbaar maken; een inert element kan geen focus terugkrijgen.
      syncInert();
      unlockScroll();
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [mounted, id]);

  // Vangnet als er geen animationend komt (bijv. animaties uitgeschakeld door de browser).
  useEffect(() => {
    if (!closing) {
      if (panelRef.current) panelRef.current.style.transform = "";
      if (backdropRef.current) backdropRef.current.style.opacity = "";
      return;
    }
    const t = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, 400);
    return () => clearTimeout(t);
  }, [closing]);

  if (!mounted) return null;

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" || closing) return;
    if ((e.target as Element).closest("button, a, input, textarea, select")) return;
    drag.current = { y: e.clientY, t: e.timeStamp, dy: 0, pointer: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const panel = panelRef.current;
    if (!d || d.pointer !== e.pointerId || !panel) return;
    d.dy = dragTo(panel, backdropRef.current, e.clientY - d.y);
  }

  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const panel = panelRef.current;
    if (!d || d.pointer !== e.pointerId || !panel) return;
    drag.current = null;
    if (e.type === "pointerup" && shouldDismiss(panel, d.dy, e.timeStamp - d.t)) {
      onClose();
      return;
    }
    snapBack(panel, backdropRef.current);
  }

  const dragHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
  };

  return (
    <Portal>
      <div
        ref={rootRef}
        data-closing={closing || undefined}
        className={`fixed inset-0 z-(--z-sheet) flex items-end justify-center pb-[var(--kb,0px)] transition-[padding] duration-200 ease-out sm:items-center sm:p-6 ${closing ? "pointer-events-none" : ""}`}
      >
        <div
          ref={backdropRef}
          className={`absolute inset-0 bg-black/60 backdrop-blur-[2px] ${closing ? "animate-fade-out" : "animate-fade-in"}`}
          onClick={onClose}
          aria-hidden
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onAnimationEnd={(e) => {
            if (closing && e.target === e.currentTarget) {
              setMounted(false);
              setClosing(false);
            }
          }}
          className={`relative flex max-h-[calc(88dvh-var(--kb,0px))] w-full max-w-2xl flex-col rounded-t-3xl border border-line bg-surface shadow-2xl outline-none sm:rounded-3xl ${
            closing ? "animate-sheet-down sm:animate-scale-out" : "animate-sheet-up sm:animate-scale-in"
          }`}
        >
          <div {...dragHandlers} className="shrink-0 touch-none">
            <div className="flex justify-center pb-1 pt-2 sm:hidden" aria-hidden>
              <span className="h-1 w-10 rounded-full bg-line" />
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-line py-2 pl-5 pr-2 sm:pt-3">
              <h2 id={titleId} className="min-w-0 flex-1 truncate text-lg font-bold">
                {shown.title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-ink active:scale-95"
                aria-label="Sluiten"
              >
                <CloseIcon size={22} />
              </button>
            </div>
          </div>
          {/* min-h-0: zonder dit kan het scrollgebied niet krimpen en valt de onderkant buiten beeld. */}
          <div
            ref={contentRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))]"
          >
            {open ? children : shown.children}
          </div>
        </div>
      </div>
    </Portal>
  );
}
