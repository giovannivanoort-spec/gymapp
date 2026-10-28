"use client";

import { supabase } from "../supabase";
import { macrosFor, type Food, type Meal, type Per100 } from "./types";

export type FoodLog = {
  id: string;
  date: string;
  meal: Meal;
  food_id: string;
  source: Food["source"];
  name: string;
  brand: string | null;
  grams: number;
  portion_label: string | null;
  per100: Per100;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  created_at: string;
};

export type SavedMeal = { id: string; name: string; items: { food: Food; grams: number; portion_label?: string | null }[] };

const num = (v: unknown) => (v == null ? 0 : Number(v));

function normalize(row: Record<string, unknown>): FoodLog {
  return {
    ...(row as unknown as FoodLog),
    grams: num(row.grams),
    kcal: num(row.kcal),
    protein: num(row.protein),
    carbs: num(row.carbs),
    fat: num(row.fat),
  };
}

export async function fetchLogs(from: string, to: string): Promise<FoodLog[]> {
  const { data } = await supabase
    .from("food_logs")
    .select("*")
    .gte("date", from)
    .lte("date", to)
    .order("created_at");
  return (data ?? []).map(normalize);
}

export async function addLog(food: Food, grams: number, meal: Meal, date: string, portionLabel?: string | null) {
  const m = macrosFor(food.per100, grams);
  const { error } = await supabase.from("food_logs").insert({
    date,
    meal,
    food_id: food.id,
    source: food.source,
    name: food.name,
    brand: food.brand ?? null,
    grams,
    portion_label: portionLabel ?? null,
    per100: food.per100,
    ...m,
  });
  if (error) throw error;
}

export async function updateLogGrams(log: FoodLog, grams: number) {
  const m = macrosFor(log.per100, grams);
  const { error } = await supabase.from("food_logs").update({ grams, portion_label: null, ...m }).eq("id", log.id);
  if (error) throw error;
}

export async function deleteLog(id: string) {
  await supabase.from("food_logs").delete().eq("id", id);
}

/** Een gelogd item weer als product (voor recent, kopiëren en opslaan als maaltijd). */
export function logToFood(l: FoodLog): Food {
  return { id: l.food_id, source: l.source, name: l.name, brand: l.brand, per100: l.per100, portions: [] };
}

/** Laatst gelogde verschillende producten. */
export async function fetchRecent(limit = 20): Promise<{ food: Food; grams: number }[]> {
  const { data } = await supabase.from("food_logs").select("*").order("created_at", { ascending: false }).limit(200);
  const seen = new Set<string>();
  const out: { food: Food; grams: number }[] = [];
  for (const row of (data ?? []).map(normalize)) {
    if (seen.has(row.food_id)) continue;
    seen.add(row.food_id);
    out.push({ food: logToFood(row), grams: row.grams });
    if (out.length >= limit) break;
  }
  return out;
}

export async function fetchFavorites(): Promise<Food[]> {
  const { data } = await supabase.from("food_favorites").select("food").order("created_at", { ascending: false });
  return (data ?? []).map((r) => r.food as Food);
}

export async function setFavorite(food: Food, on: boolean) {
  if (on) await supabase.from("food_favorites").upsert({ food_id: food.id, food }, { onConflict: "user_id,food_id" });
  else await supabase.from("food_favorites").delete().eq("food_id", food.id);
}

export async function fetchCustomFoods(): Promise<Food[]> {
  const { data } = await supabase.from("custom_foods").select("*").order("name");
  return (data ?? []).map((r) => ({
    id: `custom:${r.id}`,
    source: "custom" as const,
    name: r.name,
    brand: r.brand,
    barcode: r.barcode,
    per100: r.per100 as Per100,
    portions: (r.portions as Food["portions"]) ?? [],
  }));
}

export async function saveCustomFood(f: { name: string; brand?: string; barcode?: string; per100: Per100; portions: Food["portions"] }): Promise<Food> {
  const { data, error } = await supabase
    .from("custom_foods")
    .insert({ name: f.name, brand: f.brand || null, barcode: f.barcode || null, per100: f.per100, portions: f.portions })
    .select("id")
    .single();
  if (error) throw error;
  return { id: `custom:${data.id}`, source: "custom", name: f.name, brand: f.brand || null, barcode: f.barcode || null, per100: f.per100, portions: f.portions };
}

export async function findCustomByBarcode(code: string): Promise<Food | null> {
  const all = await fetchCustomFoods();
  return all.find((f) => f.barcode === code) ?? null;
}

export async function fetchSavedMeals(): Promise<SavedMeal[]> {
  const { data } = await supabase.from("saved_meals").select("*").order("name");
  return (data ?? []) as SavedMeal[];
}

export async function saveMeal(name: string, logs: FoodLog[]) {
  const items = logs.map((l) => ({ food: logToFood(l), grams: l.grams, portion_label: l.portion_label }));
  const { error } = await supabase.from("saved_meals").insert({ name, items });
  if (error) throw error;
}

export async function deleteSavedMeal(id: string) {
  await supabase.from("saved_meals").delete().eq("id", id);
}

/** Verkleint een foto in de browser tot max. `max` px (scheelt uploadtijd en API-kosten). */
export async function resizeImage(file: File, max = 1024, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}
