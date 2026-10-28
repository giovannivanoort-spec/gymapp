/** Voedingswaarden per 100 gram (of 100 ml, behandeld als gram). */
export type Per100 = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number | null;
  sugar?: number | null;
};

/** Een gangbare portie, bijv. { label: "1 stuk", grams: 130 }. */
export type Portion = { label: string; grams: number };

export type FoodSource = "basis" | "off" | "custom" | "recipe" | "ai";

/** Een product of gerecht dat je kunt loggen. */
export type Food = {
  /** Uniek binnen de bron, bijv. "basis:1234", "off:8710398527806", "custom:<uuid>". */
  id: string;
  source: FoodSource;
  name: string;
  brand?: string | null;
  barcode?: string | null;
  per100: Per100;
  /** Gangbare porties; de app voegt altijd "100 g" en "eigen hoeveelheid" toe. */
  portions: Portion[];
};

export type Meal = "breakfast" | "lunch" | "dinner" | "snack";

export const MEALS: { id: Meal; label: string }[] = [
  { id: "breakfast", label: "Ontbijt" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Avondeten" },
  { id: "snack", label: "Tussendoor" },
];

/** Totale macro's (voor een portie, maaltijd of dag). */
export type Macros = { kcal: number; protein: number; carbs: number; fat: number };

export function macrosFor(per100: Per100, grams: number): Macros {
  const f = grams / 100;
  return {
    kcal: Math.round(per100.kcal * f),
    protein: Math.round(per100.protein * f * 10) / 10,
    carbs: Math.round(per100.carbs * f * 10) / 10,
    fat: Math.round(per100.fat * f * 10) / 10,
  };
}

export function sumMacros(list: Macros[]): Macros {
  return list.reduce(
    (a, m) => ({ kcal: a.kcal + m.kcal, protein: a.protein + m.protein, carbs: a.carbs + m.carbs, fat: a.fat + m.fat }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}
