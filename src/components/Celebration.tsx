"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { TIERS } from "@/lib/ranks";
import { Portal } from "./Portal";
import { RankBadge } from "./RankBadge";

/**
 * `who`: voor wie (als jij het voor een ander logt). `by`: wie het heeft gelogd (als je trainer
 * jouw record heeft ingevuld en je het op je eigen telefoon ziet).
 */
export type CelebrationData =
  | { kind: "promotion"; tierIndex: number; exercise: string; who?: string; by?: string }
  | { kind: "record"; exercise: string; detail: string; who?: string; by?: string };

/** Promotie: badge-onthulling met confetti. Persoonlijk record: korte melding bovenin. */
export const Celebration = memo(function Celebration({
  data,
  onClose,
}: {
  data: CelebrationData | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!data) return;
    navigator.vibrate?.(data.kind === "promotion" ? [30, 60, 30] : 20);
    const t = setTimeout(onClose, data.kind === "promotion" ? 4200 : 2800);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [data, onClose]);

  if (!data) return null;

  if (data.kind === "record") {
    return (
      <Portal>
        {/* Onder de offline-melding bovenin, zodat ze elkaar niet bedekken */}
        <div className="pointer-events-none fixed inset-x-0 top-[calc(max(0.5rem,env(safe-area-inset-top))+2.75rem)] z-(--z-toast) flex justify-center px-4">
          <div role="status" aria-live="polite" className="max-w-full">
            <button
              type="button"
              onClick={onClose}
              title="Sluiten"
              className="animate-scale-in pointer-events-auto flex max-w-full items-center gap-3 rounded-2xl border border-accent/40 bg-surface/95 px-4 py-3 text-left shadow-2xl backdrop-blur transition active:scale-[0.98]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 19V5M6 11l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">Persoonlijk record{data.who ? ` voor ${data.who}` : ""}</span>
                <span className="block truncate text-xs text-muted">
                  {data.exercise} · {data.detail}
                </span>
                {data.by && <span className="block truncate text-xs text-muted">Gelogd door {data.by}</span>}
              </span>
            </button>
          </div>
        </div>
      </Portal>
    );
  }

  return <Promotion tierIndex={data.tierIndex} exercise={data.exercise} who={data.who} by={data.by} onClose={onClose} />;
});

function Promotion({
  tierIndex,
  exercise,
  who,
  by,
  onClose,
}: {
  tierIndex: number;
  exercise: string;
  who?: string;
  by?: string;
  onClose: () => void;
}) {
  const tier = TIERS[tierIndex] ?? TIERS[0];
  const dialogRef = useRef<HTMLDivElement>(null);
  // Focus in het venster zetten en daarna terug naar waar je was (toetsenbord en schermlezer).
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => previous?.focus({ preventScroll: true });
  }, []);
  // Stabiel per tier: anders start de confetti bij elke render van de pagina opnieuw.
  const colors = useMemo(() => [tier.from, tier.to, "#ffffff"], [tier]);
  return (
    <Portal>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Promotie naar ${tier.name}${who ? ` voor ${who}` : ""}: ${exercise}`}
        className="animate-fade-in fixed inset-0 z-(--z-toast) flex items-center justify-center bg-black/75 p-6 outline-none backdrop-blur-sm"
        onClick={onClose}
      >
        <Confetti colors={colors} />
        <div className="relative flex flex-col items-center text-center">
          <div className="relative">
            <span
              className="absolute inset-3 rounded-full"
              style={{
                border: `2px solid ${tier.to}`,
                animation: "ring-pulse 1.8s ease-out 0.5s infinite both",
              }}
            />
            <RankBadge tierIndex={tierIndex} size={148} glow className="animate-badge-reveal relative" />
          </div>
          <p
            className="animate-fade-up mt-6 text-xs font-semibold uppercase tracking-[0.25em] text-muted"
            style={{ "--i": 8 } as React.CSSProperties}
          >
            Promotie{who ? ` · ${who}` : ""}
          </p>
          <h2
            className="animate-fade-up mt-1 text-4xl font-black tracking-tight"
            style={{ color: tier.to, "--i": 10 } as React.CSSProperties}
          >
            {tier.name}
          </h2>
          <p className="animate-fade-up mt-2 text-sm text-muted" style={{ "--i": 12 } as React.CSSProperties}>
            {exercise}
            {by ? ` · gelogd door ${by}` : ""}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="animate-fade-up mt-6 min-h-11 rounded-xl px-4 text-xs text-muted/80 hover:text-ink"
            style={{ "--i": 16 } as React.CSSProperties}
          >
            Tik om te sluiten
          </button>
        </div>
      </div>
    </Portal>
  );
}

/** Lichte confetti op een canvas (geen extra library). */
function Confetti({ colors }: { colors: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    let w = innerWidth;
    let h = innerHeight;
    const resize = () => {
      w = innerWidth;
      h = innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const pieces = Array.from({ length: 140 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * 80,
      y: h / 2 - 40,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 15 - 4,
      size: 5 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));

    let frame = 0;
    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of pieces) {
        p.vy += 0.35;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - frame / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (++frame < 180) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [colors]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 h-full w-full" />;
}
