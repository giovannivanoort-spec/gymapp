"use client";

import { useMemo } from "react";
import { useHistory } from "@/lib/history";

/** Oefeningen die deze persoon gelogd heeft, meest recent eerst (uit de gedeelde, gecachete geschiedenis). */
export function useRecentExercises(userId: string | null): string[] | undefined {
  const history = useHistory(userId);
  return useMemo(() => {
    if (!history) return undefined;
    const last = new Map<string, string>();
    for (const s of history) {
      const prev = last.get(s.slug);
      if (!prev || s.date > prev) last.set(s.slug, s.date);
    }
    return [...last].sort((a, b) => b[1].localeCompare(a[1])).map(([slug]) => slug);
  }, [history]);
}
