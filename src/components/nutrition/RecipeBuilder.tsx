"use client";

import { useEffect, useMemo, useState } from "react";
import { fmt, parseAmount } from "@/lib/nutrition/format";
import { saveCustomFood } from "@/lib/nutrition/log";
import { searchProducts } from "@/lib/nutrition/openFoodFacts";
import { normalizeText, searchBasisFoods } from "@/lib/nutrition/searchFoods";
import type { Food, Per100, Portion } from "@/lib/nutrition/types";
import { errorMessage } from "@/lib/supabase";
import { CloseIcon, PlusIcon } from "../Icons";
import { MACRO_COLORS, MacroStat as Stat } from "./MacroSummary";

type Ingredient = { key: number; food: Food; grams: string };

const round1 = (n: number) => Math.round(n * 10) / 10;
let nextKey = 1;

/**
 * Recept samenstellen voor meal prep: ingrediënten met hun (rauwe) gewicht, het gewicht van het
 * hele gerecht na bereiden en het aantal porties. Het resultaat wordt een eigen product met
 * waarden per 100 g en een portie "1 portie", zodat je daarna een deel van de pan logt.
 */
export function RecipeBuilder({
  customFoods,
  recentFoods,
  onSaved,
}: {
  /** Eigen producten (om op te zoeken). */
  customFoods?: Food[];
  /** Recent gelogde producten (staan bovenaan als er nog niet gezocht is). */
  recentFoods?: Food[];
  onSaved: (food: Food) => void;
}) {
  const [name, setName] = useState("");
  const [items, setItems] = useState<Ingredient[]>([]);
  const [cooked, setCooked] = useState("");
  const [servings, setServings] = useState("4");
  const [query, setQuery] = useState("");
  const [brands, setBrands] = useState<{ q: string; foods: Food[] | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim();
  // Merkproducten pas na even niet typen (net als in het zoekscherm).
  useEffect(() => {
    if (q.length < 3) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setBrands({ q, foods: null });
      searchProducts(q, { signal: ctrl.signal })
        .then((foods) => setBrands({ q, foods: foods.slice(0, 6) }))
        .catch(() => !ctrl.signal.aborted && setBrands({ q, foods: [] }));
    }, 450);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const results = useMemo(() => {
    if (!q) return (recentFoods ?? []).slice(0, 6);
    const n = normalizeText(q);
    const mine = (customFoods ?? []).filter((f) => normalizeText(f.name).includes(n)).slice(0, 4);
    const seen = new Set(mine.map((f) => f.id));
    return [...mine, ...searchBasisFoods(q, 8).filter((f) => !seen.has(f.id))];
  }, [q, customFoods, recentFoods]);
  const brandResults = q.length >= 3 && brands?.q === q ? brands.foods : null;

  function addIngredient(food: Food) {
    setItems((list) => [...list, { key: nextKey++, food, grams: String(food.portions[0]?.grams ?? 100).replace(".", ",") }]);
    setQuery("");
    setError(null);
  }

  // Rekenen met onafgeronde waarden; pas aan het eind afronden.
  const parsed = items.map((it) => {
    const g = parseAmount(it.grams);
    return { ...it, g: Number.isFinite(g) && g > 0 && g <= 10000 ? g : NaN };
  });
  const allValid = parsed.length > 0 && parsed.every((it) => Number.isFinite(it.g));
  const raw = parsed.reduce((a, it) => a + (Number.isFinite(it.g) ? it.g : 0), 0);
  const total = parsed.reduce(
    (a, it) => {
      if (!Number.isFinite(it.g)) return a;
      const f = it.g / 100;
      const p = it.food.per100;
      return { kcal: a.kcal + p.kcal * f, protein: a.protein + p.protein * f, carbs: a.carbs + p.carbs * f, fat: a.fat + p.fat * f };
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
  const cookedTyped = parseAmount(cooked);
  const weight = cooked.trim() ? cookedTyped : raw;
  const weightValid = Number.isFinite(weight) && weight > 0 && weight <= 20000;
  const n = Math.round(parseAmount(servings));
  const servingsValid = Number.isFinite(n) && n >= 1 && n <= 50;
  const per100: Per100 | null = weightValid
    ? { kcal: Math.round((total.kcal * 100) / weight), protein: round1((total.protein * 100) / weight), carbs: round1((total.carbs * 100) / weight), fat: round1((total.fat * 100) / weight) }
    : null;
  // Door verdampen wordt een gerecht lichter, maar nooit zo licht dat er per 100 g meer dan ~950 kcal in zit.
  const tooDense = per100 != null && (per100.kcal > 950 || per100.protein + per100.carbs + per100.fat > 105);
  const portion = weightValid && servingsValid ? weight / n : 0;
  const valid = name.trim().length > 0 && allValid && weightValid && servingsValid && !tooDense && per100 != null;

  async function save() {
    if (!valid || !per100 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const portions: Portion[] = [{ label: "1 portie", grams: round1(portion) }];
      if (n > 1) portions.push({ label: `hele recept (${fmt(weight)} g)`, grams: round1(weight) });
      const food = await saveCustomFood({ name: name.trim(), brand: `Recept · ${n} ${n === 1 ? "portie" : "porties"}`, per100, portions });
      onSaved(food);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
        Voor meal prep: voeg de ingrediënten toe zoals je ze afweegt, en weeg na het koken de hele pan. Daarna log je per portie of per gram.
      </p>

      <div>
        <label className="label" htmlFor="rb-name">
          Naam van het recept
        </label>
        <input id="rb-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="bijv. Kip-rijst meal prep" maxLength={80} />
      </div>

      <section className="space-y-2" aria-labelledby="rb-ingredients">
        <h3 id="rb-ingredients" className="label">
          Ingrediënten {items.length > 0 && <span className="normal-case text-muted">({items.length})</span>}
        </h3>
        {items.length > 0 ? (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {parsed.map((it) => (
              <li key={it.key} className="animate-fade-in flex items-center gap-2 py-1.5 pl-3 pr-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.food.name}</p>
                  <p className="truncate text-xs text-muted tabular-nums">
                    {Number.isFinite(it.g) ? `${fmt((it.food.per100.kcal * it.g) / 100)} kcal · E ${fmt((it.food.per100.protein * it.g) / 100, 1)} g` : "Vul de grammen in"}
                  </p>
                </div>
                <input
                  className={`input min-h-11 w-[4.5rem] px-2 py-1.5 text-center tabular-nums ${Number.isFinite(it.g) ? "" : "border-danger"}`}
                  inputMode="decimal"
                  value={it.grams}
                  onChange={(e) => setItems((list) => list.map((x) => (x.key === it.key ? { ...x, grams: e.target.value } : x)))}
                  onFocus={(e) => e.target.select()}
                  aria-label={`Grammen ${it.food.name}`}
                  aria-invalid={!Number.isFinite(it.g)}
                />
                <span className="text-xs text-muted">g</span>
                <button
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:text-danger active:scale-90"
                  onClick={() => setItems((list) => list.filter((x) => x.key !== it.key))}
                  aria-label={`${it.food.name} verwijderen`}
                >
                  <CloseIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-line px-3 py-4 text-center text-sm text-muted">Nog geen ingrediënten. Zoek hieronder.</p>
        )}

        <input
          className="input"
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ingrediënt zoeken, bijv. rijst, kipfilet"
          aria-label="Ingrediënt zoeken"
        />
        {(results.length > 0 || q) && (
          <div className="rounded-2xl bg-surface-2 px-3 py-1">
            {!q && <p className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Recent</p>}
            <ul className="divide-y divide-line">
              {results.map((f) => (
                <IngredientRow key={f.id} food={f} onAdd={() => addIngredient(f)} />
              ))}
              {brandResults?.map((f) => (
                <IngredientRow key={f.id} food={f} onAdd={() => addIngredient(f)} />
              ))}
              {q.length >= 3 && brandResults === null && (
                <li className="py-2" aria-hidden>
                  <div className="skeleton h-9" />
                </li>
              )}
              {q && results.length === 0 && brandResults?.length === 0 && <li className="py-3 text-sm text-muted">Niets gevonden. Probeer een andere zoekterm.</li>}
              {q && q.length < 3 && results.length === 0 && <li className="py-3 text-sm text-muted">Typ verder om te zoeken.</li>}
            </ul>
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="rb-cooked">
            Gewicht na koken
          </label>
          <div className="flex items-center gap-2">
            <input
              id="rb-cooked"
              className="input tabular-nums"
              inputMode="decimal"
              value={cooked}
              onChange={(e) => setCooked(e.target.value)}
              placeholder={raw > 0 ? fmt(raw) : "bijv. 1.800"}
              aria-describedby="rb-cooked-hint"
            />
            <span className="text-sm text-muted">g</span>
          </div>
          <p id="rb-cooked-hint" className="mt-1 text-[11px] text-muted">
            Leeg = som van de ingrediënten
          </p>
        </div>
        <div>
          <label className="label" htmlFor="rb-servings">
            Porties
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn-ghost h-11 w-11 shrink-0 p-0 text-lg"
              onClick={() => setServings(String(Math.max(1, (servingsValid ? n : 1) - 1)))}
              aria-label="Minder porties"
            >
              −
            </button>
            <input
              id="rb-servings"
              className="input px-1 text-center tabular-nums"
              inputMode="numeric"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
            />
            <button
              type="button"
              className="btn-ghost h-11 w-11 shrink-0 p-0 text-lg"
              onClick={() => setServings(String(Math.min(50, (servingsValid ? n : 0) + 1)))}
              aria-label="Meer porties"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {items.length > 0 && per100 && (
        <div className="animate-fade-in space-y-2 rounded-2xl bg-surface-2 p-3">
          <p className="text-center text-xs text-muted">
            Per portie{portion > 0 ? ` (${fmt(portion)} g)` : ""}
          </p>
          <div className="grid grid-cols-4 gap-2 text-center">
            <Stat label="kcal" value={fmt(servingsValid ? total.kcal / n : 0)} />
            <Stat label="eiwit" value={`${fmt(servingsValid ? total.protein / n : 0, 1)} g`} color={MACRO_COLORS.protein} />
            <Stat label="koolh." value={`${fmt(servingsValid ? total.carbs / n : 0, 1)} g`} color={MACRO_COLORS.carbs} />
            <Stat label="vet" value={`${fmt(servingsValid ? total.fat / n : 0, 1)} g`} color={MACRO_COLORS.fat} />
          </div>
          <p className="border-t border-line pt-2 text-center text-[11px] text-muted tabular-nums">
            Hele recept {fmt(total.kcal)} kcal · per 100 g {fmt(per100.kcal)} kcal, E {fmt(per100.protein, 1)} g
          </p>
        </div>
      )}

      {tooDense && (
        <p className="text-xs text-warn" role="status">
          Het gewicht na koken lijkt te laag voor deze ingrediënten. Controleer of je de hele pan hebt gewogen (in gram).
        </p>
      )}
      {!servingsValid && servings.trim() !== "" && <p className="text-xs text-warn">Kies tussen 1 en 50 porties.</p>}
      {error && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <button className="btn-primary w-full py-3" disabled={!valid || saving} onClick={save}>
        {saving ? "Opslaan…" : !name.trim() ? "Geef het recept een naam" : !items.length ? "Voeg ingrediënten toe" : "Recept opslaan en loggen"}
      </button>
    </div>
  );
}

function IngredientRow({ food, onAdd }: { food: Food; onAdd: () => void }) {
  return (
    <li>
      <button onClick={onAdd} className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left transition active:opacity-70">
        <div className="min-w-0">
          <p className="truncate text-sm">{food.name}</p>
          <p className="truncate text-xs text-muted">{[food.brand, `${fmt(food.per100.kcal)} kcal / 100 g`].filter(Boolean).join(" · ")}</p>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-accent" aria-hidden>
          <PlusIcon size={14} />
        </span>
      </button>
    </li>
  );
}
