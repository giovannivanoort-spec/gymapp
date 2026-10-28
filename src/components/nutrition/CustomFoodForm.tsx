"use client";

import { useState } from "react";
import { saveCustomFood } from "@/lib/nutrition/log";
import type { Food } from "@/lib/nutrition/types";
import { errorMessage } from "@/lib/supabase";

const toNum = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(",", ".")));

/** Eigen product aanmaken met waarden van het etiket (per 100 g). */
export function CustomFoodForm({ barcode, onSaved }: { barcode?: string; onSaved: (food: Food) => void }) {
  const [f, setF] = useState({ name: "", brand: "", kcal: "", protein: "", carbs: "", fat: "", portionLabel: "", portionGrams: "", barcode: barcode ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const per100 = { kcal: toNum(f.kcal), protein: toNum(f.protein), carbs: toNum(f.carbs), fat: toNum(f.fat) };
  const valid =
    f.name.trim() &&
    Object.values(per100).every((v) => Number.isFinite(v) && v >= 0) &&
    per100.kcal <= 950 &&
    per100.protein + per100.carbs + per100.fat <= 101;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const grams = toNum(f.portionGrams);
      const food = await saveCustomFood({
        name: f.name.trim(),
        brand: f.brand.trim(),
        barcode: f.barcode.trim(),
        per100: { kcal: Math.round(per100.kcal), protein: per100.protein, carbs: per100.carbs, fat: per100.fat },
        portions: f.portionLabel.trim() && grams > 0 ? [{ label: f.portionLabel.trim(), grams }] : [],
      });
      onSaved(food);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {barcode && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">Barcode {barcode} staat nog niet in de database. Vul de waarden van het etiket in, dan herkent de app hem voortaan.</p>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label" htmlFor="cf-name">Naam</label>
          <input id="cf-name" className="input" value={f.name} onChange={set("name")} placeholder="bijv. Proteïne pudding vanille" required />
        </div>
        <div>
          <label className="label" htmlFor="cf-brand">Merk (optioneel)</label>
          <input id="cf-brand" className="input" value={f.brand} onChange={set("brand")} />
        </div>
        <div>
          <label className="label" htmlFor="cf-barcode">Barcode (optioneel)</label>
          <input id="cf-barcode" className="input" inputMode="numeric" value={f.barcode} onChange={set("barcode")} />
        </div>
      </div>
      <div>
        <span className="label">Per 100 g (van het etiket)</span>
        <div className="grid grid-cols-4 gap-2">
          {(
            [
              ["kcal", "kcal"],
              ["protein", "Eiwit"],
              ["carbs", "Koolh."],
              ["fat", "Vet"],
            ] as const
          ).map(([k, label]) => (
            <div key={k}>
              <input className="input px-2 text-center tabular-nums" inputMode="decimal" value={f[k]} onChange={set(k)} aria-label={label} required />
              <p className="mt-1 text-center text-[10px] uppercase tracking-wide text-muted">{label}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <div>
          <label className="label" htmlFor="cf-portion">Portie (optioneel)</label>
          <input id="cf-portion" className="input" value={f.portionLabel} onChange={set("portionLabel")} placeholder="bijv. 1 beker" />
        </div>
        <div>
          <label className="label" htmlFor="cf-pg">Gram</label>
          <input id="cf-pg" className="input text-center" inputMode="decimal" value={f.portionGrams} onChange={set("portionGrams")} />
        </div>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full py-3" disabled={!valid || busy}>
        {busy ? "Opslaan…" : "Opslaan en verder"}
      </button>
    </form>
  );
}
