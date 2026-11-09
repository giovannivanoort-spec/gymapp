import { isTimed } from "@/lib/exercises";
import type { FailedOp, QueuedOp } from "@/lib/offlineQueue";
import { assistedScore, estimate1RM, formatRankAmount, formatRankBest, isAssisted, maxRepsFor, rankExercise, type LogLike, type Sex } from "@/lib/ranks";
import type { GroupMember, SetLog, Workout, WorkoutExercise } from "@/lib/types";

export type FullWorkout = Workout & { groups: { name: string } | null; workout_exercises: WorkoutExercise[] };
export type WorkoutBundle = { workout: FullWorkout; members: GroupMember[] };
/**
 * Een set zoals getoond: uit de database, nog in de offline wachtrij (`pending`), of
 * definitief niet opgeslagen (`failed`, bijv. geen rechten meer).
 */
export type LogRow = SetLog & { pending?: boolean; failed?: boolean };

/** Eén eerdere set van iemand (andere trainingen), compact zodat hij in de cache past. */
export type HistRow = { s: string; x: string; d: string; n: number; w: number | null; r: number | null; t: string };
export type PrevSession = { date: string; sets: { set_number: number; weight: number | null; reps: number | null }[] };

export const setKey = (wex: string, uid: string, n: number) => `${wex}|${uid}|${n}`;
export const keyOfLog = (l: { workout_exercise_id: string; user_id: string; set_number: number }) =>
  setKey(l.workout_exercise_id, l.user_id, l.set_number);

/** Getal in Nederlandse notatie (62,5), zonder duizendtalpunt zodat het weer als invoer werkt. */
export function fmtNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "";
  return Number(n).toLocaleString("nl-NL", { maximumFractionDigits: 2, useGrouping: false });
}

/** Grote getallen met duizendtalpunt (voor volume e.d.). */
export const fmtBig = (n: number) => Math.round(n).toLocaleString("nl-NL");

/** "80 kg × 5", "12 reps", of bij een statische oefening (slug meegegeven) "45 s" / "10 kg × 45 s". */
export function fmtSet(l: { weight: number | null; reps: number | null }, slug?: string | null) {
  const w = l.weight != null && Number(l.weight) !== 0 ? `${fmtNum(l.weight)} kg` : "";
  const r = l.reps != null ? `${l.reps}` : "–";
  if (isTimed(slug)) return w ? `${w} × ${r} s` : `${r} s`;
  return w ? `${w} × ${r}` : `${r} reps`;
}

/** Leeg = null, ongeldig = NaN. Accepteert komma en punt. */
export function parseWeight(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export function parseReps(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

/**
 * Vangt typfouten af voordat ze in de database (en in records) belanden. Met `slug` gelden de
 * grenzen van die oefening: seconden bij statische houdingen, hogere aantallen bij oefeningen
 * waarvan de standaard boven de 100 reps ligt.
 */
export function validateSet(w: number | null, r: number | null, slug?: string | null): string | null {
  const timed = isTimed(slug);
  if (w !== null && (Number.isNaN(w) || w < 0)) return "Vul een geldig gewicht in, bijv. 62,5.";
  if (w !== null && w > 999) return "Meer dan 999 kg? Controleer het gewicht.";
  if (r !== null && (Number.isNaN(r) || r < 0)) return timed ? "Vul een geldig aantal seconden in." : "Vul een geldig aantal reps in.";
  const max = maxRepsFor(slug);
  if (r !== null && r > max) return timed ? "Meer dan een uur? Controleer het aantal seconden." : `Meer dan ${max} reps? Controleer het aantal.`;
  return null;
}

/** Sets uit de database plus wat er offline nog in de wachtrij staat voor deze training. */
export function mergeQueue(logs: SetLog[], queue: QueuedOp[], wexIds: Set<string>): LogRow[] {
  if (!queue.length) return logs;
  const map = new Map<string, LogRow>(logs.map((l) => [keyOfLog(l), l]));
  for (const op of queue) {
    const k = op.kind === "upsert" ? op.row : op.key;
    if (!wexIds.has(k.workout_exercise_id)) continue;
    const key = keyOfLog(k);
    if (op.kind === "delete") {
      map.delete(key);
      continue;
    }
    const existing = map.get(key);
    map.set(key, {
      id: existing?.id ?? `queued:${key}`,
      created_at: existing?.created_at ?? new Date(op.at ?? 0).toISOString(),
      ...op.row,
      pending: true,
    });
  }
  return [...map.values()];
}

/** Sets die definitief niet konden worden opgeslagen, zichtbaar als "niet opgeslagen" op de set zelf. */
export function mergeFailed(logs: LogRow[], failed: FailedOp[], wexIds: Set<string>): LogRow[] {
  if (!failed.length) return logs;
  const map = new Map<string, LogRow>(logs.map((l) => [keyOfLog(l), l]));
  let changed = false;
  for (const { op, at } of failed) {
    if (op.kind !== "upsert" || !wexIds.has(op.row.workout_exercise_id)) continue;
    const key = keyOfLog(op.row);
    // Een nieuwere wachtende bewerking op dezelfde set gaat voor.
    if (map.get(key)?.pending) continue;
    const existing = map.get(key);
    map.set(key, {
      id: existing?.id ?? `failed:${key}`,
      created_at: existing?.created_at ?? new Date(op.at ?? at).toISOString(),
      ...op.row,
      failed: true,
    });
    changed = true;
  }
  return changed ? [...map.values()] : logs;
}

/** Vervangt (of voegt toe) één set op basis van oefening, persoon en setnummer. */
export function upsertLocal(logs: SetLog[], row: SetLog): SetLog[] {
  const k = keyOfLog(row);
  const i = logs.findIndex((l) => keyOfLog(l) === k);
  if (i === -1) return [...logs, row];
  const next = logs.slice();
  next[i] = row;
  return next;
}

export function normalizeLog(row: Partial<SetLog> & Record<string, unknown>): SetLog {
  return {
    id: String(row.id),
    workout_exercise_id: String(row.workout_exercise_id),
    user_id: String(row.user_id),
    set_number: Number(row.set_number),
    reps: row.reps == null ? null : Number(row.reps),
    weight: row.weight == null ? null : Number(row.weight),
    created_at: String(row.created_at ?? ""),
  };
}

export const isDone = (l: { reps: number | null; failed?: boolean } | undefined) => !l?.failed && (l?.reps ?? 0) > 0;

// ─── Geschiedenis ───

/** Meest recente eerdere sessie per oefening (op of voor de datum van deze training). */
export function prevSessions(rows: HistRow[] | undefined, maxDate: string): Record<string, PrevSession> {
  const out: Record<string, PrevSession> = {};
  if (!rows) return out;
  const latest = new Map<string, { x: string; d: string; t: string }>();
  for (const r of rows) {
    if (r.d > maxDate) continue;
    const cur = latest.get(r.s);
    if (!cur || r.d > cur.d || (r.d === cur.d && r.t > cur.t)) latest.set(r.s, { x: r.x, d: r.d, t: r.t });
  }
  for (const [slug, { x, d }] of latest) {
    out[slug] = {
      date: d,
      sets: rows
        .filter((r) => r.x === x)
        .sort((a, b) => a.n - b.n)
        .map((r) => ({ set_number: r.n, weight: r.w, reps: r.r })),
    };
  }
  return out;
}

/** Alle eerdere sets per oefening (andere trainingen), voor records en ranks. */
export function logsBySlug(rows: HistRow[] | undefined): Map<string, LogLike[]> {
  const map = new Map<string, LogLike[]>();
  for (const r of rows ?? []) {
    if (r.r == null) continue;
    const list = map.get(r.s);
    if (list) list.push({ weight: r.w, reps: r.r });
    else map.set(r.s, [{ weight: r.w, reps: r.r }]);
  }
  return map;
}

export type Best = {
  e1rm: number | null;
  weight: number;
  reps: number;
  set: LogLike | null;
  /** Assisted machine (gewicht = ondersteuning): beste vergelijkingsscore, minder hulp is beter. */
  assist?: number;
};

/**
 * Beste prestatie: hoogste geschatte 1RM, anders zwaarste gewicht, of meeste reps (lichaamsgewicht).
 * Met de slug van een assisted machine telt minder ondersteuning (en meer reps) als beter.
 */
export function bestOf(logs: LogLike[], slug?: string | null): Best | null {
  if (isAssisted(slug)) {
    let assist: number | null = null;
    let set: LogLike | null = null;
    for (const l of logs) {
      const sc = assistedScore(l.weight, l.reps);
      if (sc != null && (assist == null || sc > assist)) {
        assist = sc;
        set = l;
      }
    }
    return assist == null || !set ? null : { e1rm: null, weight: Number(set.weight ?? 0), reps: set.reps ?? 0, set, assist };
  }
  let any = false;
  let e1rm: number | null = null;
  let e1rmSet: LogLike | null = null;
  let weight = 0;
  let weightSet: LogLike | null = null;
  let reps = 0;
  let repsSet: LogLike | null = null;
  for (const l of logs) {
    const w = Number(l.weight ?? 0);
    const r = l.reps ?? 0;
    if (r <= 0) continue;
    any = true;
    const e = w > 0 ? estimate1RM(w, r) : null;
    if (e != null && (e1rm == null || e > e1rm)) {
      e1rm = e;
      e1rmSet = l;
    }
    if (w > weight) {
      weight = w;
      weightSet = l;
    }
    if (w <= 0 && r > reps) {
      reps = r;
      repsSet = l;
    }
  }
  if (!any) return null;
  return { e1rm, weight, reps, set: e1rmSet ?? weightSet ?? repsSet };
}

export function describeBest(b: Best | null, slug?: string | null): string | null {
  if (!b || !b.set) return null;
  if (b.assist != null) return describeAssisted(b.set);
  if (b.e1rm != null) return `${fmtSet(b.set, slug)} (1RM ≈ ${fmtNum(Math.round(b.e1rm * 2) / 2)} kg)`;
  if (b.weight > 0) return `${fmtNum(b.weight)} kg`;
  return b.reps > 0 ? `${b.reps} ${isTimed(slug) ? "s" : "reps"}` : null;
}

/** "20 kg ondersteuning × 8" of "8 reps zonder ondersteuning". */
function describeAssisted(s: LogLike): string {
  const w = Number(s.weight ?? 0);
  return w > 0 ? `${fmtNum(w)} kg ondersteuning × ${s.reps ?? "–"}` : `${s.reps ?? "–"} reps zonder ondersteuning`;
}

/** Is deze set beter dan alles daarvoor? */
export function beats(value: LogLike, before: Best | null): boolean {
  if (!before || (value.reps ?? 0) <= 0) return false;
  if (before.assist != null) return (assistedScore(value.weight, value.reps) ?? 0) > before.assist + 1e-6;
  const w = Number(value.weight ?? 0);
  const r = value.reps ?? 0;
  const e = w > 0 ? estimate1RM(w, r) : null;
  if (e != null && before.e1rm != null) return e > before.e1rm + 1e-6;
  if (w > 0) return before.weight > 0 && w > before.weight;
  return before.reps > 0 && r > before.reps;
}

export type Profile = { bodyweight: number | null; sex: Sex | null; age: number | null };
export type Achievement =
  | { kind: "promotion"; tierIndex: number; post: boolean; suspicious: boolean; detail: string }
  | { kind: "record"; detail: string; suspicious: boolean };

/**
 * Promotie of persoonlijk record door deze set? `before` = alle eerdere sets van deze persoon
 * voor deze oefening (zonder deze set). Werkt ook voor oefeningen zonder rangstandaard.
 */
export function detectAchievement(slug: string, before: LogLike[], value: LogLike, p: Profile): Achievement | null {
  if ((value.reps ?? 0) <= 0) return null;
  const after = [...before, value];
  const prevBest = bestOf(before, slug);
  const suspicious = isSuspicious(value, prevBest);

  const r0 = rankExercise(slug, before, p.bodyweight, p.sex, p.age);
  const r1 = rankExercise(slug, after, p.bodyweight, p.sex, p.age);
  if (r1) {
    const detail = r1.viaAdded ? `${formatRankAmount(r1)} extra (1RM)` : formatRankBest(r1);
    if (!r0 || r1.tierIndex > r0.tierIndex) {
      // De allereerste rang telt alleen als promotie vanaf Zilver (anders is elke eerste set een melding).
      return { kind: "promotion", tierIndex: r1.tierIndex, post: !!r0 || r1.tierIndex >= 1, suspicious: suspicious || (!r0 && r1.tierIndex >= 5), detail };
    }
    if (r1.value > r0.value) return { kind: "record", detail, suspicious };
    return null;
  }

  // Geen rangstandaard of profiel onvolledig: vergelijk met je eigen beste prestatie.
  if (!beats(value, prevBest)) return null;
  const w = Number(value.weight ?? 0);
  const e = w > 0 && !isAssisted(slug) ? estimate1RM(w, value.reps ?? 0) : null;
  const detail = isAssisted(slug)
    ? describeAssisted(value)
    : e != null
      ? `${fmtSet(value, slug)} (1RM ≈ ${fmtNum(Math.round(e * 2) / 2)} kg)`
      : w > 0
        ? `${fmtNum(w)} kg, zwaarder dan ooit`
        : `${value.reps} ${isTimed(slug) ? "s" : "reps"}`;
  return { kind: "record", detail, suspicious };
}

/** Onwaarschijnlijke sprong ten opzichte van het vorige beste (waarschijnlijk een typfout). */
export function isSuspicious(value: LogLike, prev: Best | null): boolean {
  if (!prev) return false;
  if (prev.assist != null) return (assistedScore(value.weight, value.reps) ?? 0) > prev.assist * 1.3;
  const w = Number(value.weight ?? 0);
  const r = value.reps ?? 0;
  const e = w > 0 ? estimate1RM(w, r) : null;
  if (e != null && prev.e1rm != null) return e > prev.e1rm * 1.3;
  if (w > 0 && prev.weight > 0) return w > prev.weight * 1.3;
  if (w <= 0 && prev.reps > 0) return r > prev.reps * 1.5 + 3;
  return false;
}

// ─── Samenvatting ───

export function volumeOf(logs: LogLike[]): number {
  return logs.reduce((s, l) => s + (Number(l.weight ?? 0) > 0 && (l.reps ?? 0) > 0 ? Number(l.weight) * (l.reps ?? 0) : 0), 0);
}

export function repsOf(logs: LogLike[]): number {
  return logs.reduce((s, l) => s + Math.max(0, l.reps ?? 0), 0);
}

/** Geplande sets voor iemand: per oefening het doel, of meer als er meer gelogd is. */
export function plannedSets(exercises: WorkoutExercise[], logs: LogRow[], uid: string): number {
  return exercises.reduce((sum, we) => {
    const maxLogged = logs.reduce((m, l) => (l.workout_exercise_id === we.id && l.user_id === uid && isDone(l) ? Math.max(m, l.set_number) : m), 0);
    return sum + Math.max(we.target_sets, maxLogged);
  }, 0);
}

export function doneSets(logs: LogRow[], uid: string): number {
  return logs.reduce((n, l) => n + (l.user_id === uid && isDone(l) ? 1 : 0), 0);
}

// ─── Open sets per oefening (o.a. om de beurt trainen) ───

/** Een set die net is afgerond en daarom als gedaan telt, ook als hij nog niet in de lijst staat. */
export type JustDone = { uid: string; n: number };

/** Afgeronde setnummers van iemand bij deze oefening. */
function doneNumbers(we: WorkoutExercise, uid: string, logs: LogRow[], justDone?: JustDone): Set<number> {
  const done = new Set<number>();
  for (const l of logs) if (l.workout_exercise_id === we.id && l.user_id === uid && isDone(l)) done.add(l.set_number);
  if (justDone?.uid === uid) done.add(justDone.n);
  return done;
}

/** Heeft iemand bij deze oefening nog een open set? Het doel gehaald (ook met extra sets) telt als klaar. */
export function hasOpenSet(we: WorkoutExercise, uid: string, logs: LogRow[], justDone?: JustDone): boolean {
  return doneNumbers(we, uid, logs, justDone).size < we.target_sets;
}

/** Eerste set die nog open staat voor iemand bij deze oefening (anders de laatste geplande set). */
export function firstOpenIn(we: WorkoutExercise, uid: string, logs: LogRow[], justDone?: JustDone): number {
  const done = doneNumbers(we, uid, logs, justDone);
  for (let n = 1; n <= we.target_sets; n++) if (!done.has(n)) return n;
  return Math.max(1, we.target_sets);
}

/** Volgende persoon na `after` (in de gegeven volgorde, rondom) die bij deze oefening nog een open set heeft. */
export function nextWithOpenSet(we: WorkoutExercise, after: string, uids: string[], logs: LogRow[], justDone?: JustDone): string | null {
  const start = uids.indexOf(after);
  for (let i = 1; i <= uids.length; i++) {
    const uid = uids[(start + i) % uids.length];
    if (uid !== after && hasOpenSet(we, uid, logs, justDone)) return uid;
  }
  return null;
}

export function memberProfile(m: GroupMember | undefined, ageFrom: (d: string | null | undefined) => number | null): Profile {
  return {
    bodyweight: m?.profiles?.bodyweight_kg ?? null,
    sex: m?.profiles?.sex ?? null,
    age: ageFrom(m?.profiles?.birth_date),
  };
}
