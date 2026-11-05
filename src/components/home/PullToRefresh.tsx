"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshIcon } from "@/components/Icons";
import { Portal } from "@/components/Portal";

/** Zo ver (px, na demping) moet je trekken om te verversen. */
const THRESHOLD = 64;
const MAX = 96;
/** Spinner minstens zo lang tonen, anders flitst hij alleen. */
const MIN_SPIN = 600;

/**
 * Trek-om-te-verversen voor Home (een iOS-PWA op het beginscherm heeft dat zelf niet).
 * Werkt alleen bovenaan de pagina en niet in pop-ups; horizontaal vegen (vriendenrij) telt niet.
 * De indicator staat via een Portal vast boven de pagina.
 */
export function PullToRefresh({ onRefresh }: { onRefresh: () => Promise<unknown> }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const busy = useRef(false);
  const latest = useRef(onRefresh);
  useEffect(() => {
    latest.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let decided = false;
    let current = 0;
    let armed = false;

    // Geen ingebouwde "pull to refresh" van de browser (Android herlaadt dan de hele pagina).
    const html = document.documentElement;
    const prevOverscroll = html.style.overscrollBehaviorY;
    html.style.overscrollBehaviorY = "contain";

    const reset = () => {
      tracking = false;
      decided = false;
      armed = false;
      current = 0;
    };

    const onStart = (e: TouchEvent) => {
      if (busy.current || e.touches.length !== 1 || window.scrollY > 0) return;
      const target = e.target as Element | null;
      if (target?.closest?.('[role="dialog"], [aria-modal="true"], input, textarea, select')) return;
      // Een open pop-up (ook als je op de achtergrond ervan tikt): niet verversen.
      if (document.querySelector('[aria-modal="true"]')) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
      decided = false;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!decided) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        decided = true;
        // Horizontaal vegen of omhoog scrollen: geen verversing.
        if (Math.abs(dx) > Math.abs(dy) || dy < 0) {
          tracking = false;
          return;
        }
      }
      if (window.scrollY > 0) {
        tracking = false;
        current = 0;
        setDragging(false);
        setPull(0);
        return;
      }
      // Gedempt: hoe verder je trekt, hoe minder het nog beweegt.
      current = Math.min(MAX, Math.max(0, dy) * 0.5);
      setDragging(true);
      if (!armed && current >= THRESHOLD) {
        armed = true;
        try {
          navigator.vibrate?.(8);
        } catch {
          // geen trilfunctie
        }
      } else if (armed && current < THRESHOLD) {
        armed = false;
      }
      setPull(current);
    };

    const onEnd = () => {
      if (!tracking) return;
      const go = current >= THRESHOLD;
      reset();
      setDragging(false);
      if (!go) {
        setPull(0);
        return;
      }
      busy.current = true;
      setRefreshing(true);
      setPull(THRESHOLD);
      const started = Date.now();
      Promise.resolve()
        .then(() => latest.current())
        .catch(() => {})
        .then(() => new Promise((r) => setTimeout(r, Math.max(0, MIN_SPIN - (Date.now() - started)))))
        .then(() => {
          busy.current = false;
          setRefreshing(false);
          setPull(0);
        });
    };

    // Onderbroken gebaar (bijv. een systeemmelding): terugveren, niet verversen.
    const onCancel = () => {
      if (!tracking) return;
      reset();
      setDragging(false);
      setPull(0);
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      html.style.overscrollBehaviorY = prevOverscroll;
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, []);

  const visible = pull > 0 || refreshing;
  const progress = Math.min(1, pull / THRESHOLD);

  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {refreshing ? "Verversen" : ""}
      </span>
      {visible && (
        <Portal>
          <div
            aria-hidden
            className="pointer-events-none fixed inset-x-0 z-30 flex justify-center"
            style={{
              top: "calc(env(safe-area-inset-top) + 4px)",
              transform: `translateY(${refreshing ? THRESHOLD * 0.5 : pull * 0.5}px)`,
              transition: dragging ? "none" : "transform 0.25s cubic-bezier(0.2,0.8,0.2,1)",
            }}
          >
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-full border shadow-lg backdrop-blur ${
                progress >= 1 || refreshing ? "border-accent/50 bg-surface text-accent" : "border-line bg-surface/90 text-muted"
              }`}
              style={{ opacity: refreshing ? 1 : 0.35 + progress * 0.65 }}
            >
              {refreshing ? (
                <span className="spinner text-[16px]" />
              ) : (
                <span style={{ transform: `rotate(${progress * 270}deg)` }} className="flex">
                  <RefreshIcon size={16} strokeWidth={2.4} />
                </span>
              )}
            </span>
          </div>
        </Portal>
      )}
    </>
  );
}
