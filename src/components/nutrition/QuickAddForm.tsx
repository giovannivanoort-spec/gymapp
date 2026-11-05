"use client";

import { useState } from "react";
import { fmt, parseAmount } from "@/lib/nutrition/format";
import type { Macros } from "@/lib/nutrition/types";
import { MACRO_COLORS } from "./MacroSummary";

type Fields = { name: string; kcal: string; protein: string; carbs: string; fat: string };

const MACRO_FIELDS = [
  { k: "protein", label: "Eiwit", color: MACRO_COLORS.protein },
  { k: "carbs", label: "Koolh.", color: MACRO_COLORS.carbs },
  { k: "fat", label: "Vet", color: MACRO_COLORS.fat },
] as const;

const str = (n: number | undefined) => (n ? String(n).replace(".", ",") : "");

/**
 * Snelle invoer: alleen calorieën en (optioneel) macro's, bijv. voor een restaurantmaaltijd.
 * Zonder kcal rekent het formulier ze uit de macro's (4 / 4 / 9 kcal per gram).
 */
export function QuickAddForm({
  initial,
  submitLabel = "Toevoegen",
  busy,
  onSubmit,
}: {
  initial?: { name: string } & Macros;
  submitLabel?: string;
  busy: boolean;
  onSubmit: (name: string, macros: Macros) => void;
}) {
  const [f, setF] = useState<Fields>({
    name: initial?.name ?? "",
    kcal: initial ? String(Math.round(initial.kcal)) : "",
    protein: str(initial?.protein),
    carbs: str(initial?.carbs),
    fat: str(initial?.fat),
  });
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const macro = (k: "protein" | "carbs" | "fat") => {
    const n = parseAmount(f[k]);
    return Number.isFinite(n) ? n : 0;
  };
  const p = macro("protein");
  const c = macro("carbs");
  const v = macro("fat");
  const fromMacros = Math.round(p * 4 + c * 4 + v * 9);
  const typedKcal = parseAmount(f.kcal);
  const kcal = Number.isFinite(typedKcal) ? typedKcal : fromMacros;

  const macroError = MACRO_FIELDS.some(({ k }) => f[k].trim() && (!Number.isFinite(parseAmount(f[k])) || parseAmount(f[k]) < 0 || parseAmount(f[k]) > 500));
  const kcalError = f.kcal.trim() !== "" && (!Number.isFinite(typedKcal) || typedKcal < 0 || typedKcal > 5000);
  const valid = kcal > 0 && kcal <= 5000 && !macroError && !kcalError;
  // Grote afwijking tussen kcal en macro's: waarschijnlijk een typfout.
  const mismatch = Number.isFinite(typedKcal) && fromMacros > 0 && Math.abs(fromMacros - typedKcal) > Math.max(60, typedKcal * 0.25);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    onSubmit(f.name, { kcal: Math.round(kcal), protein: Math.round(p * 10) / 10, carbs: Math.round(c * 10) / 10, fat: Math.round(v * 10) / 10 });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="qa-name">
          Omschrijving (optioneel)
        </label>
        <input id="qa-name" className="input" value={f.name} onChange={set("name")} placeholder="bijv. Pasta bij het Italiaanse restaurant" maxLength={80} />
      </div>
      <div>
        <label className="label" htmlFor="qa-kcal">
          Calorieën
        </label>
        <div className="flex items-center gap-2">
          <input
            id="qa-kcal"
            className={`input text-lg font-bold tabular-nums ${kcalError ? "border-danger focus:border-danger" : ""}`}
            inputMode="decimal"
            value={f.kcal}
            onChange={set("kcal")}
            placeholder={fromMacros > 0 ? fmt(fromMacros) : "bijv. 650"}
            aria-invalid={kcalError}
            autoFocus={!initial}
          />
          <span className="text-muted">kcal</span>
        </div>
        {kcalError && <p className="mt-1 text-xs text-danger">Vul een aantal tussen 1 en 5.000 kcal in.</p>}
        {!f.kcal.trim() && fromMacros > 0 && <p className="mt-1 text-xs text-muted">Berekend uit de macro&apos;s: {fmt(fromMacros)} kcal</p>}
      </div>
      <div>
        <span className="label">Macro&apos;s in gram (optioneel)</span>
        <div className="grid grid-cols-3 gap-2">
          {MACRO_FIELDS.map(({ k, label, color }) => (
            <div key={k}>
              <input className="input px-2 text-center tabular-nums" inputMode="decimal" value={f[k]} onChange={set(k)} placeholder="0" aria-label={`${label} in gram`} />
              <p className="mt-1 text-center text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>
                {label}
              </p>
            </div>
          ))}
        </div>
        {macroError && <p className="mt-1 text-xs text-danger">Macro&apos;s moeten tussen 0 en 500 g liggen.</p>}
        {mismatch && !macroError && (
          <p className="mt-1 text-xs text-warn">
            Let op: de macro&apos;s komen uit op ±{fmt(fromMacros)} kcal, je vulde {fmt(typedKcal)} kcal in.
          </p>
        )}
      </div>
      <button className="btn-primary w-full py-3" disabled={!valid || busy}>
        {busy ? "Bezig…" : valid ? `${submitLabel} · ${fmt(kcal)} kcal` : submitLabel}
      </button>
    </form>
  );
}
