"use client";

import type { Targets } from "@/lib/nutrition/targets";
import type { Macros } from "@/lib/nutrition/types";

export const MACRO_COLORS = { protein: "#7cc4ff", carbs: "#ffc857", fat: "#ff8fa3" } as const;

const nl = (n: number) => Math.round(n).toLocaleString("nl-NL");

/** Calorieën als grote ring, macro's als balken. Zonder doel: alleen de totalen. */
export function MacroSummary({ totals, targets }: { totals: Macros; targets: Targets | null }) {
  const kcalLeft = targets ? targets.kcal - totals.kcal : null;
  const pct = targets ? Math.min(1, totals.kcal / targets.kcal) : 0;
  const over = targets ? totals.kcal > targets.kcal : false;
  const R = 52;
  const C = 2 * Math.PI * R;

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle cx="60" cy="60" r={R} fill="none" stroke="var(--color-surface-2)" strokeWidth="10" />
          {targets && (
            <circle
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={over ? "var(--color-warn)" : "var(--color-accent)"}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - pct)}
              className="transition-[stroke-dashoffset] duration-700 ease-out"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-extrabold tabular-nums leading-none">{kcalLeft != null ? nl(Math.abs(kcalLeft)) : nl(totals.kcal)}</span>
          <span className="mt-1 text-[11px] text-muted">{kcalLeft == null ? "kcal" : kcalLeft >= 0 ? "kcal over" : "kcal te veel"}</span>
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="text-xs text-muted">
          <span className="font-semibold text-ink tabular-nums">{nl(totals.kcal)}</span>
          {targets && <span className="tabular-nums"> / {nl(targets.kcal)}</span>} kcal gegeten
        </p>
        <MacroBar label="Eiwit" value={totals.protein} target={targets?.protein} color={MACRO_COLORS.protein} />
        <MacroBar label="Koolhydraten" value={totals.carbs} target={targets?.carbs} color={MACRO_COLORS.carbs} />
        <MacroBar label="Vet" value={totals.fat} target={targets?.fat} color={MACRO_COLORS.fat} />
      </div>
    </div>
  );
}

function MacroBar({ label, value, target, color }: { label: string; value: number; target?: number; color: string }) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">
          <span className="font-semibold">{nl(value)}</span>
          {target != null && <span className="text-muted"> / {nl(target)} g</span>}
          {target == null && <span className="text-muted"> g</span>}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
