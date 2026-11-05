"use client";

import { useRef } from "react";
import { formatDate, toISODate } from "@/lib/dates";
import { ChevronRightIcon } from "./Icons";

const WEEKDAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];

/** Intensiteit van een getrainde dag op basis van het aantal sets. */
function heatClass(sets: number): string {
  if (sets >= 16) return "bg-accent text-accent-ink";
  if (sets >= 8) return "bg-accent/80 text-accent-ink";
  return "bg-accent/55 text-accent-ink";
}

/**
 * Maandkalender (maandag eerst). Getrainde dagen zijn gevuld (voller = meer sets), geplande
 * (nog niet gedane) dagen hebben een rand. Tik op een dag om hem te selecteren; veeg horizontaal
 * om van maand te wisselen.
 */
export function MonthCalendar({
  month,
  onMonth,
  selected,
  onSelect,
  trained,
  planned,
  monthsAhead = 0,
  heat = true,
}: {
  /** Eerste dag van de getoonde maand. */
  month: Date;
  onMonth: (m: Date) => void;
  selected: string | null;
  onSelect: (iso: string) => void;
  /** Datum → aantal gelogde sets. */
  trained: Map<string, number>;
  planned: Set<string>;
  /** Hoeveel maanden vooruit je mag bladeren (bijv. 1 om geplande trainingen te zien). */
  monthsAhead?: number;
  /** Getrainde dagen kleuren naar aantal sets. */
  heat?: boolean;
}) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const lead = (new Date(year, m, 1).getDay() + 6) % 7;
  const today = toISODate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => toISODate(new Date(year, m, i + 1))),
  ];
  const label = month.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
  const now = new Date();
  const monthIndex = year * 12 + m;
  const currentIndex = now.getFullYear() * 12 + now.getMonth();
  const canNext = monthIndex < currentIndex + monthsAhead;
  const isCurrentMonth = monthIndex === currentIndex;

  const go = (delta: number) => {
    if (delta > 0 && !canNext) return;
    onMonth(new Date(year, m + delta, 1));
  };

  // Horizontaal vegen wisselt van maand; verticaal scrollen blijft gewoon werken (touch-pan-y).
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => go(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink active:scale-90"
          aria-label="Vorige maand"
        >
          <ChevronRightIcon className="rotate-180" />
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <p className="font-bold capitalize" aria-live="polite">
            {label}
          </p>
          {!isCurrentMonth && (
            <button
              type="button"
              onClick={() => {
                onMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                onSelect(today);
              }}
              className="animate-fade-in rounded-lg border border-line px-2 py-0.5 text-xs font-semibold text-muted transition hover:border-muted hover:text-ink"
            >
              Vandaag
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={!canNext}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink active:scale-90 disabled:opacity-30 disabled:active:scale-100"
          aria-label="Volgende maand"
        >
          <ChevronRightIcon />
        </button>
      </div>

      <div
        key={`${year}-${m}`}
        className="animate-fade-in grid touch-pan-y grid-cols-7 gap-1 text-center"
        onPointerDown={(e) => {
          start.current = { x: e.clientX, y: e.clientY };
          swiped.current = false;
        }}
        onPointerUp={(e) => {
          const s = start.current;
          start.current = null;
          if (!s) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            swiped.current = true;
            go(dx < 0 ? 1 : -1);
          }
        }}
        onPointerCancel={() => {
          start.current = null;
        }}
      >
        {WEEKDAYS.map((d) => (
          <span key={d} className="pb-1 text-[11px] font-medium uppercase tracking-wide text-muted" aria-hidden>
            {d}
          </span>
        ))}
        {cells.map((iso, i) => {
          if (!iso) return <span key={`e${i}`} />;
          const sets = trained.get(iso) ?? 0;
          const isPlanned = planned.has(iso) && !sets;
          const isSelected = iso === selected;
          const isToday = iso === today;
          const description = sets ? `${sets} ${sets === 1 ? "set" : "sets"}` : isPlanned ? "gepland" : "";
          return (
            <button
              type="button"
              key={iso}
              onClick={() => {
                if (swiped.current) {
                  swiped.current = false;
                  return;
                }
                onSelect(iso);
              }}
              aria-label={`${formatDate(iso)}${isToday ? ", vandaag" : ""}${description ? `, ${description}` : ""}`}
              aria-pressed={isSelected}
              className={`relative mx-auto flex aspect-square w-full max-w-11 items-center justify-center rounded-xl text-sm font-semibold tabular-nums transition duration-150 active:scale-90 ${
                sets
                  ? `${heat ? heatClass(sets) : "bg-accent text-accent-ink"} hover:brightness-110`
                  : isPlanned
                    ? "border border-accent/60 text-ink hover:bg-surface-2"
                    : iso > today
                      ? "text-muted/40"
                      : "text-muted hover:bg-surface-2"
              } ${isSelected ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : ""}`}
            >
              {Number(iso.slice(8))}
              {isToday && !sets && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          {heat ? (
            <span className="flex gap-0.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-[3px] bg-accent/55" />
              <span className="h-2.5 w-2.5 rounded-[3px] bg-accent/80" />
              <span className="h-2.5 w-2.5 rounded-[3px] bg-accent" />
            </span>
          ) : (
            <span className="h-2.5 w-2.5 rounded-[3px] bg-accent" aria-hidden />
          )}
          {heat ? "Getraind (meer sets = voller)" : "Getraind"}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] border border-accent/60" aria-hidden /> Gepland
        </span>
      </div>
    </div>
  );
}
