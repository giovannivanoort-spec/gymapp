/**
 * Open Food Facts: merkproducten zoeken en barcodes opzoeken (draait in de browser).
 *
 * - Barcode: https://world.openfoodfacts.org/api/v2/product/{code}.json
 * - Zoeken:  https://search.openfoodfacts.org/search (search-a-licious)
 *
 * Browsers kunnen geen User-Agent zetten; houd het aantal requests dus bescheiden
 * (de aanroeper debouncet zoekopdrachten).
 */
import type { Food, Portion } from "./types";

export const OFF_ATTRIBUTION = "Productgegevens: Open Food Facts (ODbL)";

const PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product/";
const SEARCH_URL = "https://search.openfoodfacts.org/search";
const PRODUCT_FIELDS =
  "code,product_name,product_name_nl,brands,nutriments,serving_size,serving_quantity,quantity";
const SEARCH_FIELDS =
  "code,product_name,product_name_nl,brands,nutriments,serving_quantity,serving_size,quantity,countries_tags";
const PAGE_SIZE = 25;
/** Minder geldige NL/BE-resultaten dan dit? Dan vullen we aan met een wereldwijde zoekopdracht. */
const MIN_LOCAL_RESULTS = 8;
const MAX_NAME_LENGTH = 80;
const LOCAL_COUNTRIES = ["en:netherlands", "en:belgium"];

/** Ruwe productvorm zoals beide OFF-API's die teruggeven (brands is string óf array). */
export type OffProduct = {
  code?: string | number;
  product_name?: string;
  product_name_nl?: string;
  brands?: string | string[];
  nutriments?: Record<string, unknown>;
  serving_size?: string;
  serving_quantity?: number | string;
  quantity?: string;
  countries_tags?: string[];
};

/* ───────── Helpers ───────── */

const round1 = (n: number) => Math.round(n * 10) / 10;

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function cleanText(s: string | undefined | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function formatName(raw: string): string {
  const s = cleanText(raw);
  if (s.length <= MAX_NAME_LENGTH) return s;
  const cut = s.slice(0, MAX_NAME_LENGTH - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > MAX_NAME_LENGTH * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function firstBrand(brands: OffProduct["brands"]): string | null {
  const list = Array.isArray(brands) ? brands : typeof brands === "string" ? brands.split(",") : [];
  for (const b of list) {
    const c = cleanText(b);
    if (c) return c.length > 40 ? `${c.slice(0, 39).trimEnd()}…` : c;
  }
  return null;
}

function fmtAmount(n: number): string {
  return String(round1(n)).replace(".", ",");
}

/** "250 g", "330 ml", "1,5 l", "400 g ℮" → grammen (ml telt als gram). Multipacks ("6 x 33 cl") → null. */
function parseQuantity(q: string | undefined): { grams: number; display: string } | null {
  if (!q) return null;
  const s = cleanText(q).toLowerCase().replace(/℮/g, "e");
  if (/\d\s*[x×*]\s*\d/.test(s)) return null;
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|gr|gram|grams|ml|cl|dl|l|ltr|liter|litre)\.?(?:\s+e)?$/);
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2];
  const factor: Record<string, number> = {
    kg: 1000, g: 1, gr: 1, gram: 1, grams: 1,
    ml: 1, cl: 10, dl: 100, l: 1000, ltr: 1000, liter: 1000, litre: 1000,
  };
  const grams = value * factor[unit];
  const isVolume = ["ml", "cl", "dl", "l", "ltr", "liter", "litre"].includes(unit);
  const display = isVolume
    ? grams >= 1000 ? `${fmtAmount(grams / 1000)} l` : `${fmtAmount(grams)} ml`
    : grams >= 1000 ? `${fmtAmount(grams / 1000)} kg` : `${fmtAmount(grams)} g`;
  return { grams: round1(grams), display };
}

function buildPortions(p: OffProduct): Portion[] {
  const portions: Portion[] = [];
  const serving = num(p.serving_quantity);
  if (serving != null && serving > 0 && serving <= 2000) {
    const grams = round1(serving);
    const size = cleanText(p.serving_size);
    portions.push({ label: `1 portie (${size || `${fmtAmount(grams)} g`})`, grams });
  }
  const pack = parseQuantity(p.quantity);
  if (pack && pack.grams <= 1000 && !portions.some((x) => Math.abs(x.grams - pack.grams) < 1)) {
    portions.push({ label: `hele verpakking (${pack.display})`, grams: pack.grams });
  }
  return portions;
}

/** Zet een OFF-product om naar een Food; null bij ontbrekende of onmogelijke voedingswaarden. */
export function mapOffProduct(p: OffProduct): Food | null {
  const code = cleanText(p.code == null ? "" : String(p.code));
  if (!/^\d{4,14}$/.test(code)) return null;

  const name = formatName(cleanText(p.product_name_nl) || cleanText(p.product_name));
  if (!name) return null;

  const n = p.nutriments ?? {};
  const kcalDirect = num(n["energy-kcal_100g"]);
  const kj = num(n["energy-kj_100g"]) ?? num(n["energy_100g"]);
  const kcal = kcalDirect ?? (kj != null ? kj / 4.184 : null);
  const protein = num(n["proteins_100g"]);
  const carbs = num(n["carbohydrates_100g"]);
  const fat = num(n["fat_100g"]);
  if (kcal == null || protein == null || carbs == null || fat == null) return null;

  const fiber = num(n["fiber_100g"]);
  const sugar = num(n["sugars_100g"]);

  // Onmogelijke waarden eruit filteren.
  if (kcal < 0 || kcal > 950) return null;
  if ([protein, carbs, fat].some((v) => v < 0 || v > 100)) return null;
  if (protein + carbs + fat > 105) return null;
  if (sugar != null && (sugar < 0 || sugar > carbs + 1)) return null;
  if (fiber != null && (fiber < 0 || fiber > 100)) return null;

  return {
    id: `off:${code}`,
    source: "off",
    name,
    brand: firstBrand(p.brands),
    barcode: code,
    per100: {
      kcal: Math.round(kcal),
      protein: round1(protein),
      carbs: round1(carbs),
      fat: round1(fat),
      fiber: fiber != null ? round1(fiber) : null,
      sugar: sugar != null ? round1(sugar) : null,
    },
    portions: buildPortions(p),
  };
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

async function getJson(url: string, signal?: AbortSignal): Promise<{ status: number; data: unknown }> {
  let res: Response;
  // In de browser via onze eigen server: de zoek-API staat geen verzoeken van andere sites toe (CORS),
  // en zo kan de server zich bij Open Food Facts identificeren.
  const target = typeof window === "undefined" ? url : `/api/off?url=${encodeURIComponent(url)}`;
  try {
    res = await fetch(target, { signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new Error("Geen verbinding met Open Food Facts. Check je internet en probeer het opnieuw.");
  }
  if (res.status === 404) return { status: 404, data: null };
  if (!res.ok) {
    throw new Error(
      res.status === 429
        ? "Te veel zoekopdrachten bij Open Food Facts. Wacht even en probeer het opnieuw."
        : `Open Food Facts is even niet bereikbaar (fout ${res.status}). Probeer het later opnieuw.`,
    );
  }
  try {
    return { status: res.status, data: await res.json() };
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new Error("Onverwacht antwoord van Open Food Facts. Probeer het later opnieuw.");
  }
}

/* ───────── Publieke API ───────── */

/** Zoek één product op via de barcode (EAN/UPC). null als het product onbekend is of geen bruikbare voedingswaarden heeft. */
export async function lookupBarcode(code: string, opts?: { signal?: AbortSignal }): Promise<Food | null> {
  const clean = code.replace(/\D/g, "");
  if (clean.length < 6 || clean.length > 14) return null;
  const found = await fetchProduct(clean, opts?.signal);
  if (found !== undefined) return found;
  // UPC-A (12 cijfers) staat bij OFF vaak als EAN-13 met een voorloopnul.
  if (clean.length === 12) return (await fetchProduct(`0${clean}`, opts?.signal)) ?? null;
  return null;
}

/** undefined = product onbekend, null = bekend maar onbruikbaar (geen/onmogelijke voedingswaarden). */
async function fetchProduct(code: string, signal?: AbortSignal): Promise<Food | null | undefined> {
  const { data } = await getJson(`${PRODUCT_URL}${code}.json?fields=${PRODUCT_FIELDS}`, signal);
  const body = data as { status?: number; product?: OffProduct } | null;
  if (!body || body.status !== 1 || !body.product) return undefined;
  return mapOffProduct({ ...body.product, code: body.product.code ?? code });
}

/** Maak een vrije zoekterm veilig voor de Lucene-achtige querytaal van search-a-licious. */
function sanitizeQuery(q: string): string {
  return cleanText(
    q
      .replace(/[+\-!(){}[\]^"~*?:\\/&|<>=]/g, " ")
      .replace(/\b(AND|OR|NOT)\b/g, (w) => w.toLowerCase()),
  );
}

async function searchOnce(q: string, signal?: AbortSignal): Promise<OffProduct[]> {
  const params = new URLSearchParams({
    q,
    langs: "nl,en",
    page_size: String(PAGE_SIZE),
    fields: SEARCH_FIELDS,
  });
  const { data } = await getJson(`${SEARCH_URL}?${params}`, signal);
  const hits = (data as { hits?: unknown } | null)?.hits;
  return Array.isArray(hits) ? (hits as OffProduct[]) : [];
}

const isLocal = (p: OffProduct) =>
  Array.isArray(p.countries_tags) && p.countries_tags.some((c) => LOCAL_COUNTRIES.includes(c));

/**
 * Zoek merkproducten. Eerst binnen Nederland/België; zijn dat er weinig, dan vullen we aan
 * met wereldwijde resultaten. NL/BE-producten staan altijd bovenaan.
 */
export async function searchProducts(query: string, opts?: { signal?: AbortSignal }): Promise<Food[]> {
  const q = sanitizeQuery(query);
  if (q.length < 2) return [];
  const signal = opts?.signal;

  const countryFilter = `countries_tags:(${LOCAL_COUNTRIES.map((c) => `"${c}"`).join(" OR ")})`;
  const local = await searchOnce(`${q} ${countryFilter}`, signal);

  const seen = new Set<string>();
  const ranked: { food: Food; local: boolean }[] = [];
  const add = (list: OffProduct[]) => {
    for (const p of list) {
      const food = mapOffProduct(p);
      if (!food || seen.has(food.id)) continue;
      seen.add(food.id);
      ranked.push({ food, local: isLocal(p) });
    }
  };
  add(local);

  if (ranked.length < MIN_LOCAL_RESULTS) {
    add(await searchOnce(q, signal));
  }

  // Stabiele sortering: NL/BE eerst, verder de relevantievolgorde van de API.
  return ranked
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => Number(b.local) - Number(a.local) || a.i - b.i)
    .slice(0, PAGE_SIZE)
    .map((r) => r.food);
}
