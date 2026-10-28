import type { Equipment } from "./exercise-types";

/**
 * Advies voor de volgende training volgens "double progression":
 * haal je bij alle sets de bovenkant van het rep-bereik, dan gaat het gewicht omhoog en begin je
 * weer onderaan het bereik; anders hetzelfde gewicht en één rep erbij per set.
 */

export type PrevSet = { set_number: number; weight: number | null; reps: number | null };

export type Suggestion = {
  /** Kort advies voor boven de oefening. */
  headline: string;
  reason: string;
  /** Doel per set (index = setnummer - 1), voor als voorinvulling. */
  perSet: { weight: number | null; reps: number }[];
};

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

export function suggestNext(prev: PrevSet[], targetReps: string, targetSets: number, equipment: Equipment): Suggestion | null {
  const sets = prev.filter((s) => (s.reps ?? 0) > 0).sort((a, b) => a.set_number - b.set_number);
  const range = parseRepRange(targetReps);
  if (!sets.length || !range) return null;
  const rangeLabel = range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`;
  const count = Math.max(targetSets, 1);
  const weighted = sets.some((s) => (s.weight ?? 0) > 0);

  if (!weighted) {
    const best = Math.max(...sets.map((s) => s.reps ?? 0));
    if (sets.every((s) => (s.reps ?? 0) >= range.max)) {
      return {
        headline: `${best + 1}+ reps per set`,
        reason: `Vorige keer bij alle sets ${range.max}+ reps: probeer meer reps of voeg gewicht toe.`,
        perSet: Array.from({ length: count }, () => ({ weight: null, reps: best + 1 })),
      };
    }
    return {
      headline: `${rangeLabel} reps, 1 meer dan vorige keer`,
      reason: "Probeer per set één rep meer dan vorige keer.",
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
      headline: `${nl(next)} kg × ${rangeLabel}`,
      reason: `Vorige keer alle sets ${range.max}+ reps op ${nl(top)} kg: tijd voor ${nl(step)} kg erbij.`,
      perSet: Array.from({ length: count }, () => ({ weight: next, reps: range.min })),
    };
  }

  if (avgReps < range.min - 2 && top - step > 0) {
    const lower = top - step;
    return {
      headline: `${nl(lower)} kg × ${rangeLabel}`,
      reason: `Vorige keer gemiddeld ${nl(Math.round(avgReps * 10) / 10)} reps op ${nl(top)} kg, onder je bereik: iets lichter om in ${rangeLabel} te blijven.`,
      perSet: Array.from({ length: count }, () => ({ weight: lower, reps: range.min })),
    };
  }

  return {
    headline: `${nl(top)} kg × ${rangeLabel}`,
    reason: "Zelfde gewicht als vorige keer, probeer per set één rep meer.",
    perSet: Array.from({ length: count }, (_, i) => {
      const p = work[Math.min(i, work.length - 1)];
      return { weight: top, reps: Math.min(range.max, (p.reps ?? range.min) + 1) };
    }),
  };
}
