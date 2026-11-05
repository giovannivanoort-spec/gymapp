"use client";

import { useState } from "react";
import { parseAmount as toNum } from "@/lib/nutrition/format";
import { deleteCustomFood, saveCustomFood, updateCustomFood } from "@/lib/nutrition/log";
import type { PartialProduct } from "@/lib/nutrition/openFoodFacts";
import type { Food } from "@/lib/nutrition/types";
import { errorMessage } from "@/lib/supabase";

const str = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

/**
 * Eigen product aanmaken met waarden van het etiket (per 100 g), of een bestaand eigen product
 * aanpassen of verwijderen (met `initial`).
 */
export function CustomFoodForm({
  barcode,
  reason,
  initial,
  prefill,
  onSaved,
  onDeleted,
}: {
  barcode?: string;
  /** Waarom de barcode niet direct een product gaf: onbekend bij OFF, of wel bekend maar zonder voedingswaarden. */
  reason?: "unknown" | "incomplete";
  /** Bestaand eigen product om aan te passen. */
  initial?: Food;
  /** Wat Open Food Facts al wist van een onvolledig product (naam, merk, porties, losse waarden). */
  prefill?: PartialProduct | null;
  onSaved: (food: Food) => void;
  onDeleted?: (food: Food) => void;
}) {
  const portion = initial?.portions[0] ?? prefill?.portions[0];
  const base = initial?.per100 ?? prefill?.per100;
  const [f, setF] = useState({
    name: initial?.name ?? prefill?.name ?? "",
    brand: initial?.brand ?? prefill?.brand ?? "",
    kcal: str(base?.kcal),
    protein: str(base?.protein),
    carbs: str(base?.carbs),
    fat: str(base?.fat),
    portionLabel: portion?.label ?? "",
    portionGrams: str(portion?.grams),
    barcode: initial?.barcode ?? barcode ?? "",
  });
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const per100 = { kcal: toNum(f.kcal), protein: toNum(f.protein), carbs: toNum(f.carbs), fat: toNum(f.fat) };
  const filled = Object.values(per100).every((v) => Number.isFinite(v) && v >= 0);
  // Per 100 g kan er nooit meer dan 100 g macro's of ±900 kcal in zitten: dan is er waarschijnlijk per portie ingevuld.
  const hint = !filled
    ? null
    : per100.kcal > 950
      ? "Meer dan 950 kcal per 100 g kan niet. Staan de waarden misschien per portie op het etiket?"
      : per100.protein + per100.carbs + per100.fat > 101
        ? "Eiwit, koolhydraten en vet samen kunnen niet meer dan 100 g per 100 g zijn."
        : null;
  const valid = f.name.trim() && filled && !hint;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy("save");
    setError(null);
    try {
      const grams = toNum(f.portionGrams);
      const fields = {
        name: f.name.trim(),
        brand: f.brand.trim(),
        barcode: f.barcode.replace(/\s/g, ""),
        per100: { kcal: Math.round(per100.kcal), protein: per100.protein, carbs: per100.carbs, fat: per100.fat },
        portions: f.portionLabel.trim() && grams > 0 ? [{ label: f.portionLabel.trim(), grams }] : [],
      };
      const food = initial ? await updateCustomFood(initial, fields) : await saveCustomFood(fields);
      onSaved(food);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  async function remove() {
    if (!initial || busy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy("delete");
    setError(null);
    try {
      await deleteCustomFood(initial);
      onDeleted?.(initial);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {barcode && !initial && (
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
          {reason === "incomplete"
            ? prefill
              ? `${prefill.name || `Product ${barcode}`} gevonden, maar niet alle voedingswaarden zijn bekend. Wat er al was, staat ingevuld: vul de lege velden aan met het etiket.`
              : `Product ${barcode} gevonden, maar zonder volledige voedingswaarden. Vul de waarden van het etiket in, dan herkent de app hem voortaan.`
            : `Barcode ${barcode} staat nog niet in de database. Vul de waarden van het etiket in, dan herkent de app hem voortaan.`}
        </p>
      )}
      {initial && (
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
          Wat je al hebt gelogd, blijft zoals het was. Nieuwe items gebruiken de aangepaste waarden.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label" htmlFor="cf-name">
            Naam
          </label>
          <input id="cf-name" className="input" value={f.name} onChange={set("name")} placeholder="bijv. Proteïne pudding vanille" required maxLength={80} />
        </div>
        <div>
          <label className="label" htmlFor="cf-brand">
            Merk (optioneel)
          </label>
          <input id="cf-brand" className="input" value={f.brand} onChange={set("brand")} maxLength={40} />
        </div>
        <div>
          <label className="label" htmlFor="cf-barcode">
            Barcode (optioneel)
          </label>
          <input id="cf-barcode" className="input" inputMode="numeric" value={f.barcode} onChange={set("barcode")} maxLength={20} />
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
              <input
                className={`input px-2 text-center tabular-nums ${prefill && !initial && !f[k].trim() ? "border-accent/60" : ""}`}
                inputMode="decimal"
                value={f[k]}
                onChange={set(k)}
                aria-label={`${label} per 100 gram`}
                required
              />
              <p className="mt-1 text-center text-[10px] uppercase tracking-wide text-muted">{label}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <div>
          <label className="label" htmlFor="cf-portion">
            Portie (optioneel)
          </label>
          <input id="cf-portion" className="input" value={f.portionLabel} onChange={set("portionLabel")} placeholder="bijv. 1 beker" />
        </div>
        <div>
          <label className="label" htmlFor="cf-pg">
            Gram
          </label>
          <input id="cf-pg" className="input text-center" inputMode="decimal" value={f.portionGrams} onChange={set("portionGrams")} />
        </div>
      </div>
      {hint && (
        <p className="text-xs text-warn" role="status">
          {hint}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <button className="btn-primary w-full py-3" disabled={!valid || busy !== null}>
        {busy === "save" ? "Opslaan…" : initial ? "Wijzigingen opslaan" : "Opslaan en verder"}
      </button>
      {initial && onDeleted && (
        <button
          type="button"
          className={`w-full ${confirmDelete ? "btn-danger" : "btn-ghost text-danger"}`}
          disabled={busy !== null}
          onClick={remove}
          onBlur={() => busy === null && setConfirmDelete(false)}
        >
          {busy === "delete" ? "Verwijderen…" : confirmDelete ? "Tik nogmaals om te verwijderen" : "Product verwijderen"}
        </button>
      )}
    </form>
  );
}
