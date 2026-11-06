import { toISODate } from "@/lib/dates";
import { addDays, parseISODate } from "@/lib/week";

const weekday = (iso: string) => parseISODate(iso).toLocaleDateString("nl-NL", { weekday: "long" });

/** "Afgelopen nacht" (wakker geworden vandaag), anders "Nacht van zondag op maandag". */
export function nightLabel(date: string, today: string = toISODate()): string {
  if (date === today) return "Afgelopen nacht";
  return `Nacht van ${weekday(toISODate(addDays(parseISODate(date), -1)))} op ${weekday(date)}`;
}

/** Korte weekdag + datum van wakker worden, bijv. "ma 3 nov". */
export function shortWakeDay(date: string): string {
  return parseISODate(date)
    .toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })
    .replace(/\./g, "");
}

/** Procent van het slaapdoel (0–100, afgekapt). */
export function goalPct(minutes: number | null | undefined, goal: number): number {
  if (minutes == null || !Number.isFinite(minutes) || goal <= 0) return 0;
  return Math.max(0, Math.min(100, (minutes / goal) * 100));
}

/** Haalde deze nacht het slaapdoel? */
export function goalMet(minutes: number | null | undefined, goal: number): boolean {
  return minutes != null && Number.isFinite(minutes) && minutes >= goal;
}
