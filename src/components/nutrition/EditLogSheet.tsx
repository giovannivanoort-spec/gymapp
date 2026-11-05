"use client";

import { useState } from "react";
import { formatDate, relativeDay, toISODate } from "@/lib/dates";
import { fmt, parseAmount } from "@/lib/nutrition/format";
import { addLogs, deleteLog, isQuick, logToFood, markNutritionMutation, updateLog, type FoodLog } from "@/lib/nutrition/log";
import { macrosFor, MEALS, type Macros, type Meal } from "@/lib/nutrition/types";
import { errorMessage } from "@/lib/supabase";
import { CalendarIcon, CheckIcon, CloseIcon } from "../Icons";
import { Sheet } from "../Sheet";
import { MACRO_COLORS, MacroStat as Stat } from "./MacroSummary";
import { QuickAddForm } from "./QuickAddForm";
import { shiftDate } from "./WeekOverview";

const FACTORS = [0.5, 1, 1.5, 2];

type Busy = "save" | "eaten" | "delete" | "move" | "copy" | null;

/**
 * Een gelogd item aanpassen: hoeveelheid, maaltijd, verplaatsen of kopiëren naar een andere dag,
 * verwijderen. Bij gepland eten (vandaag of eerder) kun je eerst de hoeveelheid aanpassen en dan in
 * één keer bevestigen dat je het hebt gegeten.
 */
export function EditLogSheet({
  log,
  onClose,
  onSaved,
  onDeleted,
  onMoved,
  onCopied,
}: {
  log: FoodLog;
  onClose: () => void;
  onSaved: (updated: FoodLog, message: string) => void;
  onDeleted: (log: FoodLog) => void;
  /** Item staat nu op een andere dag. */
  onMoved?: (updated: FoodLog, original: FoodLog) => void;
  /** Kopie op een andere dag toegevoegd. */
  onCopied?: (added: FoodLog[], target: string) => void;
}) {
  const quick = isQuick(log);
  const today = toISODate();
  const [grams, setGrams] = useState(fmt(log.grams, 1).replace(/\./g, ""));
  const [meal, setMeal] = useState<Meal>(log.meal);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [otherDay, setOtherDay] = useState(false);
  const dayOptions = Array.from({ length: 9 }, (_, i) => shiftDate(today, i - 1)).filter((d) => d !== log.date);
  const [target, setTarget] = useState(() => (log.date < today ? today : dayOptions.find((d) => d > log.date) ?? dayOptions[0]));

  const confirmable = log.planned && log.date <= today;
  const g = parseAmount(grams);
  const valid = quick || (Number.isFinite(g) && g > 0 && g <= 10000);
  const m = macrosFor(log.per100, valid && !quick ? g : quick ? 100 : 0);

  async function run(kind: Exclude<Busy, null>, patch?: Parameters<typeof updateLog>[1]) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    markNutritionMutation();
    try {
      if (kind === "delete") {
        await deleteLog(log.id);
        onDeleted(log);
      } else if (kind === "copy") {
        const added = await addLogs([
          { food: logToFood(log), grams: quick ? 100 : g, meal, date: target, portionLabel: quick || g === log.grams ? log.portion_label : null },
        ]);
        onCopied?.(added, target);
      } else {
        const updated = await updateLog(log, { ...patch, ...(kind === "eaten" ? { planned: false } : {}) });
        if (kind === "move") onMoved?.(updated, log);
        else onSaved(updated, kind === "eaten" ? `${log.name} bevestigd` : "Aangepast");
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  const saveQuick = (name: string, macros: Macros) => run(confirmable ? "eaten" : "save", { grams: 100, per100: macros, name, meal });
  const amountPatch = quick ? {} : { grams: g };
  const targetLabel = relativeDay(target).toLowerCase();

  return (
    <Sheet open onClose={onClose} title={quick ? "Snelle invoer" : log.name}>
      <div className="space-y-5">
        {log.planned && (
          <p className="rounded-xl border border-accent/40 bg-accent/5 px-3 py-2 text-xs text-muted">
            <span className="font-semibold text-ink">Gepland.</span>{" "}
            {confirmable ? "Pas de hoeveelheid aan als je meer of minder hebt gegeten, en bevestig daarna." : "Dit telt mee in je planning voor die dag."}
          </p>
        )}

        <div className="space-y-2">
          <span className="label" id="els-meal">
            Maaltijd
          </span>
          <div className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-surface-2 p-1" role="radiogroup" aria-labelledby="els-meal">
            {MEALS.map((x) => (
              <button
                key={x.id}
                role="radio"
                aria-checked={meal === x.id}
                onClick={() => setMeal(x.id)}
                className={`min-h-11 rounded-lg text-xs font-semibold transition ${meal === x.id ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>

        {quick ? (
          <QuickAddForm
            initial={{ name: log.name === "Snelle invoer" ? "" : log.name, kcal: log.kcal, protein: log.protein, carbs: log.carbs, fat: log.fat }}
            submitLabel={confirmable ? "Gegeten" : "Opslaan"}
            busy={busy !== null}
            onSubmit={saveQuick}
          />
        ) : (
          <>
            <div className="space-y-2">
              <label className="label" htmlFor="els-grams">
                Hoeveelheid
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="els-grams"
                  className="input text-lg font-bold tabular-nums"
                  inputMode="decimal"
                  value={grams}
                  onChange={(e) => setGrams(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  aria-invalid={!valid}
                />
                <span className="text-muted">g</span>
              </div>
              <div className="flex gap-1.5">
                {FACTORS.map((f) => {
                  const t = Math.round(log.grams * f * 10) / 10;
                  const active = valid && Math.abs(g - t) < 0.05;
                  return (
                    <button
                      key={f}
                      onClick={() => setGrams(fmt(t, 1).replace(/\./g, ""))}
                      aria-pressed={active}
                      className={`min-h-11 flex-1 rounded-full border text-xs font-medium transition active:scale-95 ${
                        active ? "border-accent bg-accent text-accent-ink" : "border-line text-muted hover:text-ink"
                      }`}
                    >
                      {f === 1 ? "Origineel" : `${fmt(f, 1)}×`}
                    </button>
                  );
                })}
              </div>
              {log.portion_label && <p className="text-xs text-muted">Origineel: {log.portion_label}</p>}
            </div>

            <div className="grid grid-cols-4 gap-2 rounded-2xl bg-surface-2 p-3 text-center">
              <Stat label="kcal" value={fmt(m.kcal)} />
              <Stat label="eiwit" value={`${fmt(m.protein, 1)} g`} color={MACRO_COLORS.protein} />
              <Stat label="koolh." value={`${fmt(m.carbs, 1)} g`} color={MACRO_COLORS.carbs} />
              <Stat label="vet" value={`${fmt(m.fat, 1)} g`} color={MACRO_COLORS.fat} />
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="animate-fade-in rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {!quick && confirmable && (
          <button className="btn-primary w-full py-3" disabled={!valid || busy !== null} onClick={() => run("eaten", { grams: g, meal })}>
            <CheckIcon size={16} /> {busy === "eaten" ? "Bezig…" : `Gegeten · ${fmt(m.kcal)} kcal`}
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button className={`btn-danger ${quick ? "col-span-2" : ""}`} disabled={busy !== null} onClick={() => run("delete")}>
            <CloseIcon size={14} /> {busy === "delete" ? "Verwijderen…" : "Verwijderen"}
          </button>
          {!quick && (
            <button className={confirmable ? "btn-ghost" : "btn-primary"} disabled={!valid || busy !== null} onClick={() => run("save", { grams: g, meal })}>
              {busy === "save" ? "Opslaan…" : confirmable ? "Gepland laten" : "Opslaan"}
            </button>
          )}
        </div>

        {(onMoved || onCopied) && (
          <div className="rounded-2xl border border-line">
            <button
              className="flex min-h-12 w-full items-center justify-between gap-2 px-3 text-left text-sm font-medium"
              onClick={() => setOtherDay((v) => !v)}
              aria-expanded={otherDay}
              aria-controls="els-other-day"
            >
              <span className="inline-flex items-center gap-2">
                <CalendarIcon size={16} className="text-accent" /> Andere dag
              </span>
              <span className="text-xs text-muted">{otherDay ? "Sluiten" : "Verplaatsen of kopiëren"}</span>
            </button>
            {otherDay && (
              <div id="els-other-day" className="animate-fade-in space-y-3 border-t border-line p-3">
                <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Doeldag">
                  {dayOptions.map((d) => {
                    const active = d === target;
                    return (
                      <button
                        key={d}
                        role="radio"
                        aria-checked={active}
                        onClick={() => setTarget(d)}
                        className={`flex min-h-12 flex-col items-center justify-center rounded-xl border text-[11px] transition active:scale-95 ${
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
                {target > today && <p className="text-xs text-muted">Op {targetLabel} wordt het een planning die je op die dag bevestigt.</p>}
                <div className="grid grid-cols-2 gap-2">
                  {onMoved && (
                    <button className="btn-ghost" disabled={!valid || busy !== null} onClick={() => run("move", { ...amountPatch, meal, date: target })}>
                      {busy === "move" ? "Bezig…" : "Verplaatsen"}
                    </button>
                  )}
                  {onCopied && (
                    <button className={`btn-ghost ${onMoved ? "" : "col-span-2"}`} disabled={!valid || busy !== null} onClick={() => run("copy")}>
                      {busy === "copy" ? "Bezig…" : "Kopiëren"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
