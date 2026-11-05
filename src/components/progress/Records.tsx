"use client";

import { useMemo, useState } from "react";
import { ChevronRightIcon } from "@/components/Icons";
import { formatDate } from "@/lib/dates";
import { isTimed } from "@/lib/exercises";
import { formatSet, nl, type Session } from "@/lib/history";
import { exerciseName, isWeighted, sessionValue } from "@/lib/progress/records";

/** Beste prestatie per oefening, als lijst die op een telefoon zonder horizontaal scrollen past. */
export function Records({
  sessions,
  selected,
  onOpen,
}: {
  sessions: Map<string, Session[]>;
  selected?: string | null;
  /** Tik op een record: toon de grafiek van die oefening. */
  onOpen: (slug: string) => void;
}) {
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () =>
      [...sessions]
        .map(([slug, list]) => {
          const weighted = isWeighted(list);
          const best = list.reduce((a, b) => (sessionValue(b, weighted) > sessionValue(a, weighted) ? b : a));
          return { slug, name: exerciseName(slug), weighted, best, count: list.length };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "nl")),
    [sessions],
  );
  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Records</h2>
        <span className="text-xs text-muted">{rows.length} oefeningen</span>
      </div>
      {rows.length > 8 && (
        <input
          type="search"
          className="input"
          placeholder="Zoek een oefening"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Zoek in records"
        />
      )}
      {shown.length === 0 ? (
        <p className="card text-sm text-muted">Geen oefening gevonden met &quot;{query.trim()}&quot;.</p>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden p-0">
          {shown.map((r) => (
            <li key={r.slug}>
              <button
                type="button"
                onClick={() => onOpen(r.slug)}
                aria-current={selected === r.slug ? "true" : undefined}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2 active:bg-surface-2 aria-[current=true]:bg-surface-2/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{r.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {formatDate(r.best.date, { weekday: undefined, month: "short", year: "2-digit" })} · {r.count}{" "}
                    {r.count === 1 ? "training" : "trainingen"}
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className="block text-sm font-bold">
                    {r.weighted ? `${nl(r.best.best1RM ?? 0)} kg` : `${r.best.maxReps} ${isTimed(r.slug) ? "s" : "reps"}`}
                  </span>
                  <span className="block text-xs text-muted">{formatSet(r.best.bestSet)}</span>
                </span>
                <ChevronRightIcon size={14} className="shrink-0 text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-center text-xs text-muted">1RM is geschat met de formule van Epley op sets tot 12 herhalingen.</p>
    </section>
  );
}
