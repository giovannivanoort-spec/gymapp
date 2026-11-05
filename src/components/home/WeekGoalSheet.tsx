"use client";

import { useMemo, useState } from "react";
import { Sheet } from "@/components/Sheet";
import { errorMessage, supabase } from "@/lib/supabase";
import { formatWeekRange, parseISODate, trainedDaysPerWeek, weekRange } from "@/lib/week";

const WEEKS = 8;

/** Weekdoel aanpassen (1–7) met de laatste 8 weken als staafjes. Alleen renderen als hij open is. */
export function WeekGoalSheet({
  userId,
  goal,
  days,
  today,
  onClose,
  onSaved,
}: {
  userId: string;
  goal: number;
  days: Set<string> | null;
  today: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [value, setValue] = useState(goal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weeks = useMemo(() => {
    const per = trainedDaysPerWeek(days ?? []);
    const now = parseISODate(today);
    return Array.from({ length: WEEKS }, (_, i) => {
      const range = weekRange(i - (WEEKS - 1), now);
      return { range, count: per.get(range.from) ?? 0, current: i === WEEKS - 1 };
    });
  }, [days, today]);
  const met = weeks.filter((w) => !w.current && w.count >= value).length;

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("profiles").update({ weekly_goal: value }).eq("id", userId);
    if (error) {
      setBusy(false);
      setError(errorMessage(error));
      return;
    }
    await onSaved();
    setBusy(false);
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title="Weekdoel">
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm text-muted">Hoe vaak wil je per week trainen?</p>
          <div className="grid grid-cols-7 gap-1.5" role="radiogroup" aria-label="Trainingen per week">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={value === n}
                onClick={() => setValue(n)}
                className={`h-11 rounded-xl text-base font-bold tabular-nums transition active:scale-95 ${
                  value === n ? "bg-accent text-accent-ink" : "border border-line bg-surface-2 text-ink hover:border-muted"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Laatste {WEEKS} weken</p>
            {days && (
              <p className="text-xs text-muted">
                <span className="font-semibold text-ink tabular-nums">{met}</span> van {WEEKS - 1} gehaald met dit doel
              </p>
            )}
          </div>
          <div className="rounded-xl bg-surface-2 px-3 pb-2 pt-3">
            <div className="relative flex h-20 items-end gap-1.5">
              {/* Doellijn */}
              <div
                className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-ink/50 transition-[bottom] duration-300"
                style={{ bottom: `${(value / 7) * 100}%` }}
                aria-hidden
              />
              {weeks.map((w) => {
                const hit = w.count >= value;
                return (
                  <div
                    key={w.range.from}
                    className={`flex-1 rounded-t-md ${hit ? "bg-accent" : w.current ? "bg-accent/35" : "bg-line"}`}
                    style={{ height: days ? `max(3px, ${(w.count / 7) * 100}%)` : "3px", transition: "height 0.6s cubic-bezier(0.2,0.8,0.2,1)" }}
                    role="img"
                    aria-label={`${formatWeekRange(w.range)}: ${w.count} ${w.count === 1 ? "training" : "trainingen"}`}
                  />
                );
              })}
            </div>
            <div className="mt-1.5 flex gap-1.5" aria-hidden>
              {weeks.map((w) => (
                <span
                  key={w.range.from}
                  className={`flex-1 text-center text-[10px] font-semibold tabular-nums ${w.count >= value ? "text-accent" : "text-muted"}`}
                >
                  {days ? w.count : "–"}
                </span>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted">De laatste staaf is deze week. Kies een doel dat je de meeste weken haalt.</p>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        <button className="btn-primary w-full" onClick={save} disabled={busy || value === goal}>
          {busy ? "Opslaan…" : value === goal ? "Dit is je huidige doel" : `Doel op ${value} per week zetten`}
        </button>
      </div>
    </Sheet>
  );
}
