"use client";

import { useState } from "react";
import { macrosFor, MEALS, type Food, type Meal } from "@/lib/nutrition/types";
import { MACRO_COLORS } from "./MacroSummary";

const nl = (n: number, d = 1) => n.toLocaleString("nl-NL", { maximumFractionDigits: d });

/** Hoeveelheid kiezen (portie × aantal, of grammen), met live voedingswaarden. */
export function PortionPicker({
  food,
  meal,
  initialGrams,
  favorite,
  onToggleFavorite,
  onAdd,
  busy,
}: {
  food: Food;
  meal: Meal;
  initialGrams?: number;
  favorite: boolean;
  onToggleFavorite: () => void;
  onAdd: (grams: number, meal: Meal, portionLabel: string | null) => void;
  busy: boolean;
}) {
  const portions = [...food.portions, { label: "100 g", grams: 100 }];
  const [portionIdx, setPortionIdx] = useState<number | "grams">(initialGrams ? "grams" : 0);
  const [count, setCount] = useState("1");
  const [grams, setGrams] = useState(initialGrams ? String(initialGrams) : String(portions[0].grams));
  const [mealSel, setMealSel] = useState<Meal>(meal);

  const n = Number(count.replace(",", "."));
  const total =
    portionIdx === "grams" ? Number(grams.replace(",", ".")) : Number.isFinite(n) && n > 0 ? portions[portionIdx].grams * n : 0;
  const valid = total > 0 && total <= 10000;
  const m = macrosFor(food.per100, valid ? total : 0);
  const label = portionIdx === "grams" ? null : `${nl(n, 2)} × ${portions[portionIdx].label}`;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight">{food.name}</p>
          {food.brand && <p className="text-sm text-muted">{food.brand}</p>}
          <p className="mt-1 text-xs text-muted">
            Per 100 g: {nl(food.per100.kcal, 0)} kcal · E {nl(food.per100.protein)} · K {nl(food.per100.carbs)} · V {nl(food.per100.fat)}
          </p>
        </div>
        <button
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          aria-label={favorite ? "Uit favorieten" : "Aan favorieten toevoegen"}
          className={`shrink-0 rounded-xl border p-2 transition active:scale-90 ${favorite ? "border-accent text-accent" : "border-line text-muted"}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" />
          </svg>
        </button>
      </div>

      <div className="space-y-2">
        <span className="label">Portie</span>
        <div className="flex flex-wrap gap-1.5">
          {portions.map((p, i) => (
            <button
              key={`${p.label}-${i}`}
              onClick={() => setPortionIdx(i)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                portionIdx === i ? "border-accent bg-accent text-accent-ink" : "border-line text-muted hover:text-ink"
              }`}
            >
              {p.label}{" "}
              {p.label !== "100 g" && !/\d\s*(g|gram|ml|l|kg)\b/i.test(p.label) && <span className="opacity-70">({nl(p.grams)} g)</span>}
            </button>
          ))}
          <button
            onClick={() => setPortionIdx("grams")}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              portionIdx === "grams" ? "border-accent bg-accent text-accent-ink" : "border-line text-muted hover:text-ink"
            }`}
          >
            Grammen
          </button>
        </div>
        {portionIdx === "grams" ? (
          <div className="flex items-center gap-2">
            <input className="input text-lg font-bold tabular-nums" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} aria-label="Grammen" />
            <span className="text-muted">g</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button className="btn-ghost h-11 w-11 p-0 text-lg" onClick={() => setCount(String(Math.max(0.5, (n || 1) - 0.5)))} aria-label="Minder">
              −
            </button>
            <input className="input text-center text-lg font-bold tabular-nums" inputMode="decimal" value={count} onChange={(e) => setCount(e.target.value)} aria-label="Aantal" />
            <button className="btn-ghost h-11 w-11 p-0 text-lg" onClick={() => setCount(String((n || 0) + 0.5))} aria-label="Meer">
              +
            </button>
            <span className="w-20 shrink-0 text-right text-sm text-muted tabular-nums">{valid ? `${nl(total)} g` : ""}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 rounded-2xl bg-surface-2 p-3 text-center">
        <Stat label="kcal" value={nl(m.kcal, 0)} />
        <Stat label="eiwit" value={`${nl(m.protein)} g`} color={MACRO_COLORS.protein} />
        <Stat label="koolh." value={`${nl(m.carbs)} g`} color={MACRO_COLORS.carbs} />
        <Stat label="vet" value={`${nl(m.fat)} g`} color={MACRO_COLORS.fat} />
      </div>

      <div className="space-y-2">
        <span className="label">Maaltijd</span>
        <div className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-surface-2 p-1">
          {MEALS.map((x) => (
            <button
              key={x.id}
              onClick={() => setMealSel(x.id)}
              className={`rounded-lg py-1.5 text-xs font-semibold transition ${mealSel === x.id ? "bg-accent text-accent-ink" : "text-muted"}`}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <button className="btn-primary w-full py-3" disabled={!valid || busy} onClick={() => onAdd(Math.round(total * 10) / 10, mealSel, label)}>
        {busy ? "Toevoegen…" : `Toevoegen · ${nl(m.kcal, 0)} kcal`}
      </button>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-sm font-bold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}
