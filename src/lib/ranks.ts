import standardsJson from "./strength-standards.json";
import { EXERCISE_BY_SLUG } from "./exercises";
import { GROUP_BY_ID, MUSCLE_BY_ID, MUSCLE_GROUPS, type MuscleGroupId } from "./muscles";

/**
 * Ranks per oefening op basis van krachtstandaarden van StrengthLevel.com (per oefening, geslacht
 * en lichaamsgewicht). Grenzen: Beginner → Zilver, Novice → Goud, Intermediate → Platina,
 * Advanced → Diamant, Elite → Elite, en één Elite-stap verder → Olympiër.
 */

export type Sex = "male" | "female";

/** [lichaamsgewicht, beginner, novice, intermediate, advanced, elite] */
type Row = number[];
type Standard = {
  source: string;
  title?: string;
  unit: "kg" | "reps";
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
  unit: "kg" | "reps";
  /** Beste prestatie: geschatte 1RM (kg) of aantal reps. */
  value: number;
  /** Wat nodig is voor de volgende tier (zelfde eenheid), of null bij de hoogste tier. */
  nextAt: number | null;
  /** Bij reps-oefeningen met extra gewicht: rang behaald met extra gewicht. */
  viaAdded?: boolean;
};

export function hasStandard(slug: string): boolean {
  return !!STANDARDS[slug];
}

/** Geschatte 1RM (Epley). Boven de 12 reps wordt de schatting onbetrouwbaar; die sets tellen niet mee. */
export function estimate1RM(weight: number, reps: number): number | null {
  if (!(weight > 0) || !(reps >= 1) || reps > 12) return null;
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
  const [beg, nov, int, adv, elite] = levels;
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
    const best = Math.max(0, ...logs.map((l) => estimate1RM(l.weight ?? 0, l.reps ?? 0) ?? 0));
    if (best <= 0) return null;
    const levels = adjustForAge(levelsAt(male ? std.male : std.female, bodyweight), male ? std.ageMale : std.ageFemale, age, "ratio");
    const s = scoreFor(best, thresholds(levels));
    return { slug, ...s, tier: TIERS[s.tierIndex], unit: "kg", value: round(best) };
  }

  // Lichaamsgewicht-oefening: beste aantal reps zonder extra gewicht, en (indien gelogd) extra gewicht.
  const bestReps = Math.max(0, ...logs.filter((l) => !(l.weight ?? 0)).map((l) => l.reps ?? 0));
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
): { unit: "kg" | "reps"; steps: { tier: Tier; at: number }[] } | null {
  const std = STANDARDS[slug];
  if (!std) return null;
  const male = sex === "male";
  const levels = adjustForAge(
    levelsAt(male ? std.male : std.female, bodyweight),
    male ? std.ageMale : std.ageFemale,
    age,
    std.unit === "kg" ? "ratio" : "delta",
  );
  const th = thresholds(levels);
  return {
    unit: std.unit,
    steps: th.map((at, i) => ({ tier: TIERS[i + 1], at: std.unit === "reps" ? Math.max(1, Math.ceil(at)) : Math.ceil(at) })),
  };
}
