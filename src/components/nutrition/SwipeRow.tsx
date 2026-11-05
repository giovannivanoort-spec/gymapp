"use client";

import { useRef, useState } from "react";

/** Zo ver (deel van de breedte) of zo snel naar links vegen = verwijderen. */
const DELETE_FRACTION = 0.38;
const FLING_VELOCITY = 0.6;
/** Pas na zoveel pixels horizontaal beslissen we dat het een veeg is (en geen tik of scroll). */
const SLOP = 10;

/**
 * Lijstregel die je naar links kunt vegen om te verwijderen (alleen met touch; met muis en
 * toetsenbord blijft de gewone knop werken). Verticaal scrollen blijft normaal werken.
 * De pagina toont daarna een melding met "Ongedaan maken".
 */
export function SwipeRow({
  onDelete,
  label = "Verwijderen",
  className = "",
  children,
}: {
  onDelete: () => void;
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; t: number; dx: number; id: number; active: boolean } | null>(null);
  /** Na een veeg mag de tik op de knop eronder niet ook nog afgaan. */
  const suppressClick = useRef(false);
  const [removing, setRemoving] = useState(false);
  const [revealed, setRevealed] = useState(0);

  function setX(x: number, animate: boolean) {
    const el = ref.current;
    if (!el) return;
    el.style.transition = animate ? "transform 0.22s cubic-bezier(0.2, 0.9, 0.25, 1)" : "none";
    el.style.transform = x ? `translateX(${x}px)` : "";
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "touch" || removing) return;
    drag.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, dx: 0, id: e.pointerId, active: false };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.active) {
      if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null; // verticaal: de browser scrolt
        return;
      }
      if (Math.abs(dx) < SLOP) return;
      d.active = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    // Alleen naar links; naar rechts een klein beetje weerstand.
    d.dx = dx < 0 ? dx : dx / 8;
    setX(d.dx, false);
    setRevealed(Math.min(1, Math.max(0, -d.dx) / ((ref.current?.offsetWidth ?? 300) * DELETE_FRACTION)));
  }

  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 50);
    const width = ref.current?.offsetWidth ?? 300;
    const velocity = -d.dx / Math.max(1, e.timeStamp - d.t);
    if (e.type === "pointerup" && (-d.dx > width * DELETE_FRACTION || (-d.dx > 40 && velocity > FLING_VELOCITY))) {
      setRemoving(true);
      setX(-width, true);
      navigator.vibrate?.(10);
      window.setTimeout(onDelete, 180);
      return;
    }
    setX(0, true);
    setRevealed(0);
  }

  return (
    <div className={`relative overflow-hidden ${className}`} data-noswipe>
      <div
        className="absolute inset-0 flex items-center justify-end bg-danger/90 pr-5 text-sm font-semibold text-white"
        style={{ opacity: removing ? 1 : revealed > 0 ? 0.35 + revealed * 0.65 : 0 }}
        aria-hidden
      >
        <span style={{ transform: `scale(${0.85 + revealed * 0.15})` }} className="transition-transform">
          {label}
        </span>
      </div>
      <div
        ref={ref}
        className="relative bg-surface"
        style={{ touchAction: "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
