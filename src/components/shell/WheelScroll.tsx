"use client";

import { useEffect } from "react";

/**
 * Horizontale rijen (chips, vrienden, weekstrip) hebben geen zichtbare scrollbalk. Met een gewone
 * muis (alleen verticaal wiel) zou je ze op desktop dan niet kunnen scrollen; dit zet een verticale
 * wielbeweging boven zo'n rij om naar horizontaal scrollen. Trackpads en touch blijven ongemoeid.
 */
export function WheelScroll() {
  useEffect(() => {
    function onWheel(e: WheelEvent) {
      if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || e.deltaY === 0) return;
      let el = e.target instanceof Element ? e.target.closest<HTMLElement>(".overflow-x-auto") : null;
      while (el) {
        if (el.scrollWidth > el.clientWidth + 1) {
          const max = el.scrollWidth - el.clientWidth;
          const atEdge = (e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max - 1);
          // Aan het eind van de rij gewoon de pagina laten scrollen.
          if (atEdge) return;
          const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
          el.scrollBy({ left: step });
          e.preventDefault();
          return;
        }
        el = el.parentElement?.closest<HTMLElement>(".overflow-x-auto") ?? null;
      }
    }
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);
  return null;
}
