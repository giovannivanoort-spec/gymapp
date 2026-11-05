"use client";

import { fmt } from "@/lib/nutrition/format";
import type { Targets } from "@/lib/nutrition/targets";
import type { Macros } from "@/lib/nutrition/types";

export const MACRO_COLORS = { protein: "#7cc4ff", carbs: "#ffc857", fat: "#ff8fa3" } as const;

/** Boven dit deel van het doel geldt een macro als "te veel" (kleine marge voor afronding). */
const OVER = 1.05;

/**
 * Calorieën als grote ring, macro's als balken. Zonder doel: alleen de totalen.
 * Optioneel vezels (alleen als de gelogde producten vezels kennen), met 14 g per 1000 kcal als richtlijn.
 *
 * - `mode="planned"`: een dag in de toekomst; er is nog niets gegeten, dus de tekst spreekt van "gepland".
 * - `plannedKcal`: gepland maar nog niet bevestigd eten op een dag die al bezig is. Verschijnt als
 *   lichtere "schaduw" op de ring, zodat je ziet of de rest van je planning nog binnen je doel past.
 */
export function MacroSummary({
  totals,
  targets,
  fiber,
  mode = "eaten",
  plannedKcal = 0,
}: {
  totals: Macros;
  targets: Targets | null;
  fiber?: number | null;
  mode?: "eaten" | "planned";
  plannedKcal?: number;
}) {
  const verb = mode === "planned" ? "gepland" : "gegeten";
  const kcalLeft = targets ? targets.kcal - totals.kcal : null;
  const pct = targets ? Math.min(1, totals.kcal / targets.kcal) : 0;
  const ghost = targets && plannedKcal > 0 ? Math.max(0, Math.min(1, (totals.kcal + plannedKcal) / targets.kcal) - pct) : 0;
  const ghostOver = targets ? totals.kcal + plannedKcal > targets.kcal * OVER : false;
  const over = targets ? totals.kcal > targets.kcal : false;
  const R = 52;
  const C = 2 * Math.PI * R;
  const leftWord = mode === "planned" ? "ruimte" : "over";
  const ringLabel = targets
    ? `${fmt(totals.kcal)} van ${fmt(targets.kcal)} kcal ${verb}, ${kcalLeft! >= 0 ? `${fmt(kcalLeft!)} ${leftWord}` : `${fmt(-kcalLeft!)} te veel`}${
        plannedKcal > 0 ? `, nog ${fmt(plannedKcal)} kcal gepland` : ""
      }`
    : `${fmt(totals.kcal)} kcal ${verb}`;
  const fiberTarget = targets ? Math.round((targets.kcal / 1000) * 14) : null;

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-32 w-32 shrink-0" role="img" aria-label={ringLabel}>
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r={R} fill="none" stroke="var(--color-surface-2)" strokeWidth="10" />
          {targets && ghost > 0 && (
            <circle
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={ghostOver ? "var(--color-warn)" : "var(--color-accent)"}
              strokeOpacity={0.3}
              strokeWidth="10"
              strokeDasharray={`${C * ghost} ${C}`}
              strokeDashoffset={-C * pct}
              className="transition-[stroke-dasharray,stroke-dashoffset] duration-700 ease-out"
            />
          )}
          {targets && (
            <circle
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={over ? "var(--color-warn)" : "var(--color-accent)"}
              strokeOpacity={mode === "planned" ? 0.75 : 1}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - pct)}
              className="transition-[stroke-dashoffset,stroke] duration-700 ease-out"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center" aria-hidden>
          <span className={`text-2xl font-extrabold tabular-nums leading-none ${over ? "text-warn" : ""}`}>
            {kcalLeft != null ? fmt(Math.abs(kcalLeft)) : fmt(totals.kcal)}
          </span>
          <span className="mt-1 text-[11px] text-muted">{kcalLeft == null ? `kcal ${verb}` : kcalLeft >= 0 ? `kcal ${leftWord}` : "kcal te veel"}</span>
          {plannedKcal > 0 && (
            <span className={`mt-0.5 text-[10px] font-semibold tabular-nums ${ghostOver ? "text-warn" : "text-accent"}`}>+{fmt(plannedKcal)} gepland</span>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="text-xs text-muted">
          <span className="font-semibold text-ink tabular-nums">{fmt(totals.kcal)}</span>
          {targets && <span className="tabular-nums"> / {fmt(targets.kcal)}</span>} kcal {verb}
        </p>
        <MacroBar label="Eiwit" value={totals.protein} target={targets?.protein} color={MACRO_COLORS.protein} />
        <MacroBar label="Koolhydraten" value={totals.carbs} target={targets?.carbs} color={MACRO_COLORS.carbs} />
        <MacroBar label="Vet" value={totals.fat} target={targets?.fat} color={MACRO_COLORS.fat} />
        {fiber != null && fiber > 0 && (
          <p className="text-[11px] text-muted tabular-nums">
            Vezels <span className="font-semibold text-ink">{fmt(fiber)} g</span>
            {fiberTarget != null && <> / ±{fmt(fiberTarget)} g</>}
          </p>
        )}
      </div>
    </div>
  );
}

/** Kleine waarde met label (kcal, eiwit, koolhydraten, vet) in portie- en bewerkschermen. */
export function MacroStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-sm font-bold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

function MacroBar({ label, value, target, color }: { label: string; value: number; target?: number; color: string }) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  const over = target != null && target > 0 && value > target * OVER;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">
          <span className={`font-semibold ${over ? "text-warn" : ""}`}>{fmt(value)}</span>
          {target != null ? <span className="text-muted"> / {fmt(target)} g</span> : <span className="text-muted"> g</span>}
          {over && <span className="ml-1 text-[10px] font-semibold text-warn">+{fmt(value - target!)}</span>}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-2"
        role={target ? "progressbar" : undefined}
        aria-label={target ? `${label}: ${fmt(value)} van ${fmt(target)} gram` : undefined}
        aria-valuenow={target ? Math.round(value) : undefined}
        aria-valuemin={target ? 0 : undefined}
        aria-valuemax={target ? Math.round(target) : undefined}
      >
        <div
          className="h-full rounded-full transition-[width,background-color] duration-700 ease-out"
          style={{ width: `${pct}%`, background: over ? "var(--color-warn)" : color }}
        />
      </div>
    </div>
  );
}
