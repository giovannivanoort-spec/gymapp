import standardsJson from "./strength-standards.json";
import { EXERCISE_BY_SLUG, isTimed } from "./exercises";
import { GROUP_BY_ID, MUSCLE_BY_ID, MUSCLE_GROUPS, type MuscleGroupId } from "./muscles";

/**
 * Ranks per oefening op basis van krachtstandaarden van StrengthLevel.com (per oefening, geslacht
 * en lichaamsgewicht). Grenzen: Beginner → Zilver, Novice → Goud, Intermediate → Platina,
 * Advanced → Diamant, Elite → Elite, en één Elite-stap verder → Olympiër.
 *
 * Oefeningen zonder StrengthLevel-data hebben een afgeleide of geschatte standaard (zie
 * scripts/derive-standards.mjs): een vergelijkbare oefening x factor, of een eigen schatting voor
 * statische houdingen (seconden), dragen/duwen (zwaarste gewicht) en bandoefeningen.
 */

export type Sex = "male" | "female";
export type RankUnit = "kg" | "reps" | "seconds";

/** [lichaamsgewicht, beginner, novice, intermediate, advanced, elite] */
type Row = number[];
type Standard = {
  /** StrengthLevel-slug, "derived:<onze slug>" of "spotter-estimate". */
  source: string;
  /** Bij een afgeleide standaard: de oefening waarop hij gebaseerd is. */
  basedOn?: string;
  title?: string;
  /** kg = 1RM (of zie scoring), reps = max reps zonder gewicht, seconds = langste set (reps = seconden). */
  unit: RankUnit;
  /** Alleen bij kg: "load" = zwaarste gewicht van een set, "assisted" = gewicht is ondersteuning. */
  scoring?: "load" | "assisted";
  /** Reps tellen ook als er gewicht bij gelogd is (band, vest). */
  anyWeight?: boolean;
  /** Alleen bij kg (1RM): sets tot zoveel reps tellen mee (standaard 12), voor hoge-repsoefeningen. */
  maxReps?: number;
  male: Row[];
  female: Row[];
  /** Alleen bij lichaamsgewicht-oefeningen: 1RM aan extra gewicht (kg). */
  maleAdded?: Row[];
  femaleAdded?: Row[];
  /** Per leeftijd (bij gemiddeld lichaamsgewicht): [leeftijd, beginner, …, elite]. */
  ageMale?: Row[];
  ageFemale?: Row[];
  ageMaleAdded?: Row[];
  ageFemaleAdded?: Row[];
};

const STANDARDS = standardsJson as Record<string, Standard | null>;

export const TIERS = [
  { id: "bronze", name: "Brons", from: "#9a5b2c", to: "#e4a671" },
  { id: "silver", name: "Zilver", from: "#7c8794", to: "#e9eef4" },
  { id: "gold", name: "Goud", from: "#b8860b", to: "#ffe27a" },
  { id: "platinum", name: "Platina", from: "#2a9d94", to: "#b8f3ec" },
  { id: "diamond", name: "Diamant", from: "#3d63e6", to: "#c3d3ff" },
  { id: "elite", name: "Elite", from: "#7b3fe4", to: "#e3ccff" },
  { id: "olympian", name: "Olympiër", from: "#e0313f", to: "#ffc857" },
] as const;

export type Tier = (typeof TIERS)[number];

export type LogLike = { weight: number | null; reps: number | null };

export type ExerciseRank = {
  slug: string;
  /** 0..7: tier-index plus voortgang binnen de tier (Olympiër: 6..7). */
  score: number;
  tier: Tier;
  tierIndex: number;
  /** Voortgang naar de volgende tier, 0..1. */
  progress: number;
  unit: RankUnit;
  /** Beste prestatie: geschatte 1RM (kg), zwaarste gewicht (viaLoad), aantal reps of seconden. */
  value: number;
  /** Wat nodig is voor de volgende tier (zelfde eenheid), of null bij de hoogste tier. */
  nextAt: number | null;
  /** Bij reps-oefeningen met extra gewicht: rang behaald met extra gewicht. */
  viaAdded?: boolean;
  /** kg: zwaarste gewicht van een set (dragen, duwen, swings), geen 1RM-schatting. */
  viaLoad?: boolean;
  /** kg: effectieve 1RM met ondersteuning (lichaamsgewicht min hulp), bijv. assisted pull-up. */
  assisted?: boolean;
  /** Bij assisted: het gebruikte lichaamsgewicht (voor een voorbeeldset). */
  bodyweight?: number;
};

/** Oefening op een assisted machine: het gelogde gewicht is ondersteuning (minder is beter). */
export function isAssisted(slug: string | null | undefined): boolean {
  return !!slug && STANDARDS[slug]?.scoring === "assisted";
}

/** Oefening waarbij de rang op het zwaarste gewicht van een set gaat (dragen, duwen), geen 1RM-schatting. */
export function isLoadScored(slug: string | null | undefined): boolean {
  return !!slug && STANDARDS[slug]?.scoring === "load";
}

/** Gewicht waartegen ondersteuning wordt afgezet voor onderlinge vergelijking (geen lichaamsgewicht nodig). */
const ASSIST_REF = 100;

/**
 * Vergelijkingsscore voor een assisted set: minder ondersteuning of meer reps is hoger. Alleen om
 * sets van dezelfde persoon te rangschikken (records), niet om te tonen. null zonder reps.
 */
export function assistedScore(weight: number | null, reps: number | null): number | null {
  if (!((reps ?? 0) >= 1)) return null;
  return Math.max(1, ASSIST_REF - Math.max(0, weight ?? 0)) * (1 + reps! / 30);
}

export function hasStandard(slug: string): boolean {
  return !!STANDARDS[slug];
}

/**
 * Herkomst van de standaard: van StrengthLevel, of een schatting (eventueel op basis van een
 * vergelijkbare oefening). null als er geen standaard is.
 */
export function standardInfo(slug: string): { estimated: boolean; basedOn: string | null } | null {
  const std = STANDARDS[slug];
  if (!std) return null;
  const estimated = std.source.startsWith("derived:") || std.source === "spotter-estimate";
  return { estimated, basedOn: estimated ? (std.basedOn ?? null) : null };
}

/**
 * Bovengrens voor het reps-veld van een set, tegen typfouten: seconden bij statische houdingen
 * (tot een uur), anders 100 reps, of ruim boven de Elite-grens als de standaard hoger ligt
 * (bijv. bodyweight squats, crunches).
 */
export function maxRepsFor(slug: string | null | undefined): number {
  if (isTimed(slug)) return 3600;
  const std = slug ? STANDARDS[slug] : null;
  if (!std || std.unit !== "reps") return 100;
  const elite = Math.max(0, ...std.male.map((r) => r[5]), ...std.female.map((r) => r[5]));
  return Math.max(100, Math.ceil((elite * 1.5) / 50) * 50);
}

/**
 * Geschatte 1RM (Epley). Boven de 12 reps wordt de schatting onbetrouwbaar; die sets tellen niet
 * mee, behalve bij oefeningen die je vrijwel altijd met hoge reps doet (`maxReps`, tot 30).
 */
export function estimate1RM(weight: number, reps: number, maxReps = 12): number | null {
  if (!(weight > 0) || !(reps >= 1) || reps > maxReps) return null;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

/** Grenzen [beg, nov, int, adv, elite] bij dit lichaamsgewicht (lineair geïnterpoleerd). */
function levelsAt(rows: Row[], bw: number): number[] {
  if (bw <= rows[0][0]) return rows[0].slice(1);
  const last = rows[rows.length - 1];
  if (bw >= last[0]) return last.slice(1);
  const i = rows.findIndex((r) => r[0] >= bw);
  const [a, b] = [rows[i - 1], rows[i]];
  const t = (bw - a[0]) / (b[0] - a[0]);
  return a.slice(1).map((v, k) => v + (b[k + 1] - v) * t);
}

/** Referentieleeftijd: tussen 25 en 40 zijn de standaarden gelijk. */
const REFERENCE_AGE = 30;

/**
 * Past grenzen aan voor leeftijd met de leeftijdstabel van de oefening. Gewichten (kg) schalen
 * naar verhouding; reps en extra gewicht (kunnen 0 of negatief zijn) met het verschil.
 */
function adjustForAge(levels: number[], ageRows: Row[] | undefined, age: number | null | undefined, mode: "ratio" | "delta"): number[] {
  if (!ageRows || age == null) return levels;
  const at = levelsAt(ageRows, Math.min(90, Math.max(15, age)));
  const ref = levelsAt(ageRows, REFERENCE_AGE);
  return levels.map((v, k) => (mode === "ratio" ? (ref[k] > 0 ? (v * at[k]) / ref[k] : v) : v + (at[k] - ref[k])));
}

/** Tier-grenzen: [Zilver, Goud, Platina, Diamant, Elite, Olympiër]. */
function thresholds(levels: number[]): number[] {
  // Nooit dalend: de leeftijdscorrectie in reps (verschil-modus) kan op hoge leeftijd een lagere
  // grens boven een hogere zetten. Dat verandert geen tier, maar wel de voortgang en de ladder.
  const [beg, nov, int, adv, elite] = levels.map((v, k) => Math.max(v, ...levels.slice(0, k)));
  return [beg, nov, int, adv, elite, elite + Math.max(elite - adv, 1)];
}

/** Hoogste score: net onder TIERS.length, zodat floor(score) altijd een geldige tier-index is. */
const MAX_SCORE = TIERS.length - 0.001;

function scoreFor(value: number, th: number[]): { score: number; tierIndex: number; progress: number; nextAt: number | null } {
  let tierIndex = 0;
  while (tierIndex < th.length && value >= th[tierIndex]) tierIndex++;
  if (tierIndex >= th.length) {
    // Olympiër: score 6..7 (net als elke andere tier één punt breed), op basis van hoe ver je boven de grens zit.
    const top = th[th.length - 1];
    const step = Math.max(top - th[th.length - 2], 1e-6);
    const beyond = Math.min(1, Math.max(0, (value - top) / step));
    return { score: Math.min(MAX_SCORE, TIERS.length - 1 + beyond), tierIndex: TIERS.length - 1, progress: 1, nextAt: null };
  }
  const lo = tierIndex === 0 ? Math.min(0, th[0]) : th[tierIndex - 1];
  const hi = th[tierIndex];
  const progress = hi > lo ? Math.min(1, Math.max(0, (value - lo) / (hi - lo))) : 0;
  return { score: tierIndex + progress, tierIndex, progress, nextAt: hi };
}

/**
 * Rang voor één oefening uit alle gelogde sets van één persoon.
 * Geeft null als er geen standaard is, profielgegevens ontbreken of er geen bruikbare set is.
 */
export function rankExercise(
  slug: string,
  logs: LogLike[],
  bodyweight: number | null,
  sex: Sex | null,
  age?: number | null,
): ExerciseRank | null {
  const std = STANDARDS[slug];
  if (!std || !bodyweight || !sex) return null;
  const male = sex === "male";

  if (std.unit === "kg") {
    const best =
      std.scoring === "load"
        ? // Zwaarste gewicht waarmee een set gedaan is (geen 1RM-schatting).
          Math.max(0, ...logs.filter((l) => (l.reps ?? 0) > 0).map((l) => l.weight ?? 0))
        : std.scoring === "assisted"
          ? // Gewicht = ondersteuning: effectieve 1RM van lichaamsgewicht min hulp (hoge reps afgetopt op 12).
            Math.max(0, ...logs.map((l) => estimate1RM(bodyweight - (l.weight ?? 0), Math.min(l.reps ?? 0, 12)) ?? 0))
          : Math.max(0, ...logs.map((l) => estimate1RM(l.weight ?? 0, l.reps ?? 0, std.maxReps) ?? 0));
    if (!(best > 0)) return null;
    const levels = adjustForAge(levelsAt(male ? std.male : std.female, bodyweight), male ? std.ageMale : std.ageFemale, age, "ratio");
    const s = scoreFor(best, thresholds(levels));
    return {
      slug,
      ...s,
      tier: TIERS[s.tierIndex],
      unit: "kg",
      value: round(best),
      ...(std.scoring === "load" && { viaLoad: true }),
      ...(std.scoring === "assisted" && { assisted: true, bodyweight }),
    };
  }

  if (std.unit === "seconds") {
    // Statische houding: de reps van een set zijn seconden; extra gewicht (vest, schijf) telt gewoon mee.
    const best = Math.max(0, ...logs.map((l) => l.reps ?? 0));
    if (!(best > 0)) return null;
    const levels = adjustForAge(levelsAt(male ? std.male : std.female, bodyweight), male ? std.ageMale : std.ageFemale, age, "ratio");
    const s = scoreFor(best, thresholds(levels));
    return { slug, ...s, tier: TIERS[s.tierIndex], unit: "seconds", value: best, nextAt: s.nextAt && Math.ceil(s.nextAt) };
  }

  // Lichaamsgewicht-oefening: beste aantal reps zonder extra gewicht, en (indien gelogd) extra gewicht.
  const bestReps = Math.max(0, ...logs.filter((l) => std.anyWeight || !(l.weight ?? 0)).map((l) => l.reps ?? 0));
  const repsLevels = adjustForAge(levelsAt(male ? std.male : std.female, bodyweight), male ? std.ageMale : std.ageFemale, age, "delta");
  const repsRank = bestReps > 0 ? scoreFor(bestReps, thresholds(repsLevels)) : null;

  const addedRows = male ? std.maleAdded : std.femaleAdded;
  const bestAdded = Math.max(
    -Infinity,
    ...logs
      .filter((l) => (l.weight ?? 0) > 0 && (l.reps ?? 0) >= 1 && (l.reps ?? 0) <= 12)
      .map((l) => (bodyweight + l.weight!) * (l.reps === 1 ? 1 : 1 + l.reps! / 30) - bodyweight),
  );
  const addedRank =
    addedRows && bestAdded > -Infinity
      ? scoreFor(bestAdded, thresholds(adjustForAge(levelsAt(addedRows, bodyweight), male ? std.ageMaleAdded : std.ageFemaleAdded, age, "delta")))
      : null;

  if (addedRank && (!repsRank || addedRank.score > repsRank.score)) {
    return { slug, ...addedRank, tier: TIERS[addedRank.tierIndex], unit: "kg", value: round(bestAdded), viaAdded: true };
  }
  if (!repsRank) return null;
  return { slug, ...repsRank, tier: TIERS[repsRank.tierIndex], unit: "reps", value: bestReps, nextAt: repsRank.nextAt && Math.ceil(repsRank.nextAt) };
}

export type GroupRank = { group: MuscleGroupId; score: number; tier: Tier; exercises: ExerciseRank[] };

export type OverallRank = {
  score: number;
  tier: Tier;
  /** Hoeveel grote spiergroepen meetellen, van het totaal aantal grote spiergroepen. */
  coverage?: { groups: number; of: number };
  /**
   * Voorlopig: minder dan de helft van de grote spiergroepen heeft een rang. De totaalrang zegt dan
   * nog weinig (wie alleen curls doet, is niet "Diamant" over de hele linie).
   */
  provisional?: boolean;
};

/** Grote spiergroepen (zie muscles.ts): daarop baseren we de dekking van de totaalrang. */
export const MAJOR_GROUPS: MuscleGroupId[] = MUSCLE_GROUPS.filter((g) => g.major).map((g) => g.id);
/** Vanaf zoveel grote spiergroepen telt de totaalrang als definitief. */
export const MIN_OVERALL_GROUPS = Math.ceil(MAJOR_GROUPS.length / 2);

/**
 * Rang per spiergroep (gemiddelde van de 3 beste oefeningen met die groep als hoofdgroep)
 * en een totaalrang (gemiddelde van de spiergroepen). Elke tier is één punt breed (Brons 0..1,
 * …, Olympiër 6..7), dus het gemiddelde valt in dezelfde tier-grenzen als een losse oefening.
 */
export function aggregateRanks(ranks: ExerciseRank[]): { groups: GroupRank[]; overall: OverallRank | null } {
  const byGroup = new Map<MuscleGroupId, ExerciseRank[]>();
  for (const r of ranks) {
    const ex = EXERCISE_BY_SLUG[r.slug];
    if (!ex) continue;
    const group = MUSCLE_BY_ID[ex.primary[0]].group;
    let list = byGroup.get(group);
    if (!list) byGroup.set(group, (list = []));
    list.push(r);
  }
  const groups: GroupRank[] = [...byGroup].map(([group, list]) => {
    const sorted = [...list].sort((a, b) => b.score - a.score);
    const top = sorted.slice(0, 3);
    const score = top.reduce((s, r) => s + r.score, 0) / top.length;
    return { group, score, tier: tierFor(score), exercises: sorted };
  });
  groups.sort((a, b) => b.score - a.score);
  if (!groups.length) return { groups, overall: null };
  const score = groups.reduce((s, g) => s + g.score, 0) / groups.length;
  const covered = groups.filter((g) => MAJOR_GROUPS.includes(g.group)).length;
  return {
    groups,
    overall: {
      score,
      tier: tierFor(score),
      coverage: { groups: covered, of: MAJOR_GROUPS.length },
      provisional: covered < MIN_OVERALL_GROUPS,
    },
  };
}

/**
 * Eerlijke vergelijking van twee personen: alleen over de spiergroepen die beiden getraind hebben.
 * `diff` > 0 betekent dat `mine` voor staat. null als er geen gedeelde spiergroepen zijn.
 */
export function compareGroups(mine: GroupRank[], theirs: GroupRank[]): { shared: number; mine: number; theirs: number; diff: number } | null {
  const other = new Map(theirs.map((g) => [g.group, g.score]));
  const shared = mine.filter((g) => other.has(g.group));
  if (!shared.length) return null;
  const a = shared.reduce((s, g) => s + g.score, 0) / shared.length;
  const b = shared.reduce((s, g) => s + other.get(g.group)!, 0) / shared.length;
  return { shared: shared.length, mine: a, theirs: b, diff: a - b };
}

/** Oefeningen die het dichtst bij hun volgende tier zitten (hoogste voortgang eerst). */
export function closestToNextTier(ranks: ExerciseRank[], n = 3): ExerciseRank[] {
  return ranks
    .filter((r) => r.nextAt != null && r.progress < 1)
    .sort((a, b) => b.progress - a.progress || b.score - a.score)
    .slice(0, n);
}

/** Bekende basisoefeningen per spiergroep, als voorbeeld om een rang te halen. */
const GROUP_SUGGESTIONS: string[] = [
  "bench-press",
  "dumbbell-bench-press",
  "overhead-press",
  "dumbbell-shoulder-press",
  "lateral-raise",
  "triceps-pushdown-rope",
  "skull-crusher",
  "dips",
  "barbell-curl",
  "dumbbell-curl",
  "lat-pulldown",
  "pull-up",
  "barbell-row",
  "seated-cable-row",
  "dumbbell-row",
  "hanging-leg-raise",
  "crunch",
  "cable-crunch",
  "hip-thrust",
  "glute-bridge",
  "back-squat",
  "leg-press",
  "leg-extension",
  "romanian-deadlift",
  "lying-leg-curl",
  "seated-leg-curl",
];

/** Een paar oefeningen met een krachtstandaard die vooral deze spiergroep trainen. */
export function rankableExercisesFor(group: MuscleGroupId, n = 2): string[] {
  const matches = (slug: string) => {
    const ex = EXERCISE_BY_SLUG[slug];
    return !!ex && !!STANDARDS[slug] && MUSCLE_BY_ID[ex.primary[0]]?.group === group;
  };
  const preferred = GROUP_SUGGESTIONS.filter(matches);
  const rest = Object.keys(STANDARDS)
    .filter((s) => matches(s) && !preferred.includes(s))
    .sort();
  return [...preferred, ...rest].slice(0, n);
}

export function tierFor(score: number): Tier {
  return TIERS[Math.min(TIERS.length - 1, Math.max(0, Math.floor(score)))];
}

/** Voortgang binnen de huidige tier (0..1); in de hoogste tier altijd vol. */
export function tierProgress(score: number): number {
  return Math.floor(score) >= TIERS.length - 1 ? 1 : Math.max(0, score % 1);
}

/** Voorbeeld-set om de volgende tier te halen, bijv. "85 kg × 5". */
export function exampleSetFor(oneRepMax: number, reps = 5): string {
  const w = oneRepMax / (1 + reps / 30);
  return `${Math.ceil(w / 2.5) * 2.5} kg × ${reps}`;
}

export function groupName(id: MuscleGroupId) {
  return GROUP_BY_ID[id].name;
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}

/** Wat nodig is per tier (vanaf Zilver) voor dit lichaamsgewicht, bijv. voor een overzicht op de oefeningpagina. */
export function tierLadder(
  slug: string,
  bodyweight: number,
  sex: Sex,
  age?: number | null,
): { unit: RankUnit; scoring: "load" | "assisted" | null; maxReps: number; steps: { tier: Tier; at: number }[] } | null {
  const std = STANDARDS[slug];
  if (!std) return null;
  const male = sex === "male";
  const levels = adjustForAge(
    levelsAt(male ? std.male : std.female, bodyweight),
    male ? std.ageMale : std.ageFemale,
    age,
    std.unit === "reps" ? "delta" : "ratio",
  );
  const th = thresholds(levels);
  return {
    unit: std.unit,
    scoring: std.scoring ?? null,
    maxReps: std.maxReps ?? 12,
    steps: th.map((at, i) => ({ tier: TIERS[i + 1], at: std.unit === "kg" ? Math.ceil(at) : Math.max(1, Math.ceil(at)) })),
  };
}

/** Hoogste effectieve 1RM op een assisted machine: 12 reps zonder ondersteuning. */
export function assistedCeiling(bodyweight: number): number {
  return bodyweight * (1 + 12 / 30);
}

const nlNum = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

/** Korte waarde in de maat van een rang: "112 kg", "+20 kg" (extra gewicht), "15 reps", "45 s". */
export function formatRankAmount(r: { unit: RankUnit; value: number; viaAdded?: boolean }): string {
  if (r.unit === "reps") return `${r.value} reps`;
  if (r.unit === "seconds") return `${r.value} s`;
  return r.viaAdded ? `${r.value < 0 ? "−" : "+"}${nlNum(Math.abs(r.value))} kg` : `${nlNum(r.value)} kg`;
}

/** Beste prestatie in woorden: "1RM ≈ 112 kg", "1RM +20 kg extra", "15 reps", "45 s", "zwaarste set 60 kg". */
export function formatRankBest(r: ExerciseRank): string {
  if (r.unit === "reps") return `${r.value} reps`;
  if (r.unit === "seconds") return `${r.value} s`;
  if (r.viaAdded) return `1RM ${formatRankAmount(r)} extra`;
  if (r.viaLoad) return `zwaarste set ${nlNum(r.value)} kg`;
  if (r.assisted) return `effectieve 1RM ≈ ${nlNum(r.value)} kg`;
  return `1RM ≈ ${nlNum(r.value)} kg`;
}

/**
 * De grens voor de volgende tier als tekst ("60 s", "+25 kg", "85 kg") en een concreet voorbeeld
 * ("85 kg × 5", "60 s in één set", "max. 20 kg ondersteuning × 5"). null in de hoogste tier.
 */
export function nextTierTarget(r: ExerciseRank): { at: string; example: string } | null {
  if (r.nextAt == null) return null;
  if (r.unit === "reps") return { at: `${r.nextAt} reps`, example: `${r.nextAt} reps in één set` };
  if (r.unit === "seconds") return { at: `${r.nextAt} s`, example: `${r.nextAt} s in één set` };
  const at = Math.ceil(r.nextAt);
  if (r.viaAdded) {
    const added = formatRankAmount({ unit: "kg", value: at, viaAdded: true });
    return { at: added, example: `1RM met ${added} extra` };
  }
  if (r.viaLoad) return { at: `${at} kg`, example: `een set met ${at} kg` };
  if (r.assisted && r.bodyweight) {
    const assist = Math.floor((r.bodyweight - r.nextAt / (1 + 5 / 30)) / 2.5) * 2.5;
    if (assist > 0) return { at: `${at} kg`, example: `max. ${nlNum(assist)} kg ondersteuning × 5` };
    // Op de machine telt hooguit 12 reps zonder ondersteuning (effectieve 1RM 1,4 x lichaamsgewicht).
    if (r.nextAt > assistedCeiling(r.bodyweight)) return { at: `${at} kg`, example: "verder met gewone pull-ups (zonder machine)" };
    const reps = Math.max(1, Math.ceil(30 * (r.nextAt / r.bodyweight - 1)));
    return { at: `${at} kg`, example: `${reps} ${reps === 1 ? "rep" : "reps"} zonder ondersteuning` };
  }
  return { at: `${at} kg`, example: exampleSetFor(r.nextAt).replace(".", ",") };
}
