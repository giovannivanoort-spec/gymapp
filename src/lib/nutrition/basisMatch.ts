import { matchRank, normText, searchBasisFoods } from "./searchFoods";
import type { Per100 } from "./types";

/**
 * Basisproduct bij een AI-schatting: een generiek product met (bijna) dezelfde naam, waarvan je de
 * waarden per 100 g in plaats van de schatting kunt gebruiken. Alleen voor de app (PhotoEstimate);
 * de server heeft de basislijst niet nodig.
 */
export type Basis = { name: string; per100: Per100 };

/**
 * Woorden die een andere staat dan "zo gegeten" aangeven. De schatting gaat over wat er op je bord lag
 * (bereid), dus "Pasta" mag niet op "Pasta (ongekookt)" uitkomen en "Kipfilet" niet op "Kipfilet
 * (rauw)": dat scheelt al snel twee tot drie keer zoveel kcal per 100 g.
 */
const UNPREPARED = new Set(["rauw", "droog", "gedroogd", "ongekookt", "onbereid", "ongebakken", "poeder"]);

/**
 * Hoeveel keer zoveel kcal per 100 g de ene waarde is als de andere (altijd 1 of meer). Onder de 20
 * kcal telt als 20: bij groente of light-frisdrank is 4 tegen 9 kcal geen echt verschil.
 */
export const kcalRatio = (a: number, b: number) => Math.max(20, a, b) / Math.max(20, Math.min(a, b));

/** Vanaf dit verschil kleurt de kcal van het basisproduct als waarschuwing. */
export const KCAL_WARN_RATIO = 1.5;

/**
 * Vanaf dit verschil is het basisproduct geen verfijning meer maar iets anders, meestal een andere
 * staat van hetzelfde product ("Havermout" droog, 389 kcal, terwijl de schatting over pap gaat): dan
 * geen voorstel.
 */
const KCAL_SKIP_RATIO = 2;

/** Hoeveel kandidaten we bekijken: genoeg voor alle varianten van één product ("Kipfilet (...)"). */
const CANDIDATES = 10;

/**
 * Alleen een exacte naam (rang 0) of een naam die met de hele zoekterm als woord begint (rang 1,
 * "Pindakaas" vindt "Pindakaas (grof)"), en bij rang 1 alleen als de extra woorden geen andere staat
 * noemen (zie UNPREPARED). Rang 2 is een los voorvoegsel ("kaas" in "Kaasstengels"): dat kan een
 * ander product zijn, dus dan geen voorstel. Een kandidaat waarvan de kcal per 100 g twee keer of meer
 * van de schatting afwijkt, slaan we over (zie KCAL_SKIP_RATIO), ook bij een exacte naam. Van wat
 * overblijft de variant die qua kcal het dichtst bij de schatting ligt: zo wordt "Havermout" (pap,
 * ~70 kcal) "Havermout (gekookt met water)" en "Kipfilet" (~150) "Kipfilet (gegrild)" in plaats van
 * het beleg. Bij gelijke afstand de gewone zoekvolgorde (rang, dan kortste naam).
 */
export function basisMatch(name: string, kcal: number): Basis | undefined {
  const q = normText(name);
  if (!q.norm) return undefined;
  let best: { basis: Basis; ratio: number } | undefined;
  for (const food of searchBasisFoods(name, CANDIDATES)) {
    const rank = matchRank(food.name, q);
    // searchBasisFoods sorteert op rang: na de eerste rang boven 1 komt er niets bruikbaars meer. Een
    // kandidaat zonder rang (hoort niet voor te komen) slaan we alleen over, zonder te stoppen.
    if (rank === null) continue;
    if (rank > 1) break;
    const extra = normText(food.name).words.slice(q.words.length);
    if (rank === 1 && extra.some((w) => UNPREPARED.has(w))) continue;
    const ratio = kcalRatio(food.per100.kcal, kcal);
    if (ratio < KCAL_SKIP_RATIO && (!best || ratio < best.ratio)) best = { basis: { name: food.name, per100: food.per100 }, ratio };
  }
  return best?.basis;
}
