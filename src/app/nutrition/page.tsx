"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { ChevronRightIcon, CloseIcon, PlusIcon } from "@/components/Icons";
import { Sheet } from "@/components/Sheet";
import { AddFoodSheet } from "@/components/nutrition/AddFoodSheet";
import { MACRO_COLORS, MacroSummary } from "@/components/nutrition/MacroSummary";
import { formatDate, toISODate } from "@/lib/dates";
import { addLog, deleteLog, fetchLogs, logToFood, saveMeal, updateLogGrams, type FoodLog } from "@/lib/nutrition/log";
import { computeTargets, type NutritionProfile, type Targets } from "@/lib/nutrition/targets";
import { MEALS, sumMacros, type Meal } from "@/lib/nutrition/types";
import { errorMessage } from "@/lib/supabase";

const nl = (n: number, d = 0) => n.toLocaleString("nl-NL", { maximumFractionDigits: d });

function shift(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return toISODate(new Date(y, m - 1, d + days));
}

export default function NutritionPage() {
  const { profile } = useAuth();
  const targets = computeTargets(profile as NutritionProfile | null);
  const [date, setDate] = useState(toISODate());
  const [logs, setLogs] = useState<FoodLog[] | null>(null);
  const [week, setWeek] = useState<FoodLog[]>([]);
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState<Meal | null>(null);
  const [editing, setEditing] = useState<FoodLog | null>(null);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    fetchLogs(date, date).then(setLogs);
    fetchLogs(shift(toISODate(), -6), toISODate()).then(setWeek);
  }, [date, version]);

  const totals = sumMacros((logs ?? []).map((l) => l));
  const today = toISODate();
  const label = date === today ? "Vandaag" : date === shift(today, -1) ? "Gisteren" : formatDate(date, { weekday: "long", month: "short" });

  async function copyFromYesterday(meal: Meal) {
    const prev = (await fetchLogs(shift(date, -1), shift(date, -1))).filter((l) => l.meal === meal);
    if (!prev.length) return alert("Gisteren heb je bij deze maaltijd niets gelogd.");
    for (const l of prev) await addLog(logToFood(l), l.grams, meal, date, l.portion_label);
    reload();
  }

  async function saveAsMeal(meal: Meal, items: FoodLog[]) {
    const name = prompt("Naam van deze maaltijd", MEALS.find((m) => m.id === meal)?.label);
    if (!name) return;
    try {
      await saveMeal(name, items);
      alert(`"${name}" is opgeslagen. Je vindt hem bij Toevoegen → Mijn maaltijden.`);
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  return (
    <AppShell title="Voeding">
      <div className="space-y-5">
        {/* Dag kiezen */}
        <div className="flex items-center justify-between">
          <button onClick={() => setDate(shift(date, -1))} className="flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink" aria-label="Vorige dag">
            <ChevronRightIcon className="rotate-180" />
          </button>
          <button onClick={() => setDate(today)} className="text-center">
            <p className="font-bold capitalize">{label}</p>
            {date !== today && <p className="text-[11px] text-muted">Tik voor vandaag</p>}
          </button>
          <button
            onClick={() => setDate(shift(date, 1))}
            disabled={date >= today}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30"
            aria-label="Volgende dag"
          >
            <ChevronRightIcon />
          </button>
        </div>

        <section className="card animate-scale-in space-y-3">
          {logs === null ? <div className="skeleton h-32" /> : <MacroSummary totals={totals} targets={targets} />}
          {!targets && (
            <Link href="/profile#voeding" className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
              Vul gewicht, lengte, geboortedatum en geslacht in voor je dagdoel <ChevronRightIcon size={14} />
            </Link>
          )}
        </section>

        {MEALS.map((m, mi) => {
          const items = (logs ?? []).filter((l) => l.meal === m.id);
          const t = sumMacros(items);
          return (
            <section key={m.id} className="card animate-fade-up space-y-2 p-0" style={{ "--i": mi } as React.CSSProperties}>
              <div className="flex items-center justify-between px-4 pt-3">
                <div>
                  <h2 className="font-bold">{m.label}</h2>
                  <p className="text-xs text-muted tabular-nums">
                    {items.length ? `${nl(t.kcal)} kcal · E ${nl(t.protein)} · K ${nl(t.carbs)} · V ${nl(t.fat)}` : "Nog niets"}
                  </p>
                </div>
                <button className="btn-primary h-9 px-3 text-xs" onClick={() => setAdding(m.id)}>
                  <PlusIcon size={14} /> Toevoegen
                </button>
              </div>
              {items.length > 0 && (
                <ul className="divide-y divide-line border-t border-line">
                  {items.map((l) => (
                    <li key={l.id}>
                      <button onClick={() => setEditing(l)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm">{l.name}</p>
                          <p className="truncate text-xs text-muted">
                            {[l.brand, l.portion_label ?? `${nl(l.grams, 1)} g`].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm tabular-nums">{nl(l.kcal)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-4 px-4 pb-3 text-xs">
                <button className="text-muted hover:text-ink" onClick={() => copyFromYesterday(m.id)}>
                  Kopieer van gisteren
                </button>
                {items.length > 1 && (
                  <button className="text-muted hover:text-ink" onClick={() => saveAsMeal(m.id, items)}>
                    Bewaar als maaltijd
                  </button>
                )}
              </div>
            </section>
          );
        })}

        <WeekOverview logs={week} targets={targets} today={today} />

        <p className="text-center text-xs text-muted">
          Doelen aanpassen (activiteit, afvallen of aankomen):{" "}
          <Link href="/profile#voeding" className="text-accent">
            Profiel
          </Link>
        </p>
      </div>

      <AddFoodSheet open={adding !== null} onClose={() => setAdding(null)} meal={adding ?? "breakfast"} date={date} onAdded={reload} />
      {editing && <EditLogSheet log={editing} onClose={() => setEditing(null)} onChanged={reload} />}
    </AppShell>
  );
}

function EditLogSheet({ log, onClose, onChanged }: { log: FoodLog; onClose: () => void; onChanged: () => void }) {
  const [grams, setGrams] = useState(String(log.grams));
  const g = Number(grams.replace(",", "."));
  const valid = g > 0 && g <= 10000;
  const kcal = valid ? (log.per100.kcal * g) / 100 : 0;

  return (
    <Sheet open onClose={onClose} title={log.name}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <input className="input text-lg font-bold tabular-nums" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} aria-label="Grammen" autoFocus />
          <span className="text-muted">g</span>
          <span className="w-24 shrink-0 text-right text-sm tabular-nums">{nl(kcal)} kcal</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            className="btn-danger"
            onClick={async () => {
              await deleteLog(log.id);
              onChanged();
              onClose();
            }}
          >
            <CloseIcon size={14} /> Verwijderen
          </button>
          <button
            className="btn-primary"
            disabled={!valid}
            onClick={async () => {
              await updateLogGrams(log, g);
              onChanged();
              onClose();
            }}
          >
            Opslaan
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** Calorieën per dag (laatste 7 dagen) tegen het doel, plus gemiddeld eiwit. */
function WeekOverview({ logs, targets, today }: { logs: FoodLog[]; targets: Targets | null; today: string }) {
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => shift(today, i - 6)).map((d) => {
      const items = logs.filter((l) => l.date === d);
      return { date: d, logged: items.length > 0, ...sumMacros(items) };
    });
  }, [logs, today]);
  const logged = days.filter((d) => d.logged);
  const max = Math.max(targets?.kcal ?? 0, ...days.map((d) => d.kcal), 1) * 1.1;
  const avg = (k: "kcal" | "protein") => (logged.length ? logged.reduce((a, d) => a + d[k], 0) / logged.length : 0);

  return (
    <section className="card space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-bold">Afgelopen 7 dagen</h2>
        <span className="text-xs text-muted">{logged.length} dagen gelogd</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="rounded-xl bg-surface-2 py-2">
          <p className="text-lg font-extrabold tabular-nums">{logged.length ? nl(avg("kcal")) : "–"}</p>
          <p className="text-xs text-muted">gem. kcal{targets ? ` (doel ${nl(targets.kcal)})` : ""}</p>
        </div>
        <div className="rounded-xl bg-surface-2 py-2">
          <p className="text-lg font-extrabold tabular-nums" style={{ color: MACRO_COLORS.protein }}>
            {logged.length ? `${nl(avg("protein"))} g` : "–"}
          </p>
          <p className="text-xs text-muted">gem. eiwit{targets ? ` (doel ${nl(targets.protein)} g)` : ""}</p>
        </div>
      </div>
      <div className="relative h-36">
        {targets && (
          <div className="absolute inset-x-0 border-t border-dashed border-muted/60" style={{ bottom: `${(targets.kcal / max) * 100}%` }}>
            <span className="absolute -top-4 right-0 text-[10px] text-muted">doel</span>
          </div>
        )}
        <div className="flex h-full items-end gap-2">
          {days.map((d) => {
            const over = targets && d.kcal > targets.kcal * 1.05;
            return (
              <div key={d.date} className="group relative flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="pointer-events-none absolute -top-1 hidden rounded bg-surface-2 px-1.5 py-0.5 text-[10px] tabular-nums group-hover:block">
                  {nl(d.kcal)}
                </span>
                <div
                  className={`w-full max-w-8 rounded-t-[4px] transition-[height] duration-700 ${d.logged ? (over ? "bg-warn" : "bg-accent") : "bg-surface-2"}`}
                  style={{ height: d.logged ? `${(d.kcal / max) * 100}%` : "4px" }}
                  title={`${d.date}: ${nl(d.kcal)} kcal`}
                />
                <span className={`text-[10px] ${d.date === today ? "font-bold text-ink" : "text-muted"}`}>
                  {formatDate(d.date, { weekday: "short", day: undefined, month: undefined }).slice(0, 2)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
