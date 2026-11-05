import { toISODate } from "@/lib/dates";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import type { HistorySet, Session } from "@/lib/history";
import { GROUP_BY_ID, MUSCLE_BY_ID, MUSCLE_GROUPS, type MuscleGroupId } from "@/lib/muscles";

/** Telt een oefening op gewicht (geschatte 1RM) of op herhalingen (lichaamsgewicht)? */
export function isWeighted(list: Session[]): boolean {
  return list.some((s) => s.best1RM != null);
}

export const sessionValue = (s: Session, weighted: boolean) => (weighted ? (s.best1RM ?? 0) : s.maxReps);

export type RecentPR = {
  slug: string;
  date: string;
  workoutId: string;
  weighted: boolean;
  value: number;
  previous: number;
  bestSet: HistorySet;
};

/**
 * Nieuwe records (hoger dan alles daarvoor) van de laatste `days` dagen, per oefening alleen de
 * nieuwste. De eerste keer dat je een oefening doet telt niet als record.
 */
export function recentPRs(sessions: Map<string, Session[]>, days = 14, now: Date = new Date()): RecentPR[] {
  const cutoff = toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
  const out: RecentPR[] = [];
  for (const [slug, list] of sessions) {
    const weighted = isWeighted(list);
    let best = 0;
    let latest: RecentPR | null = null;
    for (const s of list) {
      const v = sessionValue(s, weighted);
      if (best > 0 && v > best && s.date >= cutoff) {
        latest = { slug, date: s.date, workoutId: s.workoutId, weighted, value: v, previous: best, bestSet: s.bestSet };
      }
      best = Math.max(best, v);
    }
    if (latest) out.push(latest);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.value / b.previous - a.value / a.previous);
}

export function exerciseName(slug: string): string {
  return EXERCISE_BY_SLUG[slug]?.name ?? slug;
}

export function exerciseGroup(slug: string): MuscleGroupId | null {
  const ex = EXERCISE_BY_SLUG[slug];
  const muscle = ex ? MUSCLE_BY_ID[ex.primary[0]] : undefined;
  return muscle?.group ?? null;
}

/** Oefeningen gegroepeerd per spiergroep (volgorde van MUSCLE_GROUPS), binnen een groep op naam. */
export function groupExercises(slugs: string[]): { label: string; slugs: string[] }[] {
  const byGroup = new Map<string, string[]>();
  for (const slug of slugs) {
    const g = exerciseGroup(slug) ?? "other";
    let list = byGroup.get(g);
    if (!list) byGroup.set(g, (list = []));
    list.push(slug);
  }
  const order = [...MUSCLE_GROUPS.map((g) => g.id as string), "other"];
  return [...byGroup]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([g, list]) => ({
      label: g === "other" ? "Overig" : GROUP_BY_ID[g as MuscleGroupId].name,
      slugs: list.sort((a, b) => exerciseName(a).localeCompare(exerciseName(b), "nl")),
    }));
}

export type MonthRecap = {
  /** Aantal records (nieuwe hoogste waarde, niet de eerste keer) in de maand. */
  prs: number;
  /** Oefening met de grootste procentuele verbetering t.o.v. het beste vóór de maand. */
  mostImproved: { slug: string; pct: number; weighted: boolean } | null;
};

/** Records en meest verbeterde oefening binnen een maand (`monthKey` = "YYYY-MM"). */
export function monthRecap(sessions: Map<string, Session[]>, monthKey: string): MonthRecap {
  let prs = 0;
  let mostImproved: MonthRecap["mostImproved"] = null;
  for (const [slug, list] of sessions) {
    const weighted = isWeighted(list);
    let best = 0;
    let beforeMonth = 0;
    let bestInMonth = 0;
    for (const s of list) {
      const month = s.date.slice(0, 7);
      if (month > monthKey) break;
      const v = sessionValue(s, weighted);
      if (month === monthKey) {
        if (best > 0 && v > best) prs++;
        bestInMonth = Math.max(bestInMonth, v);
      } else {
        beforeMonth = Math.max(beforeMonth, v);
      }
      best = Math.max(best, v);
    }
    if (beforeMonth > 0 && bestInMonth > beforeMonth) {
      const pct = ((bestInMonth - beforeMonth) / beforeMonth) * 100;
      if (!mostImproved || pct > mostImproved.pct) mostImproved = { slug, pct, weighted };
    }
  }
  return { prs, mostImproved };
}
