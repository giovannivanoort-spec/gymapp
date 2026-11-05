"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { CalendarIcon, CheckIcon, ChevronRightIcon, CloseIcon, PlusIcon } from "@/components/Icons";
import { AddFoodSheet } from "@/components/nutrition/AddFoodSheet";
import { CopyDaySheet, sameEntry } from "@/components/nutrition/CopyDaySheet";
import { EditLogSheet } from "@/components/nutrition/EditLogSheet";
import { MacroSummary } from "@/components/nutrition/MacroSummary";
import { SaveMealSheet } from "@/components/nutrition/SaveMealSheet";
import { SwipeRow } from "@/components/nutrition/SwipeRow";
import { shiftDate as shift, WeekOverview } from "@/components/nutrition/WeekOverview";
import { DataStatus } from "@/components/platform/DataStatus";
import { toast, type ToastAction } from "@/components/ui/Toast";
import { getCached, setCached, useCachedState } from "@/lib/cache";
import { formatDate, relativeDay, toISODate } from "@/lib/dates";
import { fmt } from "@/lib/nutrition/format";
import {
  addLogs,
  confirmLogs,
  counts,
  deleteLogs,
  fetchLogs,
  fiberOf,
  freshFetch,
  invalidateNutrition,
  isQuick,
  logToFood,
  markNutritionMutation,
  nutritionKeys,
  restoreLogs,
  updateLog,
  type FoodLog,
} from "@/lib/nutrition/log";
import { flushNutritionQueue, useNutritionQueue } from "@/lib/nutrition/offline";
import { computeTargets, type NutritionProfile } from "@/lib/nutrition/targets";
import { MEALS, sumMacros, type Meal } from "@/lib/nutrition/types";
import { errorMessage } from "@/lib/supabase";

/** Dagen rond vandaag bewaren we ook in localStorage (direct zichtbaar bij opnieuw openen). */
const PERSIST_DAYS = 7;
/** Verder vooruit dan dit kun je niet plannen. */
const MAX_AHEAD = 7;
/** Horizontaal vegen over het dagboek: zo ver om van dag te wisselen. */
const DAY_SWIPE_PX = 70;

/* ───────── "Vandaag" dat meeloopt met de klok ─────────
   Een PWA die 's nachts open blijft staan, moet de volgende ochtend op de nieuwe dag openen. We
   luisteren naar terugkeren naar de app en zetten een timer op middernacht. */
function subscribeToday(onChange: () => void) {
  let timer = 0;
  const arm = () => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    timer = window.setTimeout(() => {
      onChange();
      arm();
    }, midnight.getTime() - now.getTime());
  };
  arm();
  const onVisible = () => document.visibilityState === "visible" && onChange();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onChange);
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onChange);
  };
}
const todaySnapshot = () => toISODate();

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Wat zonder verbinding is ingevoerd versturen; daarna het dagboek opnieuw ophalen. */
function syncQueue() {
  flushNutritionQueue()
    .then(({ sent, failed }) => {
      if (sent || failed) invalidateNutrition();
      if (failed) toast.error(`${failed} offline ${failed === 1 ? "wijziging kon" : "wijzigingen konden"} niet worden opgeslagen.`);
      else if (sent) toast.success("Offline ingevoerd eten is opgeslagen");
    })
    .catch(() => {});
}

export default function NutritionPage() {
  const { profile, session } = useAuth();
  const uid = session?.user.id ?? "anon";
  const targets = computeTargets(profile as NutritionProfile | null);
  const today = useSyncExternalStore(subscribeToday, todaySnapshot, todaySnapshot);
  // null = "vandaag volgen": na middernacht schuift de pagina vanzelf mee naar de nieuwe dag.
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? today;
  const setDate = (d: string) => setPicked(d === today ? null : d);
  const [adding, setAdding] = useState<Meal | null>(null);
  const [editing, setEditing] = useState<FoodLog | null>(null);
  const [savingMeal, setSavingMeal] = useState<{ meal: Meal; items: FoodLog[] } | null>(null);
  const [copyDay, setCopyDay] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** Items waarvoor nu een bevestiging of verwijdering loopt (dubbel tikken telt niet dubbel). */
  const working = useRef(new Set<string>());
  const swipe = useRef<{ x: number; y: number; dx: number; active: boolean } | null>(null);
  /** De dag die nu in beeld is (schuift mee met de vinger). */
  const dayEl = useRef<HTMLDivElement | null>(null);
  /** Na een veeg: de nieuwe dag schuift in vanaf deze kant (1 = rechts, -1 = links). */
  const slideFrom = useRef(0);
  const queued = useNutritionQueue();

  // Offline ingevoerd eten versturen zodra er weer verbinding is (en bij terugkeren naar de app).
  useEffect(() => {
    syncQueue();
    const onVisible = () => document.visibilityState === "visible" && syncQueue();
    window.addEventListener("online", syncQueue);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", syncQueue);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const future = date > today;
  const persistFor = (d: string) => d >= shift(today, -PERSIST_DAYS) && d <= shift(today, PERSIST_DAYS);
  const persistDay = persistFor(date);

  // Dagboek per dag in de cache: wisselen van dag toont nooit de data van een andere dag.
  // freshFetch: een fetch die tijdens een wijziging liep, overschrijft de optimistische stand niet.
  const dayKey = nutritionKeys.day(uid, date);
  const day = useCachedState(dayKey, () => freshFetch(() => fetchLogs(date, date)), { persist: persistDay, maxAge: 15_000 });
  const logs = day.data;
  const dayError = day.error != null && logs === undefined;

  // Week: de laatste 7 dagen, of de week tot de gekozen dag als je verder terugbladert.
  const weekEnd = date >= shift(today, -6) ? today : date;
  const weekKey = nutritionKeys.range(uid, shift(weekEnd, -6), weekEnd);
  const week = useCachedState(weekKey, () => freshFetch(() => fetchLogs(shift(weekEnd, -6), weekEnd)), {
    persist: weekEnd === today,
    maxAge: 30_000,
  });

  const counted = (logs ?? []).filter((l) => counts(l, today));
  const totals = sumMacros(counted);
  const fibers = counted.map(fiberOf).filter((f): f is number => f != null);
  const fiber = fibers.length ? fibers.reduce((a, b) => a + b, 0) : null;
  const pending = !future ? (logs ?? []).filter((l) => l.planned) : [];
  const pendingKcal = pending.reduce((a, l) => a + l.kcal, 0);
  const label =
    date === today
      ? "Vandaag"
      : date === shift(today, -1)
        ? "Gisteren"
        : date === shift(today, 1)
          ? "Morgen"
          : formatDate(date, { weekday: "long", month: "short" });
  const canForward = date < shift(today, MAX_AHEAD);

  /** Dagboek van een dag (standaard de getoonde) direct bijwerken; de server-data volgt via invalidate. */
  function patchDay(fn: (l: FoodLog[]) => FoodLog[], d = date) {
    markNutritionMutation();
    const key = nutritionKeys.day(uid, d);
    const current = getCached<FoodLog[]>(key);
    if (current) setCached(key, fn(current), persistFor(d));
    return current;
  }

  /** Eén item terugzetten in het dagboek van zijn dag (zonder andere wijzigingen te wissen). */
  function rollback(log: FoodLog) {
    patchDay((l) => (l.some((x) => x.id === log.id) ? l.map((x) => (x.id === log.id ? log : x)) : [...l, log].sort(byCreated)), log.date);
  }

  function fail(err: unknown) {
    toast.error(errorMessage(err));
  }

  function undoAction(run: () => Promise<void>, optimistic?: () => void): ToastAction {
    return {
      label: "Ongedaan maken",
      run: () => {
        optimistic?.();
        markNutritionMutation();
        run()
          .then(() => toast("Ongedaan gemaakt"))
          .catch((err) => toast.error(errorMessage(err)))
          .finally(invalidateNutrition);
      },
    };
  }

  /** Melding na een wijziging; zonder verbinding met de uitleg dat het later wordt verstuurd. */
  function notify(message: string, action?: ToastAction, offline = false) {
    toast(offline ? `${message}. Wordt verstuurd zodra je weer online bent.` : message, { action });
  }

  function onAdded(added: FoodLog[] = [], message = "Toegevoegd") {
    const ids = added.map((l) => l.id);
    // Een verversing op de achtergrond kan de nieuwe regels al hebben opgehaald: nooit dubbel tonen.
    if (added.length && added.every((l) => l.date === date)) patchDay((l) => [...l.filter((x) => !ids.includes(x.id)), ...added]);
    invalidateNutrition();
    notify(
      message,
      added.length
        ? undoAction(
            () => deleteLogs(ids),
            () => patchDay((l) => l.filter((x) => !ids.includes(x.id)), added[0].date),
          )
        : undefined,
      added.some((l) => l.pending),
    );
  }

  function onDeleted(log: FoodLog) {
    patchDay((l) => l.filter((x) => x.id !== log.id));
    invalidateNutrition();
    notify(
      `${isQuick(log) ? "Snelle invoer" : log.name} verwijderd`,
      undoAction(
        () => restoreLogs([log]),
        () => rollback(log),
      ),
    );
  }

  /** Verwijderen vanuit de lijst (vegen of "niet gegeten"): direct weg, met "Ongedaan maken". */
  async function remove(log: FoodLog, message?: string) {
    if (working.current.has(log.id)) return;
    working.current.add(log.id);
    patchDay((l) => l.filter((x) => x.id !== log.id), log.date);
    try {
      await deleteLogs([log.id]);
      notify(
        message ?? `${isQuick(log) ? "Snelle invoer" : log.name} verwijderd`,
        undoAction(
          () => restoreLogs([log]),
          () => rollback(log),
        ),
      );
    } catch (err) {
      rollback(log);
      fail(err);
    } finally {
      working.current.delete(log.id);
      invalidateNutrition();
    }
  }

  function onSaved(updated: FoodLog, message: string) {
    patchDay((l) => l.map((x) => (x.id === updated.id ? updated : x)));
    invalidateNutrition();
    toast(message);
  }

  function onMoved(updated: FoodLog, original: FoodLog) {
    patchDay((l) => (updated.date === date ? l.map((x) => (x.id === updated.id ? updated : x)) : l.filter((x) => x.id !== updated.id)));
    invalidateNutrition();
    notify(
      `${isQuick(original) ? "Snelle invoer" : original.name} ${updated.planned && updated.date > today ? "gepland voor" : "verplaatst naar"} ${relativeDay(updated.date).toLowerCase()}`,
      undoAction(
        async () => {
          // Precies terugzetten, ook het portielabel ("2 × 1 stuk") dat bij het verplaatsen verviel.
          await updateLog(updated, {
            date: original.date,
            meal: original.meal,
            planned: original.planned,
            ...(isQuick(original) ? {} : { grams: original.grams }),
            portion_label: original.portion_label,
          });
        },
        () => {
          if (updated.date !== original.date) patchDay((l) => l.filter((x) => x.id !== updated.id), updated.date);
          rollback(original);
        },
      ),
    );
  }

  /** Item openen om aan te passen; een item dat nog op verbinding wacht, kan dat nog niet. */
  function openLog(log: FoodLog) {
    if (log.pending) {
      toast("Dit item wacht nog op verbinding. Aanpassen kan zodra het is verstuurd; verwijderen kan wel (veeg naar links).");
      return;
    }
    setEditing(log);
  }

  async function confirm(log: FoodLog) {
    if (working.current.has(log.id)) return;
    working.current.add(log.id);
    patchDay((l) => l.map((x) => (x.id === log.id ? { ...x, planned: false } : x)), log.date);
    navigator.vibrate?.(10);
    try {
      await confirmLogs([log.id]);
    } catch (err) {
      rollback(log);
      fail(err);
    } finally {
      working.current.delete(log.id);
      invalidateNutrition();
    }
  }

  async function confirmAll() {
    if (busy || !pending.length) return;
    setBusy("confirm-all");
    const items = pending;
    const ids = items.map((l) => l.id);
    patchDay((l) => l.map((x) => (ids.includes(x.id) ? { ...x, planned: false } : x)));
    try {
      await confirmLogs(ids);
      notify(`${ids.length} ${ids.length === 1 ? "item" : "items"} bevestigd`, undefined, typeof navigator !== "undefined" && !navigator.onLine);
    } catch (err) {
      items.forEach(rollback);
      fail(err);
    } finally {
      setBusy(null);
      invalidateNutrition();
    }
  }

  async function copyPreviousDay(meal: Meal) {
    if (busy) return;
    setBusy(`copy:${meal}`);
    const prev = shift(date, -1);
    const mealLabel = MEALS.find((m) => m.id === meal)!.label.toLowerCase();
    try {
      // Alleen wat echt is gegeten (of gepland, als de vorige dag zelf nog in de toekomst ligt).
      const source = (await fetchLogs(prev, prev)).filter((l) => l.meal === meal && counts(l, today));
      if (!source.length) {
        toast(`Niets gevonden bij ${mealLabel} op ${relativeDay(prev).toLowerCase()}.`);
        return;
      }
      // Wat er al precies zo staat, niet nog een keer toevoegen.
      const current = (logs ?? []).filter((l) => l.meal === meal);
      const items = source.filter((l) => !current.some((c) => sameEntry(c, l)));
      if (!items.length) {
        toast(`${MEALS.find((m) => m.id === meal)!.label} staat er al hetzelfde als ${relativeDay(prev).toLowerCase()}.`);
        return;
      }
      const added = await addLogs(items.map((l) => ({ food: logToFood(l), grams: l.grams, meal, date, portionLabel: l.portion_label })));
      const skipped = source.length - items.length;
      onAdded(added, `${added.length} ${added.length === 1 ? "item" : "items"} gekopieerd naar ${mealLabel}${skipped ? ` (${skipped} stond${skipped === 1 ? "" : "en"} er al)` : ""}`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  // Vegen over het dagboek wisselt van dag (niet als de veeg op een regel begint: die veeg verwijdert).
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    const target = e.target as Element;
    swipe.current =
      e.touches.length === 1 && !target.closest("[data-noswipe], input, textarea") ? { x: t.clientX, y: t.clientY, dx: 0, active: false } : null;
  }
  /** De dag volgt de vinger (met weerstand), zodat je ziet dat vegen van dag wisselt. */
  function onTouchMove(e: React.TouchEvent) {
    const s = swipe.current;
    const t = e.touches[0];
    if (!s || !t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (!s.active) {
      // Eerst duidelijk horizontaal, anders is het gewoon scrollen.
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
        swipe.current = null;
        return;
      }
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      s.active = true;
    }
    s.dx = dx;
    const el = dayEl.current;
    if (!el || reducedMotion()) return;
    // Verder dan de laatste plandag kan niet: dan veel meer weerstand.
    const blocked = dx < 0 && !canForward;
    const pull = Math.sign(dx) * Math.min(blocked ? 24 : 110, Math.abs(dx) * (blocked ? 0.15 : 0.45));
    el.style.transition = "none";
    el.style.transform = `translateX(${pull}px)`;
    el.style.opacity = String(1 - Math.min(0.35, Math.abs(pull) / 320));
  }
  function resetSwipe() {
    const el = dayEl.current;
    if (!el || !el.style.transform) return;
    el.style.transition = "transform 200ms ease-out, opacity 200ms ease-out";
    el.style.transform = "";
    el.style.opacity = "";
  }
  function onTouchEnd(e: React.TouchEvent) {
    const s = swipe.current;
    swipe.current = null;
    const t = e.changedTouches[0];
    if (!s || !t || !s.active) {
      resetSwipe();
      return;
    }
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < DAY_SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.6 || (dx < 0 && !canForward)) {
      resetSwipe();
      return;
    }
    slideFrom.current = dx < 0 ? 1 : -1;
    navigator.vibrate?.(8);
    setDate(shift(date, dx < 0 ? 1 : -1));
  }

  /** De nieuwe dag schuift in vanaf de kant waarheen je veegde. */
  function attachDay(el: HTMLDivElement | null) {
    dayEl.current = el;
    const from = slideFrom.current;
    if (!el || !from) return;
    slideFrom.current = 0;
    if (reducedMotion() || typeof el.animate !== "function") return;
    el.animate(
      [
        { transform: `translateX(${from * 56}px)`, opacity: 0 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  }

  return (
    <AppShell title="Voeding">
      <div className="space-y-5" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        {/* Dag kiezen */}
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setDate(shift(date, -1))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink active:scale-90"
            aria-label="Vorige dag"
          >
            <ChevronRightIcon className="rotate-180" />
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
            <label className="relative flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-xl px-3 transition hover:bg-surface-2">
              <CalendarIcon size={16} className="shrink-0 text-muted" />
              <span className="truncate font-bold capitalize" aria-live="polite">
                {label}
              </span>
              <input
                type="date"
                value={date}
                max={shift(today, MAX_AHEAD)}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                onClick={(e) => {
                  // Desktopbrowsers openen de kalender anders alleen via het kleine icoontje.
                  try {
                    e.currentTarget.showPicker?.();
                  } catch {
                    // niet ondersteund: de browser opent zelf het invoerveld
                  }
                }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label="Kies een dag"
              />
            </label>
            {date !== today && (
              <button
                onClick={() => setDate(today)}
                className="animate-fade-in inline-flex min-h-11 shrink-0 items-center rounded-full px-2 text-[11px] font-semibold text-accent transition active:scale-95"
              >
                <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1">Vandaag</span>
              </button>
            )}
          </div>
          <button
            onClick={() => setDate(shift(date, 1))}
            disabled={!canForward}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink active:scale-90 disabled:opacity-30"
            aria-label="Volgende dag"
          >
            <ChevronRightIcon />
          </button>
        </div>

        {future && (
          <div className="card animate-fade-up flex items-start gap-3 border-dashed p-3 text-sm">
            <CalendarIcon size={18} className="mt-0.5 shrink-0 text-accent" />
            <p className="text-muted">
              <span className="font-semibold text-ink">Vooruit plannen.</span> Wat je hier toevoegt staat als gepland. Op die dag bevestig je
              per item of je het echt hebt gegeten, en kun je de hoeveelheid nog aanpassen.
            </p>
          </div>
        )}

        {pending.length > 0 && (
          <div className="card animate-fade-up flex items-center gap-3 border-accent/40 bg-accent/5 p-3">
            <CalendarIcon size={18} className="shrink-0 text-accent" />
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-semibold">{pending.length} gepland</span>
              <span className="text-muted"> · {fmt(pendingKcal)} kcal · bevestig wat je hebt gegeten</span>
            </p>
            <button className="btn-primary min-h-11 shrink-0 px-3 text-xs" onClick={confirmAll} disabled={busy !== null}>
              {busy === "confirm-all" ? "Bezig…" : "Alles gegeten"}
            </button>
          </div>
        )}

        {queued > 0 && (
          <div role="status" className="animate-fade-in flex items-center gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-warn" aria-hidden />
            <span className="min-w-0 flex-1 text-muted">
              <span className="font-semibold text-ink">
                {queued} {queued === 1 ? "wijziging wacht" : "wijzigingen wachten"} op verbinding.
              </span>{" "}
              Wordt vanzelf verstuurd.
            </span>
            <button type="button" onClick={syncQueue} className="-my-1 min-h-11 shrink-0 rounded-lg px-2 font-semibold text-accent active:opacity-70">
              Nu versturen
            </button>
          </div>
        )}

        {dayError ? (
          <DataStatus state={day} title="Je dagboek kon niet worden geladen" />
        ) : (
          <div key={date} ref={attachDay} className="animate-fade-in space-y-5">
            <DataStatus state={day} />
            <section className="card space-y-3" aria-label={future ? "Planning voor deze dag" : "Totaal van deze dag"}>
              {future && <p className="text-xs font-semibold uppercase tracking-wide text-muted">Gepland voor deze dag</p>}
              {logs === undefined ? (
                <div className="flex items-center gap-5" aria-busy>
                  <div className="skeleton h-32 w-32 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-3">
                    <div className="skeleton h-3 w-2/3" />
                    <div className="skeleton h-6" />
                    <div className="skeleton h-6" />
                    <div className="skeleton h-6" />
                  </div>
                </div>
              ) : (
                <MacroSummary totals={totals} targets={targets} fiber={fiber} mode={future ? "planned" : "eaten"} plannedKcal={pendingKcal} />
              )}
              {!targets && profile && (
                <Link href="/profile#voeding" className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
                  Vul gewicht, lengte, geboortedatum en geslacht in voor je dagdoel <ChevronRightIcon size={14} className="shrink-0" />
                </Link>
              )}
            </section>

            {MEALS.map((m, mi) => {
              const items = (logs ?? []).filter((l) => l.meal === m.id);
              const t = sumMacros(items.filter((l) => counts(l, today)));
              return (
                <section key={m.id} className="card animate-fade-up space-y-1 p-0" style={{ "--i": mi } as React.CSSProperties} aria-labelledby={`meal-${m.id}`}>
                  <div className="flex items-center justify-between gap-3 px-4 pt-3">
                    <div className="min-w-0">
                      <h2 id={`meal-${m.id}`} className="font-bold">
                        {m.label}
                      </h2>
                      {logs === undefined ? (
                        <div className="skeleton mt-1 h-3 w-32" />
                      ) : (
                        <p className="truncate text-xs text-muted tabular-nums">
                          {items.length ? `${fmt(t.kcal)} kcal · E ${fmt(t.protein)} · K ${fmt(t.carbs)} · V ${fmt(t.fat)}` : future ? "Nog niets gepland" : "Nog niets"}
                        </p>
                      )}
                    </div>
                    <button className="btn-primary min-h-11 shrink-0 px-3 text-xs" onClick={() => setAdding(m.id)} aria-label={`${future ? "Plannen bij" : "Toevoegen aan"} ${m.label.toLowerCase()}`}>
                      <PlusIcon size={14} /> {future ? "Plannen" : "Toevoegen"}
                    </button>
                  </div>
                  {items.length > 0 && (
                    <ul className="mt-2 divide-y divide-line border-t border-line">
                      {items.map((l) => (
                        <li key={l.id} className="animate-fade-in">
                          {l.planned && !future ? (
                            <SwipeRow onDelete={() => remove(l, `${l.name} verwijderd uit je planning`)} label="Niet gegeten">
                              <div className="flex items-center gap-2 bg-surface-2/40 py-1 pl-0 pr-3">
                                <button onClick={() => openLog(l)} className="min-h-11 min-w-0 flex-1 py-1.5 pl-4 text-left opacity-75 transition hover:opacity-100">
                                  <p className="truncate text-sm">{rowName(l)}</p>
                                  <p className="truncate text-xs text-muted">
                                    {l.pending && <span className="font-semibold text-warn">Wacht op verbinding · </span>}
                                    Gepland · {l.portion_label ?? `${fmt(l.grams, 1)} g`} · {fmt(l.kcal)} kcal
                                  </p>
                                </button>
                                <button
                                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line text-muted transition hover:border-danger hover:text-danger active:scale-90"
                                  onClick={() => remove(l, `${l.name} verwijderd uit je planning`)}
                                  aria-label={`${l.name} niet gegeten`}
                                >
                                  <CloseIcon size={16} />
                                </button>
                                <button
                                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition hover:brightness-110 active:scale-90"
                                  onClick={() => confirm(l)}
                                  aria-label={`${l.name} gegeten`}
                                >
                                  <CheckIcon size={16} />
                                </button>
                              </div>
                            </SwipeRow>
                          ) : (
                            <SwipeRow onDelete={() => remove(l)}>
                              <button
                                onClick={() => openLog(l)}
                                className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-surface-2 active:bg-surface-2"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm">{rowName(l)}</p>
                                  <p className="truncate text-xs text-muted">
                                    {l.pending && <span className="font-semibold text-warn">Wacht op verbinding · </span>}
                                    {[l.brand, l.portion_label ?? `${fmt(l.grams, 1)} g`, `E ${fmt(l.protein)} g`].filter(Boolean).join(" · ")}
                                  </p>
                                </div>
                                <span className="flex shrink-0 items-center gap-2 text-sm tabular-nums">
                                  {l.source === "ai" && <span className="chip px-1.5 py-0 text-[10px]">AI</span>}
                                  {/* Op een dag in de toekomst is alles gepland: dat staat al boven de dag. */}
                                  {l.planned && !future && <span className="chip px-2 py-0.5 text-[10px]">Gepland</span>}
                                  {fmt(l.kcal)}
                                </span>
                              </button>
                            </SwipeRow>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-1 px-2 pb-1.5">
                    <button
                      className="inline-flex min-h-11 items-center rounded-xl px-2 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                      onClick={() => copyPreviousDay(m.id)}
                      disabled={busy !== null || logs === undefined}
                    >
                      {busy === `copy:${m.id}` ? "Kopiëren…" : date === today ? "Zelfde als gisteren" : "Kopieer vorige dag"}
                    </button>
                    {items.length > 1 && (
                      <button
                        className="inline-flex min-h-11 items-center rounded-xl px-2 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-ink"
                        onClick={() => setSavingMeal({ meal: m.id, items })}
                      >
                        Bewaar als maaltijd
                      </button>
                    )}
                  </div>
                </section>
              );
            })}

            {logs !== undefined && logs.length > 0 && (
              <p className="-mt-2 text-center text-[11px] text-muted">Tik op een item om het aan te passen of te verplaatsen. Veeg naar links om te verwijderen.</p>
            )}

            {counted.length > 0 && (
              <button className="btn-ghost w-full" onClick={() => setCopyDay(true)}>
                <CalendarIcon size={16} /> Dag kopiëren naar…
              </button>
            )}
          </div>
        )}

        <WeekOverview
          logs={week.data}
          targets={targets}
          end={weekEnd}
          selected={date}
          onSelect={setDate}
          error={week.error != null}
          onRetry={week.retry}
          state={week}
        />

        <p className="text-center text-xs text-muted">
          Doelen aanpassen (activiteit, afvallen of aankomen):{" "}
          <Link href="/profile#voeding" className="inline-flex min-h-11 items-center px-1 font-semibold text-accent">
            Profiel
          </Link>
        </p>
      </div>

      <AddFoodSheet open={adding !== null} onClose={() => setAdding(null)} meal={adding ?? "breakfast"} date={date} onAdded={onAdded} dayLogs={logs} />
      {editing && (
        <EditLogSheet
          key={editing.id}
          log={editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
          onDeleted={onDeleted}
          onMoved={onMoved}
          onCopied={(added, target) =>
            onAdded(added, `${editing.name} ${target > today ? "gepland voor" : "gekopieerd naar"} ${relativeDay(target).toLowerCase()}`)
          }
        />
      )}
      {savingMeal && (
        <SaveMealSheet
          items={savingMeal.items}
          defaultName={`Mijn ${MEALS.find((m) => m.id === savingMeal.meal)!.label.toLowerCase()}`}
          onClose={() => setSavingMeal(null)}
          onSaved={(name) => {
            invalidateNutrition();
            toast.success(`"${name}" bewaard bij Mijn maaltijden`);
          }}
        />
      )}
      {copyDay && (
        <CopyDaySheet
          from={date}
          logs={counted}
          onClose={() => setCopyDay(false)}
          onCopied={(added, target) =>
            onAdded(added, `${added.length} ${added.length === 1 ? "item" : "items"} ${target > today ? "gepland voor" : "gekopieerd naar"} ${relativeDay(target).toLowerCase()}`)
          }
        />
      )}
    </AppShell>
  );
}

const byCreated = (a: FoodLog, b: FoodLog) => a.created_at.localeCompare(b.created_at);

/** Naam in het dagboek; snelle invoer zonder omschrijving krijgt een duidelijke naam. */
function rowName(l: FoodLog) {
  return isQuick(l) && l.name === "Snelle invoer" ? "Snelle invoer (alleen kcal)" : l.name;
}
