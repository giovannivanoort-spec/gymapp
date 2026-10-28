import type { Food } from "./types";
import foods from "./foods-basis.json";

/**
 * Basis-voedingsmiddelen (generieke producten), afgeleid van USDA FoodData Central
 * SR Legacy (publiek domein), met Nederlandse namen en porties.
 */
const BASIS_FOODS = foods as Food[];

/** Lowercase, zonder accenten/apostroffen, alleen letters en cijfers gescheiden door één spatie. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type Entry = { food: Food; norm: string; words: string[] };

const ENTRIES: Entry[] = BASIS_FOODS.map((food) => {
  const norm = normalize(food.name);
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
  const q = normalize(query);
  if (!q || limit <= 0) return [];
  const qWords = q.split(" ");

  const hits: { e: Entry; rank: number }[] = [];
  for (const e of ENTRIES) {
    if (!qWords.every((w) => e.norm.includes(w))) continue;
    let rank: number;
    if (e.norm === q) rank = 0;
    else if (e.norm.startsWith(q + " ")) rank = 1;
    else if (e.norm.startsWith(q)) rank = 2;
    else if (qWords.every((w) => e.words.includes(w))) rank = 3;
    else if (qWords.every((w) => e.words.some((x) => x.startsWith(w)))) rank = 4;
    else rank = 5;
    hits.push({ e, rank });
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
