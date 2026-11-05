"use client";

import { useState } from "react";
import { useCachedState } from "@/lib/cache";
import { formatDate, relativeDay, toISODate } from "@/lib/dates";
import { fmt } from "@/lib/nutrition/format";
import { addLogs, fetchLogs, freshFetch, logToFood, nutritionKeys, type FoodLog } from "@/lib/nutrition/log";
import { MEALS, sumMacros } from "@/lib/nutrition/types";
import { errorMessage } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { Sheet } from "../Sheet";
import { shiftDate } from "./WeekOverview";

/** Zelfde product, hoeveelheid en maaltijd: dan staat het er al. */
export const sameEntry = (a: FoodLog, b: Pick<FoodLog, "food_id" | "grams" | "meal">) =>
  a.food_id === b.food_id && a.meal === b.meal && Math.abs(a.grams - b.grams) < 0.05;

/**
 * Een hele dag kopiëren naar een andere dag (bijv. "morgen hetzelfde eten").
 * Naar een dag in de toekomst wordt het een planning die je op die dag bevestigt.
 */
export function CopyDaySheet({
  from,
  logs,
  onClose,
  onCopied,
}: {
  from: string;
  /** De items die meetellen op de brondag. */
  logs: FoodLog[];
  onClose: () => void;
  onCopied: (added: FoodLog[], target: string) => void;
}) {
  const { session } = useAuth();
  const uid = session?.user.id ?? "anon";
  const today = toISODate();
  const options = Array.from({ length: 9 }, (_, i) => shiftDate(today, i - 1)).filter((d) => d !== from);
  const [target, setTarget] = useState(from < today ? today : shiftDate(from, 1) <= shiftDate(today, 7) ? shiftDate(from, 1) : options[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  // Wat er al op de doeldag staat (gedeeld met het dagboek in de cache).
  const targetDay = useCachedState(nutritionKeys.day(uid, target), () => freshFetch(() => fetchLogs(target, target)), { maxAge: 30_000 });
  const existing = targetDay.data;
  // Kon de doeldag niet geladen worden (bijv. offline)? Dan toch kopiëren, maar zonder dubbele-check.
  const unchecked = existing === undefined && targetDay.error != null;
  const checking = existing === undefined && !unchecked;
  const duplicates = existing ? logs.filter((l) => existing.some((e) => sameEntry(e, l))) : [];
  const toCopy = skipDuplicates ? logs.filter((l) => !duplicates.includes(l)) : logs;
  const totals = sumMacros(logs);
  const planned = target > today;

  function pickTarget(d: string) {
    setTarget(d);
    // Elke doeldag begint weer met "dubbele overslaan" aan.
    setSkipDuplicates(true);
    setError(null);
  }

  async function copy() {
    // Zolang we niet weten wat er al op de doeldag staat, kunnen we dubbele items niet overslaan.
    if (busy || checking) return;
    setBusy(true);
    setError(null);
    try {
      const added = await addLogs(
        toCopy.map((l) => ({ food: logToFood(l), grams: l.grams, meal: l.meal, date: target, portionLabel: l.portion_label })),
      );
      onCopied(added, target);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Dag kopiëren">
      <div className="space-y-5">
        <p className="text-sm text-muted">
          Kopieer alles van <span className="font-semibold text-ink">{relativeDay(from).toLowerCase()}</span> ({logs.length}{" "}
          {logs.length === 1 ? "item" : "items"}, {fmt(totals.kcal)} kcal) naar:
        </p>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Doeldag">
          {options.map((d) => {
            const active = d === target;
            return (
              <button
                key={d}
                role="radio"
                aria-checked={active}
                onClick={() => pickTarget(d)}
                className={`flex min-h-14 flex-col items-center justify-center rounded-xl border text-xs transition active:scale-95 ${
                  active ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface-2 text-muted hover:text-ink"
                }`}
              >
                <span className="font-semibold capitalize">
                  {d === today ? "Vandaag" : d === shiftDate(today, 1) ? "Morgen" : d === shiftDate(today, -1) ? "Gisteren" : formatDate(d, { weekday: "short", day: undefined, month: undefined })}
                </span>
                <span className={active ? "" : "text-muted"}>{formatDate(d, { weekday: undefined, month: "short" })}</span>
              </button>
            );
          })}
        </div>

        <ul className="space-y-1 rounded-2xl bg-surface-2 p-3 text-xs text-muted">
          {MEALS.map((m) => {
            const items = logs.filter((l) => l.meal === m.id);
            if (!items.length) return null;
            return (
              <li key={m.id} className="flex justify-between gap-3">
                <span className="truncate">
                  <span className="font-semibold text-ink">{m.label}</span> · {items.map((l) => l.name).join(", ")}
                </span>
                <span className="shrink-0 tabular-nums">{fmt(sumMacros(items).kcal)} kcal</span>
              </li>
            );
          })}
        </ul>

        {unchecked ? (
          <p className="animate-fade-in rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted" role="status">
            Kon niet controleren wat er al op {relativeDay(target).toLowerCase()} staat. Je kunt toch kopiëren; dubbele items worden dan niet overgeslagen.
          </p>
        ) : existing === undefined ? (
          <div className="skeleton h-5 w-2/3" aria-hidden />
        ) : existing.length > 0 ? (
          <div className="animate-fade-in space-y-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs">
            <p className="text-ink">
              Op {relativeDay(target).toLowerCase()} staan al {existing.length} {existing.length === 1 ? "item" : "items"}; de kopie wordt aangevuld.
            </p>
            {duplicates.length > 0 && (
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-muted">
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />
                {duplicates.length} {duplicates.length === 1 ? "item staat" : "items staan"} er al precies zo: overslaan
              </label>
            )}
          </div>
        ) : null}

        {planned && <p className="text-xs text-muted">Dit wordt een planning: op die dag bevestig je per item wat je echt hebt gegeten.</p>}
        {error && (
          <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <button className="btn-primary w-full py-3" onClick={copy} disabled={busy || checking || !toCopy.length}>
          {busy
            ? planned
              ? "Plannen…"
              : "Kopiëren…"
            : checking
              ? "Controleren…"
              : !toCopy.length
              ? "Alles staat er al"
              : `${planned ? "Plannen" : "Kopiëren"} naar ${relativeDay(target).toLowerCase()}${toCopy.length !== logs.length ? ` (${toCopy.length})` : ""}`}
        </button>
      </div>
    </Sheet>
  );
}
