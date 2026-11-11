"use client";

import Link from "next/link";
import { useMemo } from "react";
import { formatDate, parseISODate } from "@/lib/dates";
import { formatSet, nl, type Session } from "@/lib/history";
import { REP_COUNTS, repRecords, type RepRecord } from "@/lib/progress/records";

/**
 * "3 nov" voor een record van dit jaar, anders maand en jaar: "nov ’24" (met apostrof, zodat het
 * jaar niet als dag leest; past ook op de smalste tegels). De volledige datum staat in het aria-label.
 */
function shortDate(iso: string): string {
  const date = parseISODate(iso);
  if (date.getFullYear() === new Date().getFullYear()) {
    return formatDate(iso, { weekday: undefined, month: "short", year: undefined });
  }
  const month = date.toLocaleDateString("nl-NL", { month: "short" }).replace(".", "");
  return `${month} ’${String(date.getFullYear()).slice(2)}`;
}

/**
 * Datum van de nieuwste records: elk tegel met die datum krijgt de accentrand (één set kan meerdere
 * records zetten, 80 kg × 10 is ook je 5RM en 8RM). Null als alle records van één datum komen: dan
 * zou elk tegel gemarkeerd zijn en zegt de rand niets.
 */
function newestDate(records: RepRecord[]): string | null {
  const dates = [...new Set(records.flatMap((r) => (r ? [r.date] : [])))].sort();
  return dates.length >= 2 ? dates[dates.length - 1] : null;
}

/**
 * Getal op het tegel, zonder eenheid (die staat één keer in de uitleg): "80", "101,25" (plaatjes
 * van 1,25 kg), of extra gewicht bij een lichaamsgewicht-oefening: "+10".
 */
function weightText(r: NonNullable<RepRecord>): string {
  return `${r.added ? "+" : ""}${nl(r.weight, 2)}`;
}

/** Gewicht voor de schermlezer: "80 kg", "10 kg extra" of "alleen lichaamsgewicht". */
function weightSpoken(r: NonNullable<RepRecord>): string {
  if (!r.added) return `${nl(r.weight, 2)} kg`;
  return r.weight > 0 ? `${nl(r.weight, 2)} kg extra` : "alleen lichaamsgewicht";
}

/**
 * Gevulde en lege tegels hebben allebei een rand (transparant of gestippeld): zelfde maat. De
 * eenheid staat in de uitleg, niet per tegel, zodat "+102,5" ook op 320px breed (4 kolommen van
 * zo'n 50px binnenin) op één regel past; 12px-cijfers op de smalste schermen, 13px vanaf 360px.
 * min-w-0 en overflow-hidden houden een uitschieter binnen de afgeronde rand.
 */
const TILE = "flex h-full min-h-11 min-w-0 flex-col items-center overflow-hidden rounded-xl border px-1 py-2 text-center";
const NUMBER = "max-w-full whitespace-nowrap text-xs font-bold tabular-nums min-[360px]:text-[13px]";
const LABEL = "text-[10px] font-semibold uppercase tracking-wide text-muted";

/**
 * Rep-records van één oefening: per herhalingsaantal (1RM t/m 12RM) het zwaarste gewicht dat je
 * echt voor minstens dat aantal reps tilde (geen schatting). De records van de nieuwste datum
 * krijgen een accentrand (niet als alles van één datum komt); tik opent die training. Telefoon: 4 + 3 tegels, breder: één rij van 7. Bij
 * lichaamsgewicht-oefeningen (pull-up, dips) staat er extra gewicht ("+10 kg", "+0 kg" = alleen
 * lichaamsgewicht). Niets als rep-records niet gelden (repRecordMode): statische oefeningen, assisted
 * machines, oefeningen die op de zwaarste set scoren (dragen, sled, swings), band-oefeningen en
 * oefeningen zonder gewicht. `headingClassName` laat de kop aansluiten bij die van de omringende kaart.
 */
export function RepRecordsGrid({
  sessions,
  className = "",
  headingClassName = "font-medium",
}: {
  sessions: Session[];
  className?: string;
  headingClassName?: string;
}) {
  const records = useMemo(() => repRecords(sessions), [sessions]);
  if (!records.some((r) => r)) return null;
  const ringDate = newestDate(records);
  const added = records.some((r) => r?.added);

  return (
    <div className={className}>
      <p className={`text-[11px] uppercase tracking-wide text-muted ${headingClassName}`}>Rep-records</p>
      <p className="mb-1.5 text-[11px] text-muted">
        {added
          ? "Meeste extra gewicht in kg voor minstens dat aantal reps (+0 is alleen lichaamsgewicht)"
          : "Zwaarste gewicht in kg dat je echt voor minstens dat aantal reps tilde"}
      </p>
      <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {REP_COUNTS.map((n, i) => {
          const r = records[i];
          const label = `${n}RM`;
          const newest = r != null && r.date === ringDate;
          return (
            <li key={n} className="min-w-0">
              {r ? (
                <Link
                  href={`/workouts/${r.workoutId}`}
                  className={`${TILE} border-transparent bg-surface-2 transition hover:border-line active:scale-[0.97] active:bg-line${newest ? " ring-1 ring-accent/50" : ""}`}
                  aria-label={`${label}: ${weightSpoken(r)}, ${formatSet(r.set)} op ${formatDate(r.date)}${newest ? ", nieuwste record" : ""}`}
                >
                  <span className={LABEL}>{label}</span>
                  <span className={NUMBER}>{weightText(r)}</span>
                  <span className="max-w-full truncate text-[10px] text-muted">{shortDate(r.date)}</span>
                </Link>
              ) : (
                <div className={`${TILE} border-dashed border-line`}>
                  <span className="sr-only">{label}: nog geen record</span>
                  <span className={LABEL} aria-hidden>
                    {label}
                  </span>
                  <span className={`${NUMBER} text-muted`} aria-hidden>
                    –
                  </span>
                  {/* Zelfde hoogte als een gevuld tegel. */}
                  <span className="invisible text-[10px]" aria-hidden>
                    –
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
