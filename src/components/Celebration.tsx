"use client";

import { useEffect, useRef } from "react";
import { TIERS } from "@/lib/ranks";
import { RankBadge } from "./RankBadge";

export type CelebrationData =
  | { kind: "promotion"; tierIndex: number; exercise: string; who?: string }
  | { kind: "record"; exercise: string; detail: string; who?: string };

/** Promotie: badge-onthulling met confetti. Persoonlijk record: korte melding bovenin. */
export function Celebration({ data, onClose }: { data: CelebrationData | null; onClose: () => void }) {
  useEffect(() => {
    if (!data) return;
    navigator.vibrate?.(data.kind === "promotion" ? [30, 60, 30] : 20);
    const t = setTimeout(onClose, data.kind === "promotion" ? 4200 : 2600);
    return () => clearTimeout(t);
  }, [data, onClose]);

  if (!data) return null;

  if (data.kind === "record") {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[70] flex justify-center px-4">
        <div className="animate-scale-in flex items-center gap-3 rounded-2xl border border-accent/40 bg-surface/95 px-4 py-3 shadow-2xl backdrop-blur">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-ink">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 19V5M6 11l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-bold">Persoonlijk record{data.who ? ` voor ${data.who}` : ""}</p>
            <p className="text-xs text-muted">
              {data.exercise} · {data.detail}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const tier = TIERS[data.tierIndex];
  return (
    <div className="animate-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm" onClick={onClose}>
      <Confetti colors={[tier.from, tier.to, "#ffffff"]} />
      <div className="relative flex flex-col items-center text-center">
        <div className="relative">
          <span
            className="absolute inset-3 rounded-full"
            style={{ border: `2px solid ${tier.to}`, animation: "ring-pulse 1.8s ease-out 0.5s infinite both" }}
          />
          <RankBadge tierIndex={data.tierIndex} size={148} glow className="animate-badge-reveal relative" />
        </div>
        <p className="animate-fade-up mt-6 text-xs font-semibold uppercase tracking-[0.25em] text-muted" style={{ "--i": 8 } as React.CSSProperties}>
          Promotie{data.who ? ` · ${data.who}` : ""}
        </p>
        <h2 className="animate-fade-up mt-1 text-4xl font-black tracking-tight" style={{ color: tier.to, "--i": 10 } as React.CSSProperties}>
          {tier.name}
        </h2>
        <p className="animate-fade-up mt-2 text-sm text-muted" style={{ "--i": 12 } as React.CSSProperties}>
          {data.exercise}
        </p>
      </div>
    </div>
  );
}

/** Lichte confetti op een canvas (geen extra library). */
function Confetti({ colors }: { colors: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);

    const pieces = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 80,
      y: innerHeight / 2 - 40,
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
      ctx.clearRect(0, 0, innerWidth, innerHeight);
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
    return () => cancelAnimationFrame(raf);
  }, [colors]);

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 h-full w-full" />;
}
