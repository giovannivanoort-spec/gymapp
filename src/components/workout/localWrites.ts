import type { SetLog } from "@/lib/types";
import { keyOfLog } from "./logic";

/**
 * Wat dit toestel zelf aan sets heeft opgeslagen of gewist, totdat de server het bevestigt.
 *
 * Waarom: de service worker kan bij zwak bereik een oude, bewaarde versie van de sets
 * teruggeven, en een herlaadactie die vóór een opslag begon kan pas daarna terugkomen. Zo'n
 * antwoord mag sets die je net hebt ingevuld nooit wegvegen. Per set onthouden we de waarde die
 * er nu hoort te staan (`cur`) en de waarden die daardoor achterhaald zijn (`known`):
 * - komt de server met `cur`: bevestigd, de notitie vervalt;
 * - komt de server met een achterhaalde waarde: verouderd antwoord, onze waarde blijft staan;
 * - komt de server met iets onbekends: iemand anders heeft de set daarna aangepast, dat wint.
 */

type Value = { weight: number | null; reps: number | null };
type Entry = { cur: string; w: number | null; r: number | null; known: string[]; at: number };

const ABSENT = "-";
const PREFIX = "gymapp-writes:";
const MAX_AGE = 18 * 3600_000;

export const sigOf = (v: Value | null | undefined) => (v ? `${v.weight ?? ""}|${v.reps ?? ""}` : ABSENT);

export class LocalWrites {
  private map = new Map<string, Entry>();

  constructor(private workoutId: string) {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFIX + workoutId) ?? "null") as Record<string, Entry> | null;
      const now = Date.now();
      for (const [k, e] of Object.entries(raw ?? {})) if (e && now - e.at < MAX_AGE) this.map.set(k, e);
    } catch {
      // geen opslag: alleen in het geheugen
    }
  }

  private save() {
    try {
      if (this.map.size) localStorage.setItem(PREFIX + this.workoutId, JSON.stringify(Object.fromEntries(this.map)));
      else localStorage.removeItem(PREFIX + this.workoutId);
    } catch {
      // niet kunnen bewaren is geen probleem: het geheugen werkt nog
    }
  }

  /** Lokale wijziging: `prev` is wat er stond, `next` wat er nu hoort te staan (null = gewist). */
  record(key: string, prev: Value | null | undefined, next: Value | null) {
    const e = this.map.get(key);
    const cur = sigOf(next);
    const known = new Set(e ? [...e.known, e.cur] : []);
    known.add(sigOf(prev));
    known.delete(cur);
    this.map.set(key, { cur, w: next?.weight ?? null, r: next?.reps ?? null, known: [...known].slice(-12), at: Date.now() });
    this.save();
  }

  forget(key: string) {
    if (this.map.delete(key)) this.save();
  }

  /**
   * Live update van de server. `false` = oude echo van een eigen opslag (negeren);
   * `true` = toepassen (bevestiging, of een nieuwere wijziging van iemand anders).
   */
  remote(key: string, row: Value | null): boolean {
    const e = this.map.get(key);
    if (!e) return true;
    const s = sigOf(row);
    if (s === e.cur) return true;
    if (e.known.includes(s)) return false;
    this.map.set(key, { cur: s, w: row?.weight ?? null, r: row?.reps ?? null, known: [...e.known, e.cur].slice(-12), at: Date.now() });
    this.save();
    return true;
  }

  /** Legt de lokale wijzigingen over een (mogelijk verouderd) antwoord van de server. */
  reconcile(fetched: SetLog[]): SetLog[] {
    if (!this.map.size) return fetched;
    const byKey = new Map(fetched.map((l) => [keyOfLog(l), l]));
    let changed = false;
    for (const [key, e] of this.map) {
      const row = byKey.get(key);
      const s = sigOf(row);
      if (s === e.cur || !e.known.includes(s)) {
        // Bevestigd, of daarna door iemand anders aangepast.
        this.map.delete(key);
        changed = true;
        continue;
      }
      if (e.cur === ABSENT) {
        byKey.delete(key);
        continue;
      }
      const [wex, uid, n] = key.split("|");
      byKey.set(key, {
        id: row?.id ?? `tmp:${key}`,
        workout_exercise_id: wex,
        user_id: uid,
        set_number: Number(n),
        weight: e.w,
        reps: e.r,
        created_at: row?.created_at ?? new Date(e.at).toISOString(),
      });
    }
    if (changed) this.save();
    return [...byKey.values()];
  }
}

const instances = new Map<string, LocalWrites>();

/** Eén notitieblok per training (gedeeld tussen renders en herlaadacties). */
export function writesFor(workoutId: string): LocalWrites {
  let w = instances.get(workoutId);
  if (!w) {
    w = new LocalWrites(workoutId);
    instances.set(workoutId, w);
  }
  return w;
}
