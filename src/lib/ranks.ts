import standardsJson from "./strength-standards.json";
import { EXERCISE_BY_SLUG } from "./exercises";
import { GROUP_BY_ID, MUSCLE_BY_ID, type MuscleGroupId } from "./muscles";

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
  /** 0..7: tier-index plus voortgang binnen de tier. */
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

function scoreFor(value: number, th: number[]): { score: number; tierIndex: number; progress: number; nextAt: number | null } {
  let tierIndex = 0;
  while (tierIndex < th.length && value >= th[tierIndex]) tierIndex++;
  if (tierIndex >= th.length) return { score: TIERS.length, tierIndex: TIERS.length - 1, progress: 1, nextAt: null };
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

/**
 * Rang per spiergroep (gemiddelde van de 3 beste oefeningen met die groep als hoofdgroep)
 * en een totaalrang (gemiddelde van de spiergroepen).
 */
export function aggregateRanks(ranks: ExerciseRank[]): { groups: GroupRank[]; overall: { score: number; tier: Tier } | null } {
  const byGroup = new Map<MuscleGroupId, ExerciseRank[]>();
  for (const r of ranks) {
    const ex = EXERCISE_BY_SLUG[r.slug];
    if (!ex) continue;
    const group = MUSCLE_BY_ID[ex.primary[0]].group;
    byGroup.set(group, [...(byGroup.get(group) ?? []), r]);
  }
  const groups: GroupRank[] = [...byGroup].map(([group, list]) => {
    const top = [...list].sort((a, b) => b.score - a.score).slice(0, 3);
    const score = top.reduce((s, r) => s + r.score, 0) / top.length;
    return { group, score, tier: tierFor(score), exercises: list.sort((a, b) => b.score - a.score) };
  });
  groups.sort((a, b) => b.score - a.score);
  if (!groups.length) return { groups, overall: null };
  const score = groups.reduce((s, g) => s + g.score, 0) / groups.length;
  return { groups, overall: { score, tier: tierFor(score) } };
}

export function tierFor(score: number): Tier {
  return TIERS[Math.min(TIERS.length - 1, Math.max(0, Math.floor(score)))];
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
