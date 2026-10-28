import { ageFrom } from "../dates";
import type { Profile } from "../types";
import type { Macros } from "./types";

export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type NutritionGoal = "cut" | "maintain" | "bulk";

export const ACTIVITY: { id: ActivityLevel; label: string; detail: string; factor: number }[] = [
  { id: "sedentary", label: "Weinig", detail: "Zittend werk, nauwelijks sport", factor: 1.2 },
  { id: "light", label: "Licht", detail: "1–2× per week sporten", factor: 1.375 },
  { id: "moderate", label: "Gemiddeld", detail: "3–4× per week sporten", factor: 1.55 },
  { id: "active", label: "Actief", detail: "5–6× per week sporten", factor: 1.725 },
  { id: "very_active", label: "Zeer actief", detail: "Dagelijks zwaar sporten of fysiek werk", factor: 1.9 },
];

export const GOALS: { id: NutritionGoal; label: string; detail: string }[] = [
  { id: "cut", label: "Afvallen", detail: "≈ 450 kcal onder onderhoud" },
  { id: "maintain", label: "Op gewicht blijven", detail: "Onderhoud" },
  { id: "bulk", label: "Aankomen", detail: "≈ 300 kcal boven onderhoud" },
];

export type NutritionProfile = Profile & {
  activity_level?: ActivityLevel | null;
  nutrition_goal?: NutritionGoal | null;
  kcal_target?: number | null;
  protein_target?: number | null;
  carbs_target?: number | null;
  fat_target?: number | null;
};

export type Targets = Macros & {
  /** Ruststofwisseling en dagelijks verbruik (alleen als ze berekend konden worden). */
  bmr: number | null;
  tdee: number | null;
  /** Welke waarden handmatig zijn ingesteld. */
  manual: { kcal: boolean; protein: boolean; carbs: boolean; fat: boolean };
};

/**
 * Dagdoelen. Calorieën: Mifflin-St Jeor × activiteit ± doel. Eiwit 1,8 g/kg (2,2 bij afvallen),
 * vet 25% van de calorieën (minstens 0,6 g/kg), de rest koolhydraten. Handmatige doelen gaan voor.
 * Geeft null als gewicht, lengte, leeftijd of geslacht ontbreekt en er geen handmatig doel is.
 */
export function computeTargets(p: NutritionProfile | null): Targets | null {
  if (!p) return null;
  const w = p.bodyweight_kg ? Number(p.bodyweight_kg) : null;
  const h = p.height_cm ? Number(p.height_cm) : null;
  const age = ageFrom(p.birth_date);
  const goal = p.nutrition_goal ?? "maintain";
  const factor = ACTIVITY.find((a) => a.id === (p.activity_level ?? "moderate"))!.factor;

  const bmr = w && h && age != null && p.sex ? 10 * w + 6.25 * h - 5 * age + (p.sex === "male" ? 5 : -161) : null;
  const tdee = bmr ? bmr * factor : null;
  const autoKcal = tdee ? tdee + (goal === "cut" ? -450 : goal === "bulk" ? 300 : 0) : null;

  const kcal = p.kcal_target ?? (autoKcal ? Math.round(autoKcal / 10) * 10 : null);
  if (!kcal) return null;

  const weight = w ?? kcal / 30; // grove schatting als gewicht ontbreekt maar kcal handmatig is
  const protein = p.protein_target ?? Math.round(weight * (goal === "cut" ? 2.2 : 1.8));
  const fat = p.fat_target ?? Math.round(Math.max((kcal * 0.25) / 9, weight * 0.6));
  const carbs = p.carbs_target ?? Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));

  return {
    kcal,
    protein,
    carbs,
    fat,
    bmr: bmr ? Math.round(bmr) : null,
    tdee: tdee ? Math.round(tdee) : null,
    manual: {
      kcal: p.kcal_target != null,
      protein: p.protein_target != null,
      carbs: p.carbs_target != null,
      fat: p.fat_target != null,
    },
  };
}
