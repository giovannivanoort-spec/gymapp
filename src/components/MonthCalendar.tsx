"use client";

import { toISODate } from "@/lib/dates";
import { ChevronRightIcon } from "./Icons";

const WEEKDAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];

/**
 * Maandkalender (maandag eerst). Getrainde dagen zijn gevuld, geplande (nog niet gedane) dagen
 * hebben een rand. Tik op een dag om hem te selecteren.
 */
export function MonthCalendar({
  month,
  onMonth,
  selected,
  onSelect,
  trained,
  planned,
}: {
  /** Eerste dag van de getoonde maand. */
  month: Date;
  onMonth: (m: Date) => void;
  selected: string | null;
  onSelect: (iso: string) => void;
  /** Datum → aantal gelogde sets. */
  trained: Map<string, number>;
  planned: Set<string>;
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
  const isCurrentMonth = year === new Date().getFullYear() && m === new Date().getMonth();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => onMonth(new Date(year, m - 1, 1))}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink"
          aria-label="Vorige maand"
        >
          <ChevronRightIcon className="rotate-180" />
        </button>
        <p className="font-bold capitalize">{label}</p>
        <button
          onClick={() => onMonth(new Date(year, m + 1, 1))}
          disabled={isCurrentMonth}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-30"
          aria-label="Volgende maand"
        >
          <ChevronRightIcon />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d) => (
          <span key={d} className="pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
            {d}
          </span>
        ))}
        {cells.map((iso, i) => {
          if (!iso) return <span key={`e${i}`} />;
          const sets = trained.get(iso) ?? 0;
          const isPlanned = planned.has(iso) && !sets;
          const isSelected = iso === selected;
          const isToday = iso === today;
          return (
            <button
              key={iso}
              onClick={() => onSelect(iso)}
              aria-label={`${iso}${sets ? `, ${sets} sets` : isPlanned ? ", gepland" : ""}`}
              aria-pressed={isSelected}
              className={`relative mx-auto flex aspect-square w-full max-w-11 items-center justify-center rounded-xl text-sm font-semibold tabular-nums transition duration-150 active:scale-90 ${
                sets
                  ? "bg-accent text-accent-ink hover:brightness-110"
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

      <div className="flex justify-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-accent" /> Getraind
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] border border-accent/60" /> Gepland
        </span>
      </div>
    </div>
  );
}
