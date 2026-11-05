"use client";

import { useMemo } from "react";
import { defaultTargetReps, EXERCISE_BY_SLUG } from "@/lib/exercises";
import { formatSet, sessionsBySlug, useHistory, type Session } from "@/lib/history";
import { suggestNext } from "@/lib/progression";

/** Per oefening de laatste keer dat deze persoon hem gelogd heeft (uit de gedeelde geschiedenis). */
export function useLastSessions(userId: string | null): Map<string, Session> | undefined {
  const history = useHistory(userId || null);
  return useMemo(() => {
    if (!history) return undefined;
    const out = new Map<string, Session>();
    for (const [slug, list] of sessionsBySlug(history)) out.set(slug, list[list.length - 1]);
    return out;
  }, [history]);
}

export type LastHint = { last: string; next: string | null; date: string };

/**
 * Korte samenvatting van de vorige keer plus een advies volgens double progression,
 * bijv. { last: "3 sets, beste 80 kg × 8", next: "82,5 kg × 8–12" }.
 */
export function lastHint(session: Session | undefined, slug: string, reps: string, sets: number): LastHint | null {
  if (!session) return null;
  const ex = EXERCISE_BY_SLUG[slug];
  const prev = session.sets.map((s) => ({ set_number: s.setNumber, weight: s.weight, reps: s.reps }));
  const next = ex ? suggestNext(prev, reps || defaultTargetReps(slug), sets, ex.equipment, { timed: !!ex.timed }) : null;
  return {
    last: `${session.sets.length} ${session.sets.length === 1 ? "set" : "sets"}, beste ${formatSet(session.bestSet)}`,
    next: next?.headline ?? null,
    date: session.date,
  };
}
