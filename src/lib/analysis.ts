import { EXERCISES, EXERCISE_BY_SLUG } from "./exercises";
import type { Exercise } from "./exercise-types";
import {
  GROUP_BY_ID,
  MUSCLES,
  MUSCLE_BY_ID,
  MUSCLE_GROUPS,
  REGION_LABEL,
  musclesInGroup,
  type MuscleGroupId,
  type MuscleId,
  type MuscleRegion,
} from "./muscles";
import type { PlannedExercise } from "./types";

/** Een spier die meehelpt telt voor een halve set. */
const SECONDARY_WEIGHT = 0.5;

export type MuscleLoad = { id: MuscleId; sets: number };
export type GroupLoad = { id: MuscleGroupId; sets: number; muscles: MuscleLoad[] };

export type Suggestion = {
  kind: "missing" | "detail" | "balance" | "volume";
  text: string;
  exercises: Exercise[];
};

export type Analysis = {
  /** Effectieve sets per losse spier. */
  loads: MuscleLoad[];
  /** Per groep: de zwaarst belaste spier in die groep telt als groepsvolume. */
  groups: GroupLoad[];
  regions: Record<MuscleRegion, number>;
  totalSets: number;
  /** Regio die ≥70% van het volume krijgt, bijv. "push" voor een push-dag. */
  focus: MuscleRegion | null;
  suggestions: Suggestion[];
};

export function analyzePlan(plan: PlannedExercise[]): Analysis {
  const load = Object.fromEntries(MUSCLES.map((m) => [m.id, 0])) as Record<MuscleId, number>;
  let totalSets = 0;

  for (const p of plan) {
    const ex = EXERCISE_BY_SLUG[p.slug];
    if (!ex) continue;
    totalSets += p.sets;
    for (const m of ex.primary) load[m] += p.sets;
    for (const m of ex.secondary) load[m] += p.sets * SECONDARY_WEIGHT;
  }

  // Groepsvolume = de hoogste spier in de groep (één set bench press is geen 3 sets borst).
  const groups: GroupLoad[] = MUSCLE_GROUPS.map((g) => {
    const muscles = musclesInGroup(g.id).map((m) => ({ id: m.id, sets: load[m.id] }));
    return { id: g.id, sets: Math.max(0, ...muscles.map((m) => m.sets)), muscles };
  });
  const groupLoad = Object.fromEntries(groups.map((g) => [g.id, g.sets])) as Record<MuscleGroupId, number>;

  const regions: Record<MuscleRegion, number> = { push: 0, pull: 0, legs: 0, core: 0 };
  for (const g of MUSCLE_GROUPS) regions[g.region] += groupLoad[g.id];
  const regionTotal = Object.values(regions).reduce((a, b) => a + b, 0);

  let focus: MuscleRegion | null = null;
  for (const r of Object.keys(regions) as MuscleRegion[]) {
    if (regionTotal > 0 && regions[r] / regionTotal >= 0.7) focus = r;
  }

  const loads = MUSCLES.map((m) => ({ id: m.id, sets: load[m.id] }));
  const used = new Set(plan.map((p) => p.slug));
  const suggestions: Suggestion[] = [];

  if (plan.length === 0) return { loads, groups, regions, totalSets, focus, suggestions };

  const inFocus = (r: MuscleRegion) => focus === null || r === focus;

  // 1. Grote spiergroepen die niet geraakt worden (op een push/pull/benen-dag alleen binnen die regio).
  for (const g of MUSCLE_GROUPS.filter((g) => g.major && groupLoad[g.id] < 1 && inFocus(g.region)).slice(0, 3)) {
    const target = musclesInGroup(g.id).find((m) => m.targetable)!;
    suggestions.push({
      kind: "missing",
      text: `${g.name} wordt nog niet getraind.`,
      exercises: pickExercises(target.id, used, load),
    });
  }

  // 2. Binnen een getrainde groep: een spierdeel dat duidelijk achterblijft.
  //    Bijv. veel flat bench maar geen incline → bovenkant borst blijft achter.
  const detail: { muscle: MuscleId; ratio: number }[] = [];
  for (const g of groups) {
    if (g.sets < 3) continue;
    for (const m of g.muscles) {
      const muscle = MUSCLE_BY_ID[m.id];
      // Per spier, want bijv. de achterkant schouder hoort bij trekken, ook al zit hij in "Schouders".
      if (!muscle.targetable || !inFocus(muscle.region)) continue;
      const ratio = m.sets / g.sets;
      if (ratio < 0.35) detail.push({ muscle: m.id, ratio });
    }
  }
  for (const { muscle } of detail.sort((a, b) => a.ratio - b.ratio).slice(0, 4)) {
    const m = MUSCLE_BY_ID[muscle];
    const group = GROUP_BY_ID[m.group];
    suggestions.push({
      kind: "detail",
      text: `${group.name}: de ${m.short.toLowerCase()} krijgt weinig werk (${round(load[muscle])} van ${round(groupLoad[m.group])} sets).`,
      exercises: pickExercises(muscle, used, load),
    });
  }

  // 3. Balans tussen tegengestelde spiergroepen.
  if (focus === null) {
    if (regions.push > regions.pull * 1.5 && regions.push - regions.pull >= 4) {
      suggestions.push({
        kind: "balance",
        text: `Veel meer duw- (${round(regions.push)}) dan trekwerk (${round(regions.pull)}). Voeg een rugoefening toe voor gezonde schouders.`,
        exercises: pickExercises(load.lats <= load.rhomboids ? "lats" : "rhomboids", used, load),
      });
    } else if (regions.pull > regions.push * 1.5 && regions.pull - regions.push >= 4) {
      suggestions.push({
        kind: "balance",
        text: `Veel meer trek- (${round(regions.pull)}) dan duwwerk (${round(regions.push)}).`,
        exercises: pickExercises("chest_mid", used, load),
      });
    }
  }
  if (groupLoad.quads >= 4 && groupLoad.hamstrings < groupLoad.quads * 0.5) {
    suggestions.push({
      kind: "balance",
      text: `Quadriceps (${round(groupLoad.quads)}) krijgen veel meer werk dan hamstrings (${round(groupLoad.hamstrings)}).`,
      exercises: pickExercises(load.biceps_femoris <= load.semitendinosus ? "biceps_femoris" : "semitendinosus", used, load),
    });
  }
  if (load.front_delts >= 3 && load.rear_delts < load.front_delts * 0.3 && inFocus("pull")) {
    suggestions.push({
      kind: "balance",
      text: "Voorkant schouder krijgt veel werk, achterkant bijna niets. Dat trekt je schouders naar voren.",
      exercises: pickExercises("rear_delts", used, load),
    });
  }

  // 4. Te veel volume voor één spier in één sessie.
  for (const m of MUSCLES) {
    if (load[m.id] > 16) {
      suggestions.push({
        kind: "volume",
        text: `${m.short} krijgt ${round(load[m.id])} sets in één training; boven ~12–16 sets levert meestal weinig extra op.`,
        exercises: [],
      });
    }
  }

  // Dubbele tips (zelfde spier via verschillende regels) samenvoegen.
  const seen = new Set<string>();
  return {
    loads,
    groups,
    regions,
    totalSets,
    focus,
    suggestions: suggestions.filter((s) => {
      const key = s.exercises.map((e) => e.slug).join();
      if (key && seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

/** Oefeningen met deze spier als hoofdspier die nog niet in het plan staan; voorkeur voor weinig overlap. */
function pickExercises(muscle: MuscleId, used: Set<string>, load: Record<MuscleId, number>) {
  return EXERCISES.filter((e) => e.primary.includes(muscle) && !used.has(e.slug))
    .map((e) => ({
      e,
      // Gerichte oefeningen (de spier als eerste/enige hoofdspier) eerst, dan weinig overlap.
      focus: e.primary[0] === muscle ? 0 : 1,
      overlap: [...e.primary, ...e.secondary].filter((m) => m !== muscle).reduce((s, m) => s + load[m], 0),
    }))
    .sort((a, b) => a.focus - b.focus || a.overlap - b.overlap)
    .slice(0, 3)
    .map((x) => x.e);
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}

export function focusLabel(focus: MuscleRegion | null): string | null {
  if (!focus) return null;
  const day: Record<MuscleRegion, string> = {
    push: "push-dag (duwen)",
    pull: "pull-dag (trekken)",
    legs: "benendag",
    core: "core-training",
  };
  return `Dit is een ${day[focus]}, dus we kijken alleen naar ${REGION_LABEL[focus].toLowerCase()}.`;
}
