import { toISODate } from "@/lib/dates";
import { EXERCISE_BY_SLUG, isTimed } from "@/lib/exercises";
import type { HistorySet, Session } from "@/lib/history";
import { GROUP_BY_ID, MUSCLE_BY_ID, MUSCLE_GROUPS, type MuscleGroupId } from "@/lib/muscles";
import { isAnyWeightReps, isAssisted, isBodyweightBased, isLoadScored } from "@/lib/ranks";

/** Telt een oefening op gewicht (geschatte 1RM) of op herhalingen (lichaamsgewicht)? */
export function isWeighted(list: Session[]): boolean {
  return list.some((s) => s.best1RM != null);
}

export const sessionValue = (s: Session, weighted: boolean) => (weighted ? (s.best1RM ?? 0) : s.maxReps);

// ─── Rep-records (zwaarste gewicht per herhalingsaantal) ───

/** Herhalingsaantallen waarvoor een rep-record wordt bijgehouden (1RM t/m 12RM). */
export const REP_COUNTS = [1, 2, 3, 5, 8, 10, 12] as const;

/**
 * Een rep-record telt pas met minstens zoveel eerdere sessies van de oefening: na één eerdere
 * training is bijna elke zwaardere set "nieuw". Overal dezelfde regel: "Recente records", de
 * maandcijfers, de PR-labels in de kalender, vriendenprofielen en het afrondscherm (repPRs).
 */
export const REP_PR_MIN_SESSIONS = 2;

/**
 * Minimale winst (kg) voor een nieuw rep-record: 2,5% van het vorige record, minstens 1 kg en
 * hoogstens 2,5 kg. Licht werk telt dus met kleine stappen (dumbbells van 20 naar 22 kg, 8 naar
 * 9 kg, een plaatje van 1,25 kg tot 50 kg), zware oefeningen vanaf 100 kg met een volle 2,5 kg.
 * Bij lichaamsgewicht-oefeningen gaat het om het extra gewicht, dus vanaf +0 kg minstens 1 kg.
 */
export function repPRMinGain(previous: number): number {
  return Math.min(2.5, Math.max(1, previous * 0.025));
}

/**
 * - "load": het gewicht is de hele last (barbell, dumbbell, kabel, machine).
 * - "added": lichaamsgewicht-oefening (pull-up, dips): het gewicht is extra bovenop je lichaam.
 *   Sets zonder gewicht tellen mee als +0 kg, zodat 10 pull-ups zonder gewicht ook een 10RM zijn.
 */
export type RepMode = "load" | "added";

/**
 * Hoe rep-records voor een oefening werken (RepMode), of null als ze niet gelden: zonder gewicht
 * (`weighted` false), bij statische oefeningen, assisted machines (gewicht is ondersteuning),
 * oefeningen die op de zwaarste set scoren (isLoadScored: dragen, sled, pinch, swings, kroc rows,
 * 21s; daar zijn de "reps" afstand, tijd of een vast schema) en oefeningen op reps met een band of
 * hulpmiddel (isAnyWeightReps): daar zegt een 1RM of 10RM niets.
 */
export function repRecordMode(slug: string | null | undefined, weighted: boolean): RepMode | null {
  if (!weighted || !slug || isTimed(slug) || isAssisted(slug) || isLoadScored(slug) || isAnyWeightReps(slug)) return null;
  return isBodyweightBased(slug) ? "added" : "load";
}

/**
 * Rep-record voor één herhalingsaantal: het zwaarste gewicht dat je voor minstens `reps`
 * herhalingen hebt gedaan (de set zelf kan meer reps hebben). Bij `added` is `weight` het extra
 * gewicht (0 = alleen lichaamsgewicht). Null als dat nog nooit lukte.
 */
export type RepRecord = { reps: number; weight: number; date: string; workoutId: string; set: HistorySet; added: boolean } | null;

/**
 * Een verbeterd rep-record: `weight` kg voor minstens `reps` herhalingen, eerder `previous` kg.
 * Bij `added` gaat het om extra gewicht bovenop lichaamsgewicht.
 */
export type RepGain = { reps: number; weight: number; previous: number; added: boolean };

type RepLike = { weight: number | null; reps: number | null };

/**
 * Welke set werd het eerst gehaald? Op datum, dan logmoment, en voor een vaste uitkomst bij
 * ontbrekende tijdstippen op oefening-in-training en setnummer. Zo hangt een gelijk rep-record niet
 * af van de volgorde waarin de sessies binnenkomen (oud-nieuw of nieuw-oud).
 */
function achievedEarlier(a: HistorySet, b: HistorySet): boolean {
  if (a.date !== b.date) return a.date < b.date;
  const ca = a.createdAt ?? "";
  const cb = b.createdAt ?? "";
  if (ca !== cb) return ca < cb;
  if (a.workoutExerciseId !== b.workoutExerciseId) return a.workoutExerciseId < b.workoutExerciseId;
  return a.setNumber < b.setNumber;
}

/**
 * Per REP_COUNTS-index de zwaarste set met minstens zoveel reps, of null. Dit is de enige plek
 * met de regel "minstens N reps": een zware set met veel reps telt ook voor alle lagere aantallen.
 * Bij "load" tellen alleen sets met gewicht, bij "added" ook sets zonder (als +0 kg).
 * Bij gelijk gewicht blijft de eerste staan, tenzij `earlier(nieuw, huidig)` true geeft.
 */
export function heaviestSetsPerRepCount<T extends RepLike>(
  sets: Iterable<T>,
  mode: RepMode,
  earlier?: (candidate: T, current: T) => boolean,
): ({ weight: number; set: T } | null)[] {
  const out: ({ weight: number; set: T } | null)[] = REP_COUNTS.map(() => null);
  for (const set of sets) {
    const w = Number(set.weight ?? 0);
    const r = Number(set.reps ?? 0);
    if (!(mode === "added" ? w >= 0 : w > 0) || !(r >= 1)) continue;
    REP_COUNTS.forEach((n, i) => {
      if (r < n) return;
      const cur = out[i];
      if (!cur || w > cur.weight || (w === cur.weight && earlier?.(set, cur.set))) out[i] = { weight: w, set };
    });
  }
  return out;
}

/** Per REP_COUNTS-index het zwaarste gewicht voor minstens zoveel reps, of null (nooit gedaan). */
export function heaviestPerRepCount(sets: Iterable<RepLike>, mode: RepMode): (number | null)[] {
  return heaviestSetsPerRepCount(sets, mode).map((b) => b?.weight ?? null);
}

/**
 * Verbeterde rep-records: per herhalingsaantal `now` tegen het beste van eerder (`before`, zelfde
 * indeling als heaviestPerRepCount). Telt alleen als er eerder een gewicht voor dat aantal was en de
 * winst minstens repPRMinGain(vorige) is. Grootste winst eerst; bij gelijke winst het hoogste aantal reps.
 */
export function repGains(now: (number | null)[], before: (number | null)[], mode: RepMode): RepGain[] {
  const out: RepGain[] = [];
  REP_COUNTS.forEach((reps, i) => {
    const weight = now[i];
    const previous = before[i];
    // Kleine marge tegen afrondingsfouten (102,5 - 100 moet 2,5 blijven).
    if (weight == null || previous == null || weight - previous < repPRMinGain(previous) - 1e-9) return;
    out.push({ reps, weight, previous, added: mode === "added" });
  });
  return out.sort((a, b) => b.weight - b.previous - (a.weight - a.previous) || b.reps - a.reps);
}

/**
 * Rep-records van één oefening, in de volgorde van REP_COUNTS. Een zwaardere set met meer reps
 * telt ook voor lagere aantallen; bij gelijk gewicht telt het moment dat het voor het eerst lukte
 * (op datum en logmoment, los van de volgorde van `list`). Leeg als rep-records niet gelden
 * (repRecordMode: statisch, assisted, scoort op zwaarste set, band, of zonder gewicht).
 */
export function repRecords(list: Session[]): RepRecord[] {
  const mode = repRecordMode(list[0]?.sets[0]?.slug, isWeighted(list));
  if (!mode) return [];
  const sets = list.flatMap((s) => s.sets);
  return heaviestSetsPerRepCount(sets, mode, achievedEarlier).map((b, i) =>
    b
      ? { reps: REP_COUNTS[i], weight: b.weight, date: b.set.date, workoutId: b.set.workoutId, set: b.set, added: mode === "added" }
      : null,
  );
}

// ─── Records per sessie ───

/**
 * Record van één sessie. `set` is de set die het record zette: bij "e1rm" de set met de hoogste
 * geschatte 1RM (zonder gewicht: de eerste set met de meeste reps of seconden), bij "rep" de eerste
 * set met het nieuwe zwaarste gewicht voor minstens `reps` herhalingen.
 */
export type SessionRecord =
  | { kind: "e1rm"; value: number; previous: number; set: HistorySet }
  | ({ kind: "rep"; set: HistorySet } & RepGain);

/**
 * Per sessie van één oefening (`list` oudste eerst, zoals sessionsBySlug) het record dat die sessie
 * zette, of null. Eén bron voor "Recente records", de maandcijfers, de PR-labels in de kalender en
 * de records op vriendenprofielen (personalRecords).
 * - "e1rm": hogere geschatte 1RM (zonder gewicht: meer reps of langer) dan alle eerdere sessies;
 *   niet bij de eerste sessie (zelfde regel als beats() op het afrondscherm).
 * - "rep": anders, als rep-records gelden (repRecordMode), het herhalingsaantal met de grootste
 *   winst (minstens repPRMinGain) ten opzichte van alle eerdere sessies, met minstens
 *   REP_PR_MIN_SESSIONS eerdere sessies (zelfde regel als repPRs() op het afrondscherm).
 */
export function sessionRecords(slug: string, list: Session[], weighted: boolean): (SessionRecord | null)[] {
  const mode = repRecordMode(slug, weighted);
  const repBest: (number | null)[] = REP_COUNTS.map(() => null);
  let best = 0;
  return list.map((s, idx) => {
    const v = sessionValue(s, weighted);
    const today = mode ? heaviestSetsPerRepCount(s.sets, mode) : null;
    let record: SessionRecord | null = null;
    if (best > 0 && v > best) {
      const set = weighted ? s.bestSet : (s.sets.find((x) => (x.reps ?? 0) === s.maxReps) ?? s.bestSet);
      record = { kind: "e1rm", value: v, previous: best, set };
    } else if (mode && today && idx >= REP_PR_MIN_SESSIONS) {
      const gain = repGains(
        today.map((b) => b?.weight ?? null),
        repBest,
        mode,
      )[0];
      const set = gain && today[REP_COUNTS.indexOf(gain.reps as (typeof REP_COUNTS)[number])]?.set;
      if (gain && set) record = { kind: "rep", set, ...gain };
    }
    best = Math.max(best, v);
    today?.forEach((b, i) => {
      const prev = repBest[i];
      if (b && (prev == null || b.weight > prev)) repBest[i] = b.weight;
    });
    return record;
  });
}

// ─── Recente records ───

export type RecentPR = {
  slug: string;
  /**
   * "e1rm": hoogste waarde van de oefening, dus de geschatte 1RM, of bij oefeningen zonder gewicht
   * de meeste reps of seconden. "rep": zwaarste gewicht voor minstens `reps` herhalingen.
   */
  kind: "e1rm" | "rep";
  /** Bij een rep-record: het herhalingsaantal (bijv. 8 voor een 8RM-record). */
  reps?: number;
  /** Bij een rep-record van een lichaamsgewicht-oefening: `value` en `previous` zijn extra gewicht. */
  added?: boolean;
  date: string;
  workoutId: string;
  weighted: boolean;
  value: number;
  previous: number;
  bestSet: HistorySet;
};

/** Relatieve winst voor de volgorde; bij extra gewicht kan het vorige record +0 kg zijn. */
const relGain = (p: { value: number; previous: number }) => (p.value - p.previous) / Math.max(p.previous, 1);

/**
 * Nieuwe records (hoger dan alles daarvoor) van de laatste `days` dagen, per oefening alleen de
 * nieuwste. De eerste keer dat je een oefening doet telt niet als record. Zonder 1RM-record kan
 * een oefening een rep-record hebben (zwaarder voor hetzelfde aantal reps); een 1RM-record gaat voor.
 */
export function recentPRs(sessions: Map<string, Session[]>, days = 14, now: Date = new Date()): RecentPR[] {
  const cutoff = toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
  const out: RecentPR[] = [];
  for (const [slug, list] of sessions) {
    const weighted = isWeighted(list);
    let e1rm: RecentPR | null = null;
    let rep: RecentPR | null = null;
    sessionRecords(slug, list, weighted).forEach((r, i) => {
      const s = list[i];
      if (!r || s.date < cutoff) return;
      const base = { slug, date: s.date, workoutId: s.workoutId, previous: r.previous, bestSet: r.set };
      if (r.kind === "e1rm") e1rm = { ...base, kind: "e1rm", weighted, value: r.value };
      else rep = { ...base, kind: "rep", reps: r.reps, added: r.added, weighted: true, value: r.weight };
    });
    const pr = e1rm ?? rep;
    if (pr) out.push(pr);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || relGain(b) - relGain(a));
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
  /**
   * Aantal records in de maand: trainingen met een nieuwe hoogste waarde (niet de eerste keer), of
   * anders een rep-record. Zelfde regels als "Recente records", maar per training geteld.
   */
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
    const upTo = list.filter((s) => s.date.slice(0, 7) <= monthKey);
    const records = sessionRecords(slug, upTo, weighted);
    let beforeMonth = 0;
    let bestInMonth = 0;
    upTo.forEach((s, i) => {
      const v = sessionValue(s, weighted);
      if (s.date.slice(0, 7) === monthKey) {
        if (records[i]) prs++;
        bestInMonth = Math.max(bestInMonth, v);
      } else {
        beforeMonth = Math.max(beforeMonth, v);
      }
    });
    if (beforeMonth > 0 && bestInMonth > beforeMonth) {
      const pct = ((bestInMonth - beforeMonth) / beforeMonth) * 100;
      if (!mostImproved || pct > mostImproved.pct) mostImproved = { slug, pct, weighted };
    }
  }
  return { prs, mostImproved };
}
