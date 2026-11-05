"use client";

import { invalidate } from "../cache";
import { toISODate } from "../dates";
import { isNetworkError, supabase } from "../supabase";
import { applyQueue, cancelQueuedDeletes, confirmLocal, dropLocal, queueConfirm, queueDelete, queueInsert } from "./offline";
import { macrosFor, type Food, type Macros, type Meal, type Per100 } from "./types";

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
  /** Vooruit gepland: telt pas mee na bevestigen. */
  planned: boolean;
  created_at: string;
  /** Alleen lokaal: zonder verbinding toegevoegd, wacht nog op versturen. */
  pending?: boolean;
};

export type SavedMeal = { id: string; name: string; items: { food: Food; grams: number; portion_label?: string | null }[] };

/** Eén regel om toe te voegen aan het dagboek. `planned` standaard: dag ligt in de toekomst. */
export type NewLog = { food: Food; grams: number; meal: Meal; date: string; portionLabel?: string | null; planned?: boolean };

/* ───────── Cache-sleutels (stale-while-revalidate via lib/cache) ───────── */

export const nutritionKeys = {
  day: (uid: string, date: string) => `nutrition:logs:${uid}:${date}`,
  range: (uid: string, from: string, to: string) => `nutrition:range:${uid}:${from}:${to}`,
  recent: (uid: string) => `nutrition:recent:${uid}`,
  favorites: (uid: string) => `nutrition:favorites:${uid}`,
  custom: (uid: string) => `nutrition:custom:${uid}`,
  saved: (uid: string) => `nutrition:saved:${uid}`,
  frequent: (uid: string) => `nutrition:frequent:${uid}`,
};

/**
 * Versie van de voedingsdata: wordt opgehoogd zodra een wijziging begint en als hij klaar is.
 * Een fetch die tijdens een wijziging liep, kan zo herkennen dat zijn resultaat verouderd is.
 */
let mutationVersion = 0;

/** Aanroepen vlak voordat een wijziging naar de server gaat (naast een optimistische update). */
export function markNutritionMutation() {
  mutationVersion++;
}

/** Na elke wijziging: dagboek, week, lijsten en de voedingskaart op Home opnieuw ophalen. */
export function invalidateNutrition() {
  mutationVersion++;
  invalidate("nutrition:");
  invalidate("home:food");
}

/**
 * Haalt data op en garandeert dat het resultaat niet van vóór een wijziging is: is er tijdens het
 * ophalen iets aangepast, dan wordt meteen opnieuw opgehaald (een paar keer maximaal). Zo
 * overschrijft een fetch die al liep nooit een optimistische update met oude data.
 */
export async function freshFetch<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  const v = mutationVersion;
  const data = await fn();
  return v !== mutationVersion && tries > 1 ? freshFetch(fn, tries - 1) : data;
}

/* ───────── Dagboek ───────── */

const num = (v: unknown) => (v == null ? 0 : Number(v));

function normalize(row: Record<string, unknown>): FoodLog {
  return {
    ...(row as unknown as FoodLog),
    grams: num(row.grams),
    kcal: num(row.kcal),
    protein: num(row.protein),
    carbs: num(row.carbs),
    fat: num(row.fat),
    planned: !!row.planned,
  };
}

/** Snel toegevoegde items (alleen kcal en macro's, zonder product). */
export const isQuick = (l: Pick<FoodLog, "food_id">) => l.food_id.startsWith("quick:");

/** Dagboek van `from` t/m `to`, inclusief wat zonder verbinding is ingevoerd en nog wacht. */
export async function fetchLogs(from: string, to: string): Promise<FoodLog[]> {
  const { data, error } = await supabase
    .from("food_logs")
    .select("*")
    .gte("date", from)
    .lte("date", to)
    .order("created_at");
  if (error) throw error;
  return applyQueue((data ?? []).map(normalize), from, to);
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

function toRow(n: NewLog) {
  const m = macrosFor(n.food.per100, n.grams);
  return {
    // Eigen id: nog een keer versturen (na een wegvallend antwoord of vanuit de wachtrij) geeft geen dubbel item.
    id: newId(),
    date: n.date,
    meal: n.meal,
    food_id: n.food.id,
    source: n.food.source,
    name: n.food.name,
    brand: n.food.brand ?? null,
    grams: n.grams,
    portion_label: n.portionLabel ?? null,
    per100: n.food.per100,
    ...m,
    // Eten voor een latere dag is een planning; die bevestig je op de dag zelf.
    planned: n.planned ?? n.date > toISODate(),
  };
}

export async function addLog(food: Food, grams: number, meal: Meal, date: string, portionLabel?: string | null): Promise<FoodLog> {
  const [row] = await addLogs([{ food, grams, meal, date, portionLabel }]);
  return row;
}

/**
 * Meerdere items in één insert: lukt alles of niets (geen half gelogde maaltijd bij een fout).
 * Zonder verbinding gaan ze in de wachtrij en komen ze terug met `pending: true`.
 */
export async function addLogs(items: NewLog[]): Promise<FoodLog[]> {
  if (!items.length) return [];
  markNutritionMutation();
  const rows = items.map(toRow);
  const { data, error } = await supabase.from("food_logs").insert(rows).select("*");
  if (error) {
    if (!isNetworkError(error)) throw error;
    const now = Date.now();
    const local: FoodLog[] = rows.map((r, i) => ({ ...r, created_at: new Date(now + i).toISOString(), pending: true }));
    await queueInsert(local);
    return local;
  }
  return (data ?? []).map(normalize);
}

/** Verwijderde items terugzetten (ongedaan maken), met hun oorspronkelijke id, dag, maaltijd en status. */
export async function restoreLogs(logs: FoodLog[]) {
  if (!logs.length) return;
  markNutritionMutation();
  // Stond de verwijdering nog in de wachtrij? Dan die schrappen in plaats van opnieuw invoegen.
  const remaining = new Set(cancelQueuedDeletes(logs.map((l) => l.id)));
  // Een item dat zelf nog wachtte, gaat terug in de wachtrij (ook als zijn verwijdering net is
  // geschrapt: het stond toen al niet meer in de wachtrij).
  const local = logs.filter((l) => l.pending);
  if (local.length) await queueInsert(local);
  const list = logs.filter((l) => remaining.has(l.id) && !l.pending);
  if (!list.length) return;
  const { error } = await supabase.from("food_logs").insert(
    list.map((l) => ({
      id: l.id,
      date: l.date,
      meal: l.meal,
      food_id: l.food_id,
      source: l.source,
      name: l.name,
      brand: l.brand,
      grams: l.grams,
      portion_label: l.portion_label,
      per100: l.per100,
      kcal: l.kcal,
      protein: l.protein,
      carbs: l.carbs,
      fat: l.fat,
      planned: l.planned,
      created_at: l.created_at,
    })),
  );
  if (error) {
    if (!isNetworkError(error)) throw error;
    await queueInsert(list);
  }
}

/** Hoeveelheid, maaltijd, status of (bij snel toegevoegd) de waarden zelf aanpassen. */
export async function updateLog(
  log: FoodLog,
  patch: { grams?: number; meal?: Meal; planned?: boolean; per100?: Per100; name?: string; date?: string; portion_label?: string | null },
): Promise<FoodLog> {
  if (log.pending) throw new Error("Dit item wacht nog op verbinding. Aanpassen kan zodra het is verstuurd.");
  markNutritionMutation();
  const grams = patch.grams ?? log.grams;
  const per100 = patch.per100 ?? log.per100;
  const amountChanged = patch.grams != null && patch.grams !== log.grams;
  const update: Record<string, unknown> = {};
  if (patch.grams != null || patch.per100) Object.assign(update, { grams, per100, ...macrosFor(per100, grams) });
  // Een portielabel ("2 × 1 stuk") klopt niet meer na het wijzigen van de grammen.
  if (amountChanged && !isQuick(log)) update.portion_label = null;
  // Expliciet meegegeven (bijv. bij ongedaan maken) gaat altijd voor.
  if (patch.portion_label !== undefined) update.portion_label = patch.portion_label;
  if (patch.meal) update.meal = patch.meal;
  if (patch.planned != null) update.planned = patch.planned;
  if (patch.date && patch.date !== log.date) {
    update.date = patch.date;
    // Naar een dag in de toekomst = een planning. Terug naar vandaag of eerder: status blijft.
    if (patch.date > toISODate()) update.planned = true;
  }
  if (patch.name?.trim()) update.name = patch.name.trim();
  const { data, error } = await supabase.from("food_logs").update(update).eq("id", log.id).select("*").single();
  if (error) throw error;
  return normalize(data);
}

export async function updateLogGrams(log: FoodLog, grams: number) {
  await updateLog(log, { grams });
}

export async function deleteLog(id: string) {
  await deleteLogs([id]);
}

export async function deleteLogs(ids: string[]) {
  if (!ids.length) return;
  markNutritionMutation();
  // Wat nog in de wachtrij stond, heeft de server nooit gezien: daar alleen uit de wachtrij halen.
  const remote = dropLocal(ids);
  if (!remote.length) return;
  const { error } = await supabase.from("food_logs").delete().in("id", remote);
  if (error) {
    if (!isNetworkError(error)) throw error;
    await queueDelete(remote);
  }
}

/** Gepland eten bevestigen: het telt vanaf nu mee. */
export async function confirmLog(id: string) {
  await confirmLogs([id]);
}

export async function confirmLogs(ids: string[]) {
  if (!ids.length) return;
  markNutritionMutation();
  const remote = confirmLocal(ids);
  if (!remote.length) return;
  const { error } = await supabase.from("food_logs").update({ planned: false }).in("id", remote);
  if (error) {
    if (!isNetworkError(error)) throw error;
    await queueConfirm(remote);
  }
}

/** Telt mee in de totalen: bevestigd eten, of alles bij een dag in de toekomst (als planning). */
export function counts(log: FoodLog, today: string = toISODate()) {
  return !log.planned || log.date > today;
}

/** Vezels in een item (alleen als het product vezels kent). */
export function fiberOf(l: FoodLog): number | null {
  const f = l.per100.fiber;
  return f == null ? null : (Number(f) * l.grams) / 100;
}

/* ───────── Producten ───────── */

/** Een gelogd item weer als product (voor recent, kopiëren en opslaan als maaltijd). */
export function logToFood(l: FoodLog): Food {
  return { id: l.food_id, source: l.source, name: l.name, brand: l.brand, per100: l.per100, portions: [] };
}

/** Snelle invoer: een "product" van precies 100 g met de opgegeven totalen. */
export function quickFood(name: string, m: Macros): Food {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `quick:${id}`,
    source: "custom",
    name: name.trim() || "Snelle invoer",
    per100: { kcal: Math.round(m.kcal), protein: m.protein, carbs: m.carbs, fat: m.fat },
    portions: [],
  };
}

/** Laatst gelogde verschillende producten (zonder snelle invoer). */
export async function fetchRecent(limit = 20): Promise<{ food: Food; grams: number }[]> {
  const { data, error } = await supabase.from("food_logs").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  const seen = new Set<string>();
  const out: { food: Food; grams: number }[] = [];
  for (const row of (data ?? []).map(normalize)) {
    if (seen.has(row.food_id) || isQuick(row)) continue;
    seen.add(row.food_id);
    out.push({ food: logToFood(row), grams: row.grams });
    if (out.length >= limit) break;
  }
  return out;
}

/** Een product dat je vaak bij een maaltijd logt, met de laatst gebruikte hoeveelheid. */
export type FrequentItem = { food: Food; grams: number; portion_label: string | null; count: number };

/**
 * Per maaltijd de producten die je het vaakst logt (laatste ~300 items), voor één-tik-toevoegen.
 * Alleen producten die minstens twee keer bij die maaltijd stonden.
 */
export async function fetchFrequent(perMeal = 5): Promise<Record<Meal, FrequentItem[]>> {
  const { data, error } = await supabase.from("food_logs").select("*").order("created_at", { ascending: false }).limit(300);
  if (error) throw error;
  const byMeal: Record<Meal, Map<string, FrequentItem>> = { breakfast: new Map(), lunch: new Map(), dinner: new Map(), snack: new Map() };
  for (const row of (data ?? []).map(normalize)) {
    if (isQuick(row) || row.planned) continue;
    const map = byMeal[row.meal];
    if (!map) continue;
    const hit = map.get(row.food_id);
    // Nieuwste eerst: de eerste keer dat we een product zien, is de laatst gebruikte hoeveelheid.
    if (hit) hit.count++;
    else map.set(row.food_id, { food: logToFood(row), grams: row.grams, portion_label: row.portion_label, count: 1 });
  }
  const top = (m: Map<string, FrequentItem>) =>
    [...m.values()]
      .filter((x) => x.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, perMeal);
  return { breakfast: top(byMeal.breakfast), lunch: top(byMeal.lunch), dinner: top(byMeal.dinner), snack: top(byMeal.snack) };
}

export async function fetchFavorites(): Promise<Food[]> {
  const { data, error } = await supabase.from("food_favorites").select("food").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => r.food as Food);
}

export async function setFavorite(food: Food, on: boolean) {
  const { error } = on
    ? await supabase.from("food_favorites").upsert({ food_id: food.id, food }, { onConflict: "user_id,food_id" })
    : await supabase.from("food_favorites").delete().eq("food_id", food.id);
  if (error) throw error;
}

type CustomRow = { id: string; name: string; brand: string | null; barcode: string | null; per100: unknown; portions: unknown };

function customToFood(r: CustomRow): Food {
  return {
    id: `custom:${r.id}`,
    source: "custom" as const,
    name: r.name,
    brand: r.brand,
    barcode: r.barcode,
    per100: r.per100 as Per100,
    portions: (r.portions as Food["portions"]) ?? [],
  };
}

export async function fetchCustomFoods(): Promise<Food[]> {
  const { data, error } = await supabase.from("custom_foods").select("*").order("name");
  if (error) throw error;
  return (data ?? []).map((r) => customToFood(r as CustomRow));
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

type CustomFields = { name: string; brand?: string; barcode?: string; per100: Per100; portions: Food["portions"] };

const customUuid = (food: Pick<Food, "id">) => food.id.replace(/^custom:/, "");

/** Eigen product aanpassen; ook de kopie in je favorieten wordt bijgewerkt. Het dagboek blijft zoals het was. */
export async function updateCustomFood(food: Food, f: CustomFields): Promise<Food> {
  if (food.source !== "custom" || food.id.startsWith("quick:")) throw new Error("Alleen eigen producten kun je aanpassen.");
  const row = { name: f.name, brand: f.brand || null, barcode: f.barcode || null, per100: f.per100, portions: f.portions };
  const { error } = await supabase.from("custom_foods").update(row).eq("id", customUuid(food));
  if (error) throw error;
  const updated: Food = { id: food.id, source: "custom", ...row };
  // Favoriet bijwerken als die bestaat (geen fout als hij er niet is).
  const fav = await supabase.from("food_favorites").update({ food: updated }).eq("food_id", food.id);
  if (fav.error) throw fav.error;
  return updated;
}

/** Eigen product verwijderen (en uit je favorieten halen). Gelogde items blijven staan. */
export async function deleteCustomFood(food: Food) {
  const { error } = await supabase.from("custom_foods").delete().eq("id", customUuid(food));
  if (error) throw error;
  const fav = await supabase.from("food_favorites").delete().eq("food_id", food.id);
  if (fav.error) throw fav.error;
}

export async function findCustomByBarcode(code: string): Promise<Food | null> {
  const { data, error } = await supabase.from("custom_foods").select("*").eq("barcode", code).limit(1).maybeSingle();
  if (error) throw error;
  return data ? customToFood(data as CustomRow) : null;
}

/* ───────── Opgeslagen maaltijden ───────── */

export async function fetchSavedMeals(): Promise<SavedMeal[]> {
  const { data, error } = await supabase.from("saved_meals").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as SavedMeal[];
}

export async function saveMeal(name: string, logs: FoodLog[]) {
  const items = logs.map((l) => ({ food: logToFood(l), grams: l.grams, portion_label: l.portion_label }));
  const { error } = await supabase.from("saved_meals").insert({ name, items });
  if (error) throw error;
}

export async function deleteSavedMeal(id: string) {
  const { error } = await supabase.from("saved_meals").delete().eq("id", id);
  if (error) throw error;
}

/* ───────── Foto ───────── */

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
