import type { HistorySet } from "@/lib/history";
import { aggregateRanks, hasStandard, rankExercise, TIERS, type ExerciseRank, type LogLike, type Sex, type Tier } from "@/lib/ranks";

export type RankEvent = {
  date: string;
  /** Oefening, of null voor de totaalrang. */
  slug: string | null;
  /** Vorige tier, of null als dit de eerste rang voor deze oefening is. */
  from: Tier | null;
  to: Tier;
  toIndex: number;
};

/** Totaalscore (0..7) op een dag waarop die veranderde. */
export type OverallPoint = { date: string; score: number };

export type RankReplay = {
  /** Rangstijgingen, nieuwste eerst. */
  events: RankEvent[];
  /** Verloop van de (definitieve) totaalscore, oudste eerst; alleen dagen waarop die veranderde. */
  overall: OverallPoint[];
};

const memo = new WeakMap<HistorySet[], Map<string, RankReplay>>();

/**
 * Speelt de trainingsgeschiedenis chronologisch af en geeft elk moment waarop een oefening (of de
 * totaalrang) een tier omhoog ging, nieuwste eerst, plus het verloop van de totaalscore. Rekent met
 * het huidige lichaamsgewicht en de huidige leeftijd (oude metingen hebben we niet per training),
 * dus het is een benadering. Het resultaat wordt per geschiedenis-array onthouden.
 *
 * Een eerste rang voor een oefening telt alleen als event vanaf Zilver: Brons is het startpunt.
 * De totaalscore telt pas mee zodra die niet meer voorlopig is.
 */
export function rankReplay(history: HistorySet[], bodyweight: number | null, sex: Sex | null, age?: number | null): RankReplay {
  if (!bodyweight || !sex) return { events: [], overall: [] };
  const key = `${bodyweight}|${sex}|${age ?? ""}`;
  let byParams = memo.get(history);
  if (!byParams) memo.set(history, (byParams = new Map()));
  const hit = byParams.get(key);
  if (hit) return hit;

  const byDate = new Map<string, HistorySet[]>();
  for (const s of history) {
    if (!(s.reps && s.reps > 0) || !hasStandard(s.slug)) continue;
    const list = byDate.get(s.date);
    if (list) list.push(s);
    else byDate.set(s.date, [s]);
  }
  const dates = [...byDate.keys()].sort();
  const logs = new Map<string, LogLike[]>();
  const current = new Map<string, ExerciseRank>();
  const events: RankEvent[] = [];
  const series: OverallPoint[] = [];
  let overallIndex: number | null = null;

  for (const date of dates) {
    const touched = new Set<string>();
    for (const s of byDate.get(date)!) {
      let list = logs.get(s.slug);
      if (!list) logs.set(s.slug, (list = []));
      list.push({ weight: s.weight, reps: s.reps });
      touched.add(s.slug);
    }
    for (const slug of touched) {
      const next = rankExercise(slug, logs.get(slug)!, bodyweight, sex, age);
      if (!next) continue;
      const prev = current.get(slug);
      current.set(slug, next);
      if (prev ? next.tierIndex > prev.tierIndex : next.tierIndex > 0) {
        events.push({ date, slug, from: prev ? prev.tier : null, to: next.tier, toIndex: next.tierIndex });
      }
    }
    const { overall } = aggregateRanks([...current.values()]);
    if (overall && !overall.provisional) {
      const idx = TIERS.indexOf(overall.tier);
      if (overallIndex == null || idx > overallIndex) {
        events.push({ date, slug: null, from: overallIndex == null ? null : TIERS[overallIndex], to: overall.tier, toIndex: idx });
      }
      overallIndex = overallIndex == null ? idx : Math.max(overallIndex, idx);
      const score = Math.round(overall.score * 1000) / 1000;
      if (series.at(-1)?.score !== score) series.push({ date, score });
    }
  }
  const result = { events: events.reverse(), overall: series };
  byParams.set(key, result);
  return result;
}

/** Alleen de rangstijgingen (zie rankReplay), nieuwste eerst. */
export function rankTimeline(history: HistorySet[], bodyweight: number | null, sex: Sex | null, age?: number | null): RankEvent[] {
  return rankReplay(history, bodyweight, sex, age).events;
}
