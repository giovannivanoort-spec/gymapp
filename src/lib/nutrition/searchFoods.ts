import type { Food } from "./types";
import foods from "./foods-basis.json";

/**
 * Basis-voedingsmiddelen (generieke producten), afgeleid van USDA FoodData Central
 * SR Legacy (publiek domein), met Nederlandse namen en porties.
 */
const BASIS_FOODS = foods as Food[];

/** Lowercase, zonder accenten/apostroffen, alleen letters en cijfers gescheiden door één spatie. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Genormaliseerde tekst met losse woorden, één keer vooraf berekend (niet bij elke letter). */
export type NormText = { norm: string; words: string[] };

export function normText(s: string): NormText {
  const norm = normalizeText(s);
  return { norm, words: norm ? norm.split(" ") : [] };
}

/**
 * Hoe goed `name` past bij `query` (accent- en hoofdletterongevoelig), lager is beter, null is
 * geen match: 0 exact, 1 begint met de zoekterm als heel woord, 2 begint met de zoekterm, 3 alle
 * woorden als heel woord, 4 alle woorden als woordbegin, 5 alle woorden ergens in de naam.
 * Beide mogen al genormaliseerd zijn (`normText`): voor lijsten die je bij elke letter doorzoekt,
 * normaliseer je de namen één keer vooraf.
 */
export function matchRank(name: string | NormText, query: string | NormText): number | null {
  const n = typeof name === "string" ? normText(name) : name;
  const q = typeof query === "string" ? normText(query) : query;
  if (!q.norm || !n.norm) return null;
  if (!q.words.every((w) => n.norm.includes(w))) return null;
  if (n.norm === q.norm) return 0;
  if (n.norm.startsWith(q.norm + " ")) return 1;
  if (n.norm.startsWith(q.norm)) return 2;
  if (q.words.every((w) => n.words.includes(w))) return 3;
  if (q.words.every((w) => n.words.some((x) => x.startsWith(w)))) return 4;
  return 5;
}

/** Vooraf genormaliseerde naam, merk en merk + naam van een product (zie `rankIndexed`). */
export type FoodIndex = { name: NormText; brand: NormText | null; both: NormText | null };

export function indexFood(f: Pick<Food, "name" | "brand">): FoodIndex {
  return { name: normText(f.name), brand: f.brand ? normText(f.brand) : null, both: f.brand ? normText(`${f.brand} ${f.name}`) : null };
}

/** Een treffer alleen op het merk komt na alle treffers op de naam (die hebben rang 0 t/m 5). */
const BRAND_ONLY = 6;

/**
 * Rang van een product uit je eigen lijsten (eerder gegeten, mijn producten) voor een zoekterm,
 * lager is beter, null is geen match. Zelfde rangorde als de basisproducten (`matchRank`), eerst
 * op de naam; een treffer alleen op het merk ("melk" in "Melkunie") komt daarna. Een zoekterm
 * verdeeld over merk en naam ("ah skyr") telt als treffer op de naam. Bij één teken telt alleen
 * een woordbegin (rang 0 t/m 4): "ergens in de naam" geldt dan voor bijna alles.
 */
export function rankIndexed(idx: FoodIndex, q: NormText): number | null {
  if (!q.norm) return null;
  const maxRank = q.norm.length < 2 ? 4 : 5;
  const rank = (t: NormText | null) => {
    const r = t ? matchRank(t, q) : null;
    return r !== null && r <= maxRank ? r : null;
  };
  const name = rank(idx.name);
  if (name !== null) return name;
  const brand = rank(idx.brand);
  if (brand !== null) return brand + BRAND_ONLY;
  return rank(idx.both);
}

type Entry = { food: Food; norm: string; words: string[] };

const ENTRIES: Entry[] = BASIS_FOODS.map((food) => {
  const norm = normalizeText(food.name);
  return { food, norm, words: norm.split(" ") };
});

const BY_ID = new Map<string, Food>(BASIS_FOODS.map((f) => [f.id, f]));

/**
 * Zoekt in de basis-voedingsmiddelen (accent- en hoofdletterongevoelig).
 * Volgorde: exacte match, naam begint met de zoekterm (als heel woord eerst),
 * alle woorden als heel woord, alle woorden als woordbegin, daarna overige substring-matches.
 * Bij meerdere woorden moeten alle woorden voorkomen. Kortere namen gaan voor bij gelijke rang.
 */
export function searchBasisFoods(query: string, limit = 30): Food[] {
  const q = normText(query);
  if (!q.norm || limit <= 0) return [];

  const hits: { e: Entry; rank: number }[] = [];
  for (const e of ENTRIES) {
    const rank = matchRank(e, q);
    if (rank !== null) hits.push({ e, rank });
  }

  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.e.norm.length - b.e.norm.length ||
      a.e.norm.localeCompare(b.e.norm),
  );
  return hits.slice(0, limit).map((h) => h.e.food);
}

/** Haalt een basis-voedingsmiddel op via id, bijv. "basis:171077". */
export function getBasisFood(id: string): Food | undefined {
  return BY_ID.get(id);
}
