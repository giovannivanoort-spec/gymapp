"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addLog,
  deleteSavedMeal,
  fetchCustomFoods,
  fetchFavorites,
  fetchRecent,
  fetchSavedMeals,
  findCustomByBarcode,
  setFavorite,
  type SavedMeal,
} from "@/lib/nutrition/log";
import { lookupBarcode, OFF_ATTRIBUTION, searchProducts } from "@/lib/nutrition/openFoodFacts";
import { searchBasisFoods } from "@/lib/nutrition/searchFoods";
import { macrosFor, MEALS, sumMacros, type Food, type Meal } from "@/lib/nutrition/types";
import { errorMessage } from "@/lib/supabase";
import { BarcodeScanner } from "../BarcodeScanner";
import { ChevronRightIcon, CloseIcon, PlusIcon, SparkleIcon } from "../Icons";
import { Sheet } from "../Sheet";
import { CustomFoodForm } from "./CustomFoodForm";
import { PhotoEstimate } from "./PhotoEstimate";
import { PortionPicker } from "./PortionPicker";

type Mode = { kind: "search" } | { kind: "portion"; food: Food; grams?: number } | { kind: "photo" } | { kind: "custom"; barcode?: string };

const nl = (n: number) => Math.round(n).toLocaleString("nl-NL");
const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function AddFoodSheet({ open, onClose, meal, date, onAdded }: { open: boolean; onClose: () => void; meal: Meal; date: string; onAdded: () => void }) {
  const [mode, setMode] = useState<Mode>({ kind: "search" });
  const [query, setQuery] = useState("");
  const [scanner, setScanner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [recent, setRecent] = useState<{ food: Food; grams: number }[] | null>(null);
  const [favorites, setFavorites] = useState<Food[]>([]);
  const [custom, setCustom] = useState<Food[]>([]);
  const [saved, setSaved] = useState<SavedMeal[]>([]);
  const [brands, setBrands] = useState<{ q: string; foods: Food[] | null; error?: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    Promise.all([fetchRecent(), fetchFavorites(), fetchCustomFoods(), fetchSavedMeals()]).then(([r, f, c, s]) => {
      setRecent(r);
      setFavorites(f);
      setCustom(c);
      setSaved(s);
    });
  }, [open]);

  // Merkproducten (Open Food Facts) met vertraging, zodat we niet bij elke letter zoeken.
  const q = query.trim();
  useEffect(() => {
    if (q.length < 3) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setBrands({ q, foods: null });
      searchProducts(q, { signal: ctrl.signal })
        .then((foods) => setBrands({ q, foods }))
        .catch((err) => !ctrl.signal.aborted && setBrands({ q, foods: [], error: errorMessage(err) }));
    }, 650);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const basis = useMemo(() => (q ? searchBasisFoods(q, 25) : []), [q]);
  const mine = useMemo(() => (q ? custom.filter((f) => normalize(f.name).includes(normalize(q))) : []), [q, custom]);
  const favIds = new Set(favorites.map((f) => f.id));

  function close() {
    setMode({ kind: "search" });
    setQuery("");
    setMessage(null);
    setBrands(null);
    onClose();
  }

  async function add(food: Food, grams: number, m: Meal, label: string | null) {
    setBusy(true);
    try {
      await addLog(food, grams, m, date, label);
      navigator.vibrate?.(12);
      onAdded();
      close();
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function addSavedMeal(sm: SavedMeal) {
    setBusy(true);
    try {
      for (const it of sm.items) await addLog(it.food, it.grams, meal, date, it.portion_label ?? null);
      onAdded();
      close();
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onBarcode(code: string) {
    setScanner(false);
    setBusy(true);
    setMessage(null);
    try {
      const food = (await findCustomByBarcode(code)) ?? (await lookupBarcode(code));
      if (food) setMode({ kind: "portion", food });
      else setMode({ kind: "custom", barcode: code });
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite(food: Food) {
    const on = !favIds.has(food.id);
    setFavorites(on ? [food, ...favorites] : favorites.filter((f) => f.id !== food.id));
    await setFavorite(food, on);
  }

  const mealLabel = MEALS.find((m) => m.id === meal)?.label.toLowerCase();
  const title =
    mode.kind === "photo" ? "Foto van je maaltijd" : mode.kind === "custom" ? "Eigen product" : mode.kind === "portion" ? "Hoeveelheid" : `Toevoegen aan ${mealLabel}`;

  return (
    <>
      <Sheet open={open && !scanner} onClose={close} title={title}>
        {mode.kind !== "search" && (
          <button className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink" onClick={() => setMode({ kind: "search" })}>
            <ChevronRightIcon size={16} className="rotate-180" /> Terug
          </button>
        )}

        {message && <p className="mb-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{message}</p>}

        {mode.kind === "portion" && (
          <PortionPicker
            food={mode.food}
            meal={meal}
            initialGrams={mode.grams}
            favorite={favIds.has(mode.food.id)}
            onToggleFavorite={() => toggleFavorite(mode.food)}
            onAdd={(g, m, label) => add(mode.food, g, m, label)}
            busy={busy}
          />
        )}

        {mode.kind === "photo" && (
          <PhotoEstimate
            meal={meal}
            date={date}
            onDone={() => {
              onAdded();
              close();
            }}
          />
        )}

        {mode.kind === "custom" && (
          <CustomFoodForm
            barcode={mode.barcode}
            onSaved={(food) => {
              setCustom([...custom, food]);
              setMode({ kind: "portion", food });
            }}
          />
        )}

        {mode.kind === "search" && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <ActionButton label="Barcode" onClick={() => setScanner(true)} icon={<BarcodeIcon />} />
              <ActionButton label="Foto" onClick={() => setMode({ kind: "photo" })} icon={<SparkleIcon size={20} />} />
              <ActionButton label="Eigen product" onClick={() => setMode({ kind: "custom" })} icon={<PlusIcon size={20} />} />
            </div>
            <input
              className="input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zoek product, bijv. kipfilet, havermout, AH yoghurt"
              autoFocus
            />
            {busy && <div className="skeleton h-12" />}

            {!q ? (
              <>
                {saved.length > 0 && (
                  <Section title="Mijn maaltijden">
                    {saved.map((sm) => {
                      const t = sumMacros(sm.items.map((it) => macrosFor(it.food.per100, it.grams)));
                      return (
                        <li key={sm.id} className="flex items-center gap-2">
                          <button onClick={() => addSavedMeal(sm)} className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2.5 text-left">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{sm.name}</p>
                              <p className="truncate text-xs text-muted">{sm.items.map((it) => it.food.name).join(", ")}</p>
                            </div>
                            <span className="shrink-0 text-xs text-muted tabular-nums">{nl(t.kcal)} kcal</span>
                          </button>
                          <button
                            className="p-1 text-muted hover:text-danger"
                            aria-label={`${sm.name} verwijderen`}
                            onClick={async () => {
                              if (!confirm(`"${sm.name}" verwijderen?`)) return;
                              await deleteSavedMeal(sm.id);
                              setSaved(saved.filter((x) => x.id !== sm.id));
                            }}
                          >
                            <CloseIcon size={14} />
                          </button>
                        </li>
                      );
                    })}
                  </Section>
                )}
                {favorites.length > 0 && (
                  <Section title="Favorieten">
                    {favorites.map((f) => (
                      <FoodRow key={f.id} food={f} onClick={() => setMode({ kind: "portion", food: f })} />
                    ))}
                  </Section>
                )}
                <Section title="Recent">
                  {recent === null ? (
                    <li className="skeleton my-2 h-10" />
                  ) : recent.length === 0 ? (
                    <li className="py-2 text-sm text-muted">Nog niets gelogd. Zoek een product, scan een barcode of maak een foto.</li>
                  ) : (
                    recent.map((r) => <FoodRow key={r.food.id} food={r.food} sub={`laatst ${nl(r.grams)} g`} onClick={() => setMode({ kind: "portion", food: r.food, grams: r.grams })} />)
                  )}
                </Section>
              </>
            ) : (
              <>
                {mine.length > 0 && (
                  <Section title="Mijn producten">
                    {mine.map((f) => (
                      <FoodRow key={f.id} food={f} onClick={() => setMode({ kind: "portion", food: f })} />
                    ))}
                  </Section>
                )}
                <Section title="Basisproducten">
                  {basis.length === 0 ? (
                    <li className="py-2 text-sm text-muted">Geen basisproducten gevonden.</li>
                  ) : (
                    basis.map((f) => <FoodRow key={f.id} food={f} onClick={() => setMode({ kind: "portion", food: f })} />)
                  )}
                </Section>
                {q.length >= 3 && (
                  <Section title="Merkproducten">
                    {!brands || brands.q !== q || brands.foods === null ? (
                      <>
                        <li className="skeleton my-2 h-10" />
                        <li className="skeleton my-2 h-10" />
                      </>
                    ) : brands.error ? (
                      <li className="py-2 text-sm text-muted">{brands.error}</li>
                    ) : brands.foods.length === 0 ? (
                      <li className="py-2 text-sm text-muted">Geen merkproducten gevonden. Tip: scan de barcode.</li>
                    ) : (
                      brands.foods.map((f) => <FoodRow key={f.id} food={f} onClick={() => setMode({ kind: "portion", food: f })} />)
                    )}
                  </Section>
                )}
                <p className="text-center text-[11px] text-muted">
                  Basisproducten: USDA FoodData Central · {OFF_ATTRIBUTION}
                </p>
              </>
            )}
          </div>
        )}
      </Sheet>
      {scanner && <BarcodeScanner open={scanner} onClose={() => setScanner(false)} onDetected={onBarcode} />}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  );
}

function FoodRow({ food, sub, onClick }: { food: Food; sub?: string; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition active:opacity-70">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{food.name}</p>
          <p className="truncate text-xs text-muted">
            {[food.brand, sub, `E ${food.per100.protein.toLocaleString("nl-NL")} g / 100 g`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted tabular-nums">{nl(food.per100.kcal)} kcal</span>
      </button>
    </li>
  );
}

function ActionButton({ label, onClick, icon }: { label: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-surface-2 px-2 py-3 text-xs font-medium transition hover:border-accent hover:text-accent active:scale-95">
      <span className="text-accent">{icon}</span>
      {label}
    </button>
  );
}

function BarcodeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M7 8v8M10 8v8M13 8v8M16 8v8" />
    </svg>
  );
}
