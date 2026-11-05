import type { Equipment } from "./exercise-types";

/**
 * Advies voor de volgende training volgens "double progression":
 * haal je bij alle sets de bovenkant van het rep-bereik, dan gaat het gewicht omhoog en begin je
 * weer onderaan het bereik; anders hetzelfde gewicht en één rep erbij per set.
 * Met eerdere trainingen erbij (optioneel) herkent het ook een plateau: drie keer op rij hetzelfde
 * werkgewicht zonder meer reps betekent een korte deload (ongeveer 10% lichter) en weer opbouwen.
 */

export type PrevSet = { set_number: number; weight: number | null; reps: number | null };

export type Suggestion = {
  /** Kort advies voor boven de oefening. */
  headline: string;
  reason: string;
  /** Doel per set (index = setnummer - 1), voor als voorinvulling. */
  perSet: { weight: number | null; reps: number }[];
  /** Soort advies, bijv. om een plateau anders te tonen. */
  kind?: "increase" | "hold" | "decrease" | "deload" | "reps";
};

export type SuggestOptions = {
  /** Trainingen vóór de vorige (nieuwste eerst), voor het herkennen van een plateau. */
  earlier?: PrevSet[][];
  /** Statische oefening (plank, wall sit): reps zijn seconden, opbouwen gaat per 5 s. */
  timed?: boolean;
};

/** Stap per set bij oefeningen in seconden. */
const TIMED_STEP = 5;

export function parseRepRange(target: string): { min: number; max: number } | null {
  const m = target.match(/(\d+)\s*(?:[-–—]|tot)\s*(\d+)/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const single = target.match(/^\s*(\d+)\s*$/);
  return single ? { min: Number(single[1]), max: Number(single[1]) } : null;
}

/** Kleinste gangbare stap in gewicht. */
export function weightStep(equipment: Equipment): number {
  return equipment === "dumbbell" || equipment === "kettlebell" ? 2 : 2.5;
}

const nl = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 2 });

/** Werkgewicht (zwaarste gewicht) en het totaal aantal reps op dat gewicht. */
function workOf(sets: PrevSet[]): { top: number; reps: number } | null {
  const done = sets.filter((s) => (s.reps ?? 0) > 0);
  if (!done.length) return null;
  const top = Math.max(...done.map((s) => s.weight ?? 0));
  return { top, reps: done.filter((s) => (s.weight ?? 0) === top).reduce((a, s) => a + (s.reps ?? 0), 0) };
}

/**
 * Plateau: de vorige training en de twee daarvoor op hetzelfde werkgewicht, en de vorige keer
 * niet meer reps dan eerder op dat gewicht.
 */
export function isStalled(prev: PrevSet[], earlier: PrevSet[][] | undefined): boolean {
  if (!earlier || earlier.length < 2) return false;
  const now = workOf(prev);
  if (!now || now.top <= 0) return false;
  const older = earlier.slice(0, 2).map(workOf);
  if (older.some((o) => !o || o.top !== now.top)) return false;
  return now.reps <= Math.max(...older.map((o) => o!.reps));
}

export function suggestNext(
  prev: PrevSet[],
  targetReps: string,
  targetSets: number,
  equipment: Equipment,
  opts: SuggestOptions = {},
): Suggestion | null {
  const sets = prev.filter((s) => (s.reps ?? 0) > 0).sort((a, b) => a.set_number - b.set_number);
  const range = parseRepRange(targetReps);
  if (!sets.length || !range) return null;
  const rangeLabel = range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`;
  const count = Math.max(targetSets, 1);
  const weighted = sets.some((s) => (s.weight ?? 0) > 0);
  const timed = !!opts.timed;
  /** Eenheid achter een aantal: "reps" of "s". */
  const unit = timed ? "s" : "reps";

  if (!weighted && timed) {
    const best = Math.max(...sets.map((s) => s.reps ?? 0));
    if (sets.every((s) => (s.reps ?? 0) >= range.max)) {
      return {
        headline: `${best + TIMED_STEP} s per set`,
        reason: `Vorige keer bij alle sets ${range.max}+ s: houd het ${TIMED_STEP} s langer vol of voeg gewicht toe.`,
        kind: "reps",
        perSet: Array.from({ length: count }, () => ({ weight: null, reps: best + TIMED_STEP })),
      };
    }
    return {
      headline: `${rangeLabel} s, +${TIMED_STEP} s per set`,
      reason: `Probeer per set ${TIMED_STEP} seconden langer dan vorige keer.`,
      kind: "reps",
      perSet: Array.from({ length: count }, (_, i) => ({
        weight: null,
        reps: Math.min(range.max, (sets[Math.min(i, sets.length - 1)].reps ?? 0) + TIMED_STEP),
      })),
    };
  }

  if (!weighted) {
    const best = Math.max(...sets.map((s) => s.reps ?? 0));
    if (sets.every((s) => (s.reps ?? 0) >= range.max)) {
      return {
        headline: `${best + 1}+ reps per set`,
        reason: `Vorige keer bij alle sets ${range.max}+ reps: probeer meer reps of voeg gewicht toe.`,
        kind: "reps",
        perSet: Array.from({ length: count }, () => ({ weight: null, reps: best + 1 })),
      };
    }
    return {
      headline: `${rangeLabel} reps, 1 meer dan vorige keer`,
      reason: "Probeer per set één rep meer dan vorige keer.",
      kind: "reps",
      perSet: Array.from({ length: count }, (_, i) => ({
        weight: null,
        reps: Math.min(range.max, (sets[Math.min(i, sets.length - 1)].reps ?? 0) + 1),
      })),
    };
  }

  // Het werkgewicht is het zwaarste gewicht dat vorige keer gebruikt is.
  const top = Math.max(...sets.map((s) => s.weight ?? 0));
  const work = sets.filter((s) => (s.weight ?? 0) === top);
  const step = weightStep(equipment);
  const avgReps = work.reduce((a, s) => a + (s.reps ?? 0), 0) / work.length;

  if (work.length >= Math.min(count, sets.length) && work.every((s) => (s.reps ?? 0) >= range.max)) {
    const next = top + step;
    return {
      headline: `${nl(next)} kg × ${rangeLabel}${timed ? " s" : ""}`,
      reason: `Vorige keer alle sets ${range.max}+ ${unit} op ${nl(top)} kg: tijd voor ${nl(step)} kg erbij.`,
      kind: "increase",
      perSet: Array.from({ length: count }, () => ({ weight: next, reps: range.min })),
    };
  }

  if (avgReps < range.min - 2 && top - step > 0) {
    const lower = top - step;
    return {
      headline: `${nl(lower)} kg × ${rangeLabel}${timed ? " s" : ""}`,
      reason: `Vorige keer gemiddeld ${nl(Math.round(avgReps * 10) / 10)} ${unit} op ${nl(top)} kg, onder je bereik: iets lichter om in ${rangeLabel} te blijven.`,
      kind: "decrease",
      perSet: Array.from({ length: count }, () => ({ weight: lower, reps: range.min })),
    };
  }

  if (isStalled(sets, opts.earlier)) {
    const deload = Math.floor((top * 0.9) / step) * step;
    if (deload > 0 && deload < top) {
      return {
        headline: `${nl(deload)} kg × ${range.max}${timed ? " s" : ""}`,
        reason: timed
          ? `Drie trainingen op rij ${nl(top)} kg zonder langer vol te houden: een keer zo'n 10% lichter met ${range.max} s, daarna weer opbouwen.`
          : `Drie trainingen op rij ${nl(top)} kg zonder meer reps: een keer zo'n 10% lichter met ${range.max} reps, daarna weer opbouwen.`,
        perSet: Array.from({ length: count }, () => ({ weight: deload, reps: range.max })),
        kind: "deload",
      };
    }
  }

  return {
    headline: `${nl(top)} kg × ${rangeLabel}${timed ? " s" : ""}`,
    reason: timed
      ? `Zelfde gewicht als vorige keer, probeer per set ${TIMED_STEP} s langer.`
      : "Zelfde gewicht als vorige keer, probeer per set één rep meer.",
    kind: "hold",
    perSet: Array.from({ length: count }, (_, i) => {
      const p = work[Math.min(i, work.length - 1)];
      return { weight: top, reps: Math.min(range.max, (p.reps ?? range.min) + (timed ? TIMED_STEP : 1)) };
    }),
  };
}
