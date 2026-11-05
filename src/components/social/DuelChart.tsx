"use client";

import { niceTicks } from "../LineChart";

export type DuelPoint = { date: string; value: number };

const W = 320;
const H = 176;
const PAD = { top: 14, right: 14, bottom: 24, left: 38 };
const DAY = 86_400_000;

function time(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function shortDate(ms: number) {
  return new Date(ms).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

const nl = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

/**
 * Twee lijnen over tijd: jouw beste prestatie per sessie tegen die van een vriend, op dezelfde
 * tijd-as. Statisch (geen hover), zodat het ook op een klein scherm in een paneel goed leesbaar is.
 */
export function DuelChart({
  mine,
  theirs,
  unit,
  rivalName,
  rivalColor,
}: {
  mine: DuelPoint[];
  theirs: DuelPoint[];
  unit: "kg" | "reps";
  rivalName: string;
  rivalColor: string;
}) {
  const all = [...mine, ...theirs];
  if (all.length === 0) return null;

  let x0 = Math.min(...all.map((p) => time(p.date)));
  let x1 = Math.max(...all.map((p) => time(p.date)));
  if (x1 - x0 < DAY) {
    x0 -= 3 * DAY;
    x1 += 3 * DAY;
  }
  const values = all.map((p) => p.value);
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const X = (iso: string) => PAD.left + ((time(iso) - x0) / (x1 - x0)) * (W - PAD.left - PAD.right);
  const Y = (v: number) => PAD.top + (1 - (v - y0) / (y1 - y0 || 1)) * (H - PAD.top - PAD.bottom);
  const path = (pts: DuelPoint[]) => pts.map((p, i) => `${i ? "L" : "M"}${X(p.date).toFixed(1)},${Y(p.value).toFixed(1)}`).join("");

  const fmt = (v: number) => (unit === "kg" ? `${nl(v)} kg` : `${v} reps`);
  const describe = (who: string, pts: DuelPoint[]) =>
    pts.length === 0
      ? `${who}: geen data`
      : pts.length === 1
        ? `${who}: ${fmt(pts[0].value)}`
        : `${who}: van ${fmt(pts[0].value)} naar ${fmt(pts[pts.length - 1].value)}`;
  const label = `Verloop ${unit === "kg" ? "geschatte 1RM" : "max reps"}. ${describe("Jij", mine)}. ${describe(rivalName, theirs)}.`;

  const series = [
    { key: "theirs", pts: theirs, color: rivalColor },
    { key: "mine", pts: mine, color: "var(--color-accent)" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 text-xs text-muted" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent" /> Jij
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: rivalColor }} />
          <span className="truncate">{rivalName}</span>
        </span>
        <span className="ml-auto shrink-0">{unit === "kg" ? "geschatte 1RM (kg)" : "max reps"}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="animate-fade-in block h-auto w-full" role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={Y(t)} y2={Y(t)} stroke="var(--color-line)" strokeWidth={1} strokeDasharray={t === y0 ? undefined : "3 4"} />
            <text x={PAD.left - 6} y={Y(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--color-muted)">
              {nl(t)}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 6} fontSize={10} fill="var(--color-muted)">
          {shortDate(x0)}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize={10} fill="var(--color-muted)">
          {shortDate(x1)}
        </text>
        {series.map(({ key, pts, color }) => (
          <g key={key}>
            {pts.length > 1 && (
              <path d={path(pts)} fill="none" stroke={color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {pts.map((p, i) => {
              const last = i === pts.length - 1;
              return (
                <circle
                  key={`${p.date}-${i}`}
                  cx={X(p.date)}
                  cy={Y(p.value)}
                  r={last ? 4.5 : 2.5}
                  fill={last ? color : "var(--color-surface)"}
                  stroke={color}
                  strokeWidth={last ? 2 : 1.5}
                />
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}
