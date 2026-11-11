"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowUpIcon } from "@/components/Icons";
import { isTimed } from "@/lib/exercises";
import { nl, type HistorySet } from "@/lib/history";
import { parseISODate, weekRange } from "@/lib/week";
import { findRecords, kg, type PersonalRecord } from "./data";

/** Kop van een recordkaart: wat voor record het is. */
function recordLabel(r: PersonalRecord): string {
  if (r.kind === "rep") return r.added ? `${r.reps}RM · extra gewicht` : `${r.reps}RM-record`;
  return r.unit === "kg" ? "Geschatte 1RM" : isTimed(r.slug) ? "Langste set" : "Max. reps";
}

/**
 * Waarde (of winst) van een record. Rep-records zijn echt getild gewicht: twee decimalen (plaatjes
 * van 1,25 kg), bij lichaamsgewicht-oefeningen extra gewicht ("+12,5 kg"). De geschatte 1RM op 0,1 kg.
 */
function recordAmount(r: PersonalRecord, n: number, isDelta = false): string {
  if (r.kind === "rep") return `${r.added && !isDelta ? "+" : ""}${nl(n, 2)} kg`;
  return r.unit === "kg" ? kg(n) : isTimed(r.slug) ? `${n} s` : String(n);
}

/**
 * Nieuwe persoonlijke records van deze week: geschatte 1RM (reps of seconden bij lichaamsgewicht),
 * of anders een rep-record. Zelfde regels als het afrondscherm en de voortgangspagina (findRecords).
 */
export function WeekRecords({ history, today }: { history: HistorySet[] | undefined; today: string }) {
  const from = weekRange(0, parseISODate(today)).from;
  const records = useMemo(
    () => (history ? findRecords(history, (s) => s.date >= from && s.date <= today) : []),
    [history, from, today],
  );
  if (!records.length) return null;

  return (
    <section className="space-y-3" aria-labelledby="home-records">
      <div className="flex items-center justify-between">
        <h2 id="home-records" className="text-sm font-semibold uppercase tracking-wide text-muted">
          Records deze week
        </h2>
        <Link href="/progress" className="-my-3 flex min-h-11 items-center px-1 text-xs font-semibold text-muted hover:text-ink">
          Progressie
        </Link>
      </div>
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {records.map((r, i) => (
          <li key={r.slug} className="shrink-0">
            <Link
              href={`/exercises/${r.slug}`}
              className="card animate-fade-up flex w-40 flex-col gap-1 p-3 hover:border-muted"
              style={{ "--i": i } as React.CSSProperties}
            >
              <span className="truncate text-xs font-semibold">{r.name}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted">
                {recordLabel(r)}
              </span>
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-lg font-extrabold tabular-nums leading-tight">
                  {recordAmount(r, r.value)}
                </span>
                <span className="flex items-center gap-0.5 text-[11px] font-semibold tabular-nums text-accent">
                  <ArrowUpIcon size={11} strokeWidth={2.6} />
                  {recordAmount(r, r.delta, true)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
