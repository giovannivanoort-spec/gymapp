"use client";

import { useState } from "react";
import { CalendarIcon } from "@/components/Icons";
import { relativeDay, toISODate } from "@/lib/dates";
import { fmt, parseAmount } from "@/lib/nutrition/format";
import { macrosFor, MEALS, type Food, type Meal } from "@/lib/nutrition/types";
import { MACRO_COLORS, MacroStat as Stat } from "./MacroSummary";

const nl = (n: number, d = 1) => fmt(n, d);

/** Hoeveelheid kiezen (portie × aantal, of grammen), met live voedingswaarden. */
export function PortionPicker({
  food,
  meal,
  initialGrams,
  favorite,
  onToggleFavorite,
  onAdd,
  busy,
  date,
  onEdit,
}: {
  food: Food;
  meal: Meal;
  initialGrams?: number;
  favorite: boolean;
  onToggleFavorite: () => void;
  onAdd: (grams: number, meal: Meal, portionLabel: string | null) => void;
  busy: boolean;
  /** Dag waarvoor gelogd wordt; in de toekomst wordt het een planning. */
  date?: string;
  /** Eigen product aanpassen of verwijderen (alleen getoond voor eigen producten). */
  onEdit?: () => void;
}) {
  const portions = [...food.portions, { label: "100 g", grams: 100 }];
  const [portionIdx, setPortionIdx] = useState<number | "grams">(initialGrams ? "grams" : 0);
  const [count, setCount] = useState("1");
  const [grams, setGrams] = useState(initialGrams ? String(initialGrams) : String(portions[0].grams));
  const [mealSel, setMealSel] = useState<Meal>(meal);

  const n = parseAmount(count);
  const g = parseAmount(grams);
  const total =
    portionIdx === "grams" ? (Number.isFinite(g) ? g : 0) : Number.isFinite(n) && n > 0 ? portions[portionIdx].grams * n : 0;
  const valid = total > 0 && total <= 10000;
  const m = macrosFor(food.per100, valid ? total : 0);
  const label = portionIdx === "grams" ? null : `${nl(n, 2)} × ${portions[portionIdx].label}`;
  const planned = date != null && date > toISODate();
  const fiber = food.per100.fiber != null && valid ? (Number(food.per100.fiber) * total) / 100 : null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight">{food.name}</p>
          {food.brand && <p className="text-sm text-muted">{food.brand}</p>}
          {onEdit && food.source === "custom" && !food.id.startsWith("quick:") && (
            <button onClick={onEdit} className="-ml-2 inline-flex min-h-11 items-center rounded-xl px-2 text-xs font-semibold text-accent transition hover:bg-surface-2">
              Eigen product bewerken
            </button>
          )}
          <p className="mt-1 text-xs text-muted">
            Per 100 g: {nl(food.per100.kcal, 0)} kcal · E {nl(food.per100.protein)} · K {nl(food.per100.carbs)} · V {nl(food.per100.fat)}
          </p>
          {planned && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent">
              <CalendarIcon size={12} /> Gepland voor {relativeDay(date!).toLowerCase()}
            </p>
          )}
        </div>
        <button
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          aria-label={favorite ? "Uit favorieten" : "Aan favorieten toevoegen"}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition active:scale-90 ${favorite ? "border-accent text-accent" : "border-line text-muted"}`}
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
              className={`min-h-11 rounded-full border px-3.5 text-xs font-medium transition active:scale-95 ${
                portionIdx === i ? "border-accent bg-accent text-accent-ink" : "border-line text-muted hover:text-ink"
              }`}
            >
              {p.label}{" "}
              {p.label !== "100 g" && !/\d\s*(g|gram|ml|l|kg)\b/i.test(p.label) && <span className="opacity-70">({nl(p.grams)} g)</span>}
            </button>
          ))}
          <button
            onClick={() => setPortionIdx("grams")}
            className={`min-h-11 rounded-full border px-3.5 text-xs font-medium transition active:scale-95 ${
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

      <div className="rounded-2xl bg-surface-2 p-3">
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label="kcal" value={nl(m.kcal, 0)} />
          <Stat label="eiwit" value={`${nl(m.protein)} g`} color={MACRO_COLORS.protein} />
          <Stat label="koolh." value={`${nl(m.carbs)} g`} color={MACRO_COLORS.carbs} />
          <Stat label="vet" value={`${nl(m.fat)} g`} color={MACRO_COLORS.fat} />
        </div>
        {fiber != null && fiber > 0 && (
          <p className="mt-2 border-t border-line pt-2 text-center text-[11px] text-muted tabular-nums">
            waarvan vezels {nl(fiber)} g
            {food.per100.sugar != null && valid && <> · suikers {nl((Number(food.per100.sugar) * total) / 100)} g</>}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <span className="label">Maaltijd</span>
        <div className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-surface-2 p-1" role="radiogroup" aria-label="Maaltijd">
          {MEALS.map((x) => (
            <button
              key={x.id}
              role="radio"
              aria-checked={mealSel === x.id}
              onClick={() => setMealSel(x.id)}
              className={`min-h-11 rounded-lg text-xs font-semibold transition ${mealSel === x.id ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <button className="btn-primary w-full py-3" disabled={!valid || busy} onClick={() => onAdd(Math.round(total * 10) / 10, mealSel, label)}>
        {busy ? "Toevoegen…" : `${planned ? "Plannen" : "Toevoegen"} · ${nl(m.kcal, 0)} kcal`}
      </button>
    </div>
  );
}
