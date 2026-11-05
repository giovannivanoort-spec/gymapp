"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ChartPoint = {
  date: string;
  value: number;
  detail?: string;
  /** Persoonlijk record: groter punt met een ring. */
  pr?: boolean;
};

const H = 200;
// Extra ruimte boven en onder voor de markers (r = 6 bij hover), zodat niets wordt afgesneden.
const PAD = { top: 18, right: 14, bottom: 26, left: 40 };

export const RANGES = [
  { id: "1m", label: "1M", days: 31, long: "laatste maand" },
  { id: "3m", label: "3M", days: 92, long: "laatste 3 maanden" },
  { id: "1y", label: "1J", days: 366, long: "laatste jaar" },
  { id: "all", label: "Alles", days: Infinity, long: "sinds start" },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

/** Periodekeuze heeft pas zin als de data langer dan ruim een maand beslaat. */
export function rangesAvailable(points: { date: string }[]): boolean {
  if (points.length < 2) return false;
  return (parse(points.at(-1)!.date).getTime() - parse(points[0].date).getTime()) / 86_400_000 > 35;
}

/** Punten binnen de gekozen periode (tot en met vandaag). */
export function filterRange<T extends { date: string }>(points: T[], range: RangeId, now: Date = new Date()): T[] {
  const days = RANGES.find((r) => r.id === range)!.days;
  if (!Number.isFinite(days)) return points;
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days).getTime();
  return points.filter((p) => parse(p.date).getTime() >= cutoff);
}

/** Afronden naar "mooie" tick-waarden (1, 2, 2,5, 5 × 10^n); de bovenste tick ligt altijd op of boven max. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step * 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  if (ticks.length < 2) ticks.push(Math.round((start + step) * 100) / 100);
  return ticks;
}

function parse(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function shortDate(iso: string) {
  return parse(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

const nl = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

/** Horizontale zone achter de lijn, bijv. een tier tussen twee scores. */
export type ChartBand = { from: number; to: number; label: string; color: string };

/**
 * Eén lijn over tijd met tooltip. Muis: volgt de cursor. Aanraken: een tik zet de tooltip vast
 * (blijft staan na loslaten), nog een tik op hetzelfde punt of ergens buiten de grafiek sluit hem.
 * Toetsenbord: pijltjes links/rechts lopen langs de punten. Tijd-as op echte datum-afstand.
 * Optioneel: een trendlijn (bijv. 7-daags gemiddelde), periodekeuze (1M / 3M / 1J / Alles) en
 * gekleurde zones (bijv. tiers).
 */
export function LineChart({
  points,
  unit,
  trend,
  trendLabel = "Gemiddelde",
  ranges = false,
  label,
  range: rangeProp,
  onRange,
  bands,
  formatValue,
}: {
  points: ChartPoint[];
  unit: string;
  /** Tweede, rustige lijn (zelfde eenheid), bijv. een voortschrijdend gemiddelde. */
  trend?: ChartPoint[];
  trendLabel?: string;
  /** Toon knoppen om de periode te kiezen (alleen als de data langer dan een maand beslaat). */
  ranges?: boolean;
  /** Naam van de reeks voor schermlezers, bijv. "Geschatte 1RM bench press". */
  label?: string;
  /** Gekozen periode van buitenaf (gecontroleerd), bijv. om kopcijfers mee te laten bewegen. */
  range?: RangeId;
  onRange?: (range: RangeId) => void;
  /** Gekleurde zones achter de lijn; de y-as toont dan de zone-namen in plaats van getallen. */
  bands?: ChartBand[];
  /** Eigen weergave van een waarde (tooltip en schermlezer), in plaats van "getal eenheid". */
  formatValue?: (value: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  /** De tooltip staat vast na een tik (aanraken/pen); sluit pas bij een volgende tik. */
  const [pinned, setPinned] = useState(false);
  /** Laatst aangekondigde waarde voor schermlezers (alleen bij bediening met het toetsenbord). */
  const [announce, setAnnounce] = useState("");
  const [ownRange, setOwnRange] = useState<RangeId>("all");
  const range = rangeProp ?? ownRange;
  const setRange = (r: RangeId) => {
    setOwnRange(r);
    onRange?.(r);
  };
  const ref = useRef<SVGSVGElement>(null);

  // Vastgezette tooltip sluiten bij een tik buiten de grafiek.
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      setHover(null);
      setPinned(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pinned]);
  // Tekenen op de echte breedte, zodat tekst niet mee verkleint op een telefoon. Tot de breedte
  // bekend is tonen we een lege ruimte van dezelfde hoogte (geen zichtbare herschikking).
  const [width, setWidth] = useState<number | null>(null);
  const box = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const showRanges = ranges && rangesAvailable(points);
  const activeRange = showRanges ? range : "all";

  const { shown, shownTrend } = useMemo(
    () => ({ shown: filterRange(points, activeRange), shownTrend: filterRange(trend ?? [], activeRange) }),
    [points, trend, activeRange],
  );

  if (points.length === 0) return null;

  const chips = showRanges && (
    <div className="flex justify-end">
      <div className="flex rounded-xl border border-line bg-surface-2 p-0.5 text-xs font-semibold" role="group" aria-label="Periode">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => {
              setRange(r.id);
              setHover(null);
              setPinned(false);
            }}
            aria-pressed={activeRange === r.id}
            className={`min-w-10 rounded-[10px] px-2 py-1.5 transition ${
              activeRange === r.id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (shown.length === 0) {
    return (
      <div className="space-y-3">
        {chips}
        <p className="flex h-[200px] items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted">
          Geen metingen in deze periode.
        </p>
      </div>
    );
  }

  const first = shown[0];
  const last = shown.at(-1)!;
  const fmt = (v: number) => (formatValue ? formatValue(v) : `${nl(v)} ${unit}`.trim());
  const summary = `${label ?? `Verloop in ${unit}`}: van ${fmt(first.value)} naar ${fmt(last.value)} tussen ${shortDate(first.date)} en ${shortDate(last.date)}, ${shown.length} ${shown.length === 1 ? "meting" : "metingen"}.`;

  if (width == null) {
    return (
      <div className="space-y-3">
        {chips}
        <div ref={box} className="h-[200px]" role="img" aria-label={summary} />
      </div>
    );
  }

  const times = shown.map((p) => parse(p.date).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  // Alleen trendpunten die ook getekend worden, anders rekt de as op voor waarden buiten beeld.
  const trendDrawn = shownTrend.map((p) => ({ t: parse(p.date).getTime(), value: p.value })).filter((p) => p.t >= t0 && p.t <= t1);
  const values = [...shown.map((p) => p.value), ...trendDrawn.map((p) => p.value)];
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  // Met zones: de as loopt over hele zones (bijv. van de ene tier-grens naar de volgende).
  const ticks = bands?.length
    ? Array.from({ length: Math.max(2, Math.ceil(vMax + 1e-9) - Math.floor(vMin) + 1) }, (_, i) => Math.floor(vMin) + i)
    : niceTicks(vMin, vMax);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const left = bands?.length ? 12 : PAD.left;

  const innerW = width - left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (t: number) => left + (t1 === t0 ? innerW / 2 : ((t - t0) / (t1 - t0)) * innerW);
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;
  const coords = shown.map((p, i) => ({ x: x(times[i]), y: y(p.value) }));
  const toPath = (cs: { x: number; y: number }[]) => cs.map((c, i) => `${i ? "L" : "M"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const path = toPath(coords);
  const trendPath = trendDrawn.length > 1 ? toPath(trendDrawn.map((p) => ({ x: x(p.t), y: y(p.value) }))) : null;
  const showMarkers = shown.length <= 40;
  const hasTrend = !!trendPath;

  function nearest(e: React.PointerEvent<SVGSVGElement>): number | null {
    const svg = ref.current;
    if (!svg || width == null) return null;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    let best = 0;
    for (let i = 1; i < coords.length; i++) if (Math.abs(coords[i].x - px) < Math.abs(coords[best].x - px)) best = i;
    return best;
  }
  const isMouse = (e: React.PointerEvent) => e.pointerType === "mouse";

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const i = nearest(e);
    if (i == null) return;
    if (isMouse(e)) return setHover(i);
    // Aanraken: een tik zet vast, nog een tik op hetzelfde punt sluit.
    if (pinned && hover === i) {
      setHover(null);
      setPinned(false);
    } else {
      setHover(i);
      setPinned(true);
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    // Muis: volgen. Aanraken: alleen slepen terwijl de vinger op het scherm staat.
    if (!isMouse(e) && (!pinned || e.buttons === 0)) return;
    const i = nearest(e);
    if (i != null) setHover(i);
  }

  // Datumlabels op tijd (niet op index), zodat ze bij geclusterde data niet over elkaar vallen.
  const xLabels: { x: number; text: string; anchor: "start" | "middle" | "end" }[] =
    t1 === t0
      ? [{ x: x(t0), text: shortDate(first.date), anchor: "middle" }]
      : [
          { x: x(t0), text: shortDate(first.date), anchor: "start" },
          { x: x(t1), text: shortDate(last.date), anchor: "end" },
        ];
  if (t1 > t0 && innerW >= 220) {
    const mid = new Date(t0 + (t1 - t0) / 2);
    const midIso = `${mid.getFullYear()}-${mid.getMonth() + 1}-${mid.getDate()}`;
    const text = shortDate(midIso);
    if (text !== xLabels[0].text && text !== xLabels[1].text) xLabels.splice(1, 0, { x: x(mid.getTime()), text, anchor: "middle" });
  }
  const hi = hover != null && hover < shown.length ? hover : null;
  const h = hi != null ? coords[hi] : null;

  function onKeyDown(e: React.KeyboardEvent<SVGSVGElement>) {
    const lastIndex = shown.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = hi == null ? lastIndex : Math.min(lastIndex, hi + 1);
    else if (e.key === "ArrowLeft") next = hi == null ? lastIndex : Math.max(0, hi - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = lastIndex;
    else if (e.key === "Escape" && hi != null) {
      e.preventDefault();
      setHover(null);
      setPinned(false);
      return;
    }
    if (next == null) return;
    e.preventDefault();
    setHover(next);
    setPinned(true);
    const p = shown[next];
    setAnnounce(`${shortDate(p.date)}: ${fmt(p.value)}${p.pr ? ", record" : ""}${p.detail ? `, ${p.detail}` : ""}`);
  }
  // Tooltip binnen de kaart houden en onder het punt tonen als er boven geen ruimte is.
  const TIP_HALF = 64;
  const tipLeft = h ? Math.min(Math.max(h.x, TIP_HALF), width - TIP_HALF) : 0;
  const tipBelow = h ? h.y < 64 : false;

  return (
    <div className="space-y-3">
      {chips}
      <div ref={box} className="relative">
        <svg
          ref={ref}
          viewBox={`0 0 ${width} ${H}`}
          className="h-auto w-full touch-pan-y select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerLeave={(e) => {
            // Bij aanraken volgt pointerleave direct op het loslaten: dan blijft de tooltip staan.
            if (isMouse(e)) setHover(null);
          }}
          onPointerCancel={() => {
            // De browser neemt het gebaar over (scrollen): geen tooltip laten hangen.
            setHover(null);
            setPinned(false);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (!pinned) return;
            setHover(null);
            setPinned(false);
          }}
          tabIndex={0}
          role="img"
          aria-label={`${summary} Pijltjestoetsen lopen langs de metingen.`}
        >
          {bands?.map((b) => {
            const lo = Math.max(b.from, yMin);
            const top = Math.min(b.to, yMax);
            if (top <= lo) return null;
            return (
              <g key={b.label}>
                <rect x={left} width={innerW} y={y(top)} height={y(lo) - y(top)} fill={b.color} fillOpacity={0.1} />
                <text x={width - PAD.right - 4} y={y(top) + 12} textAnchor="end" fontSize={10} fontWeight={600} fill={b.color}>
                  {b.label}
                </text>
              </g>
            );
          })}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
              {!bands?.length && (
                <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-muted)">
                  {t.toLocaleString("nl-NL")}
                </text>
              )}
            </g>
          ))}
          {xLabels.map((l) => (
            <text key={`${l.anchor}:${l.text}`} x={l.x} y={H - 6} textAnchor={l.anchor} fontSize={11} fill="var(--color-muted)">
              {l.text}
            </text>
          ))}
          {h && (
            <line x1={h.x} x2={h.x} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--color-muted)" strokeWidth={1} strokeDasharray="3 3" />
          )}
          <path
            d={path}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={2}
            strokeOpacity={hasTrend ? 0.45 : 1}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {trendPath && (
            <path d={trendPath} fill="none" stroke="var(--color-ink)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {coords.map((c, i) => {
            const pr = shown[i].pr;
            if (!(showMarkers || pr || hi === i)) return null;
            return (
              <g key={i}>
                {pr && (
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={hi === i ? 9 : 7.5}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeOpacity={0.5}
                    strokeWidth={1.5}
                  />
                )}
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={hi === i ? 6 : pr ? 4.5 : hasTrend ? 3 : 4}
                  fill="var(--color-accent)"
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                />
              </g>
            );
          })}
        </svg>
        {hi != null && h && (
          <div
            className={`pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs shadow-lg ${
              tipBelow ? "" : "-translate-y-full"
            }`}
            style={{ left: `${(tipLeft / width) * 100}%`, top: `${(h.y / H) * 100}%`, marginTop: tipBelow ? 12 : -12 }}
          >
            <p className="flex items-center gap-1.5 text-muted">
              {shortDate(shown[hi].date)}
              {shown[hi].pr && <span className="rounded bg-accent/15 px-1 text-[10px] font-bold text-accent">PR</span>}
            </p>
            <p className="font-semibold text-ink">{fmt(shown[hi].value)}</p>
            {shown[hi].detail && <p className="text-muted">{shown[hi].detail}</p>}
          </div>
        )}
        <span className="sr-only" aria-live="polite">
          {announce}
        </span>
      </div>
      {hasTrend && (
        <div className="flex justify-center gap-4 text-xs text-muted" aria-hidden>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-accent/60" /> Meting
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-ink" /> {trendLabel}
          </span>
        </div>
      )}
    </div>
  );
}
