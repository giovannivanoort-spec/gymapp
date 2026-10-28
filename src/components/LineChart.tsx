"use client";

import { useEffect, useRef, useState } from "react";

export type ChartPoint = { date: string; value: number; detail?: string };

const H = 200;
const PAD = { top: 16, right: 12, bottom: 26, left: 40 };

/** Afronden naar "mooie" tick-waarden (1, 2, 2,5, 5 × 10^n). */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

function shortDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

/**
 * Eén lijn over tijd met tooltip (hover/aanraken). Tijd-as op echte datum-afstand.
 * Enkelvoudige reeks: geen legenda; de titel erboven benoemt de reeks.
 */
export function LineChart({ points, unit }: { points: ChartPoint[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Tekenen op de echte breedte, zodat tekst niet mee verkleint op een telefoon.
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (points.length === 0) return null;

  const times = points.map((p) => new Date(p.date).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const values = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (t1 === t0 ? innerW / 2 : ((t - t0) / (t1 - t0)) * innerW);
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;
  const coords = points.map((p, i) => ({ x: x(times[i]), y: y(p.value) }));
  const path = coords.map((c, i) => `${i ? "L" : "M"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const showMarkers = points.length <= 40;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = ref.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    let best = 0;
    for (let i = 1; i < coords.length; i++) if (Math.abs(coords[i].x - px) < Math.abs(coords[best].x - px)) best = i;
    setHover(best);
  }

  const xLabels = points.length === 1 ? [0] : [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const h = hover != null ? coords[hover] : null;

  return (
    <div ref={box} className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${H}`}
        className="h-auto w-full touch-pan-y select-none"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Verloop in ${unit}`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-muted)">
              {t.toLocaleString("nl-NL")}
            </text>
          </g>
        ))}
        {xLabels.map((i) => (
          <text
            key={i}
            x={coords[i].x}
            y={H - 6}
            textAnchor={i === 0 && points.length > 1 ? "start" : i === points.length - 1 && points.length > 1 ? "end" : "middle"}
            fontSize={11}
            fill="var(--color-muted)"
          >
            {shortDate(points[i].date)}
          </text>
        ))}
        {h && <line x1={h.x} x2={h.x} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--color-muted)" strokeWidth={1} strokeDasharray="3 3" />}
        <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((c, i) =>
          showMarkers || hover === i ? (
            <circle
              key={i}
              cx={c.x}
              cy={c.y}
              r={hover === i ? 6 : 4}
              fill="var(--color-accent)"
              stroke="var(--color-surface)"
              strokeWidth={2}
            />
          ) : null,
        )}
      </svg>
      {hover != null && h && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: `${(h.x / width) * 100}%`, top: `${(h.y / H) * 100}%`, marginTop: -10 }}
        >
          <p className="text-muted">{shortDate(points[hover].date)}</p>
          <p className="font-semibold text-ink">
            {points[hover].value.toLocaleString("nl-NL")} {unit}
          </p>
          {points[hover].detail && <p className="text-muted">{points[hover].detail}</p>}
        </div>
      )}
    </div>
  );
}
