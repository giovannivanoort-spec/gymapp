"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { analyzePlan } from "@/lib/analysis";
import { formatDate } from "@/lib/dates";
import { defaultTargetReps, EXERCISE_BY_SLUG } from "@/lib/exercises";
import type { Exercise } from "@/lib/exercise-types";
import { formatSet } from "@/lib/history";
import { errorMessage, supabase } from "@/lib/supabase";
import { estimateMinutes, insertTemplate, plural, totalSets } from "@/lib/templates";
import type { PlannedExercise, Template } from "@/lib/types";
import { useUserId } from "./AuthProvider";
import { ExerciseFilter } from "./ExerciseFilter";
import { CheckIcon, PlusIcon, SparkleIcon } from "./Icons";
import { MuscleAnalysis } from "./MuscleAnalysis";
import { MuscleChips } from "./MuscleChips";
import { Sheet } from "./Sheet";
import { ConfirmSheet } from "./planning/ConfirmSheet";
import { ActionIcons, ExerciseActionsSheet, type ExerciseAction } from "./planning/ExerciseActionsSheet";
import { ExerciseInfoSheet, InfoButton } from "./planning/ExerciseInfo";
import { SaveTemplateSheet } from "./planning/SaveTemplateSheet";
import { Stepper } from "./planning/Stepper";
import { SwapSheet } from "./planning/SwapSheet";
import { TemplatePicker } from "./planning/TemplatePicker";
import { notify } from "./planning/notify";
import { lastHint, useLastSessions } from "./planning/useLastSessions";
import { useRecentExercises } from "./planning/useRecent";
import { useTemplateList } from "./planning/useTemplateList";

export type BuilderItem = PlannedExercise & {
  /** Lokale sleutel voor React. */
  key: string;
  /** Database-id van een bestaande workout_exercise (bij bewerken). */
  id?: string;
};

export type BuilderValue = {
  title: string;
  date: string;
  notes: string;
  items: BuilderItem[];
};

let keyCounter = 0;
export function toBuilderItem(p: PlannedExercise, id?: string): BuilderItem {
  return { ...p, key: `k${++keyCounter}`, id };
}

const REPS_PRESETS = ["5", "6-8", "8-10", "8-12", "10-12", "12-15", "15-20", "AMRAP"];
/** Snelkeuzes in seconden voor statische oefeningen (plank, wall sit). */
const SECONDS_PRESETS = ["20", "30", "45", "60", "90", "30-60"];
const DRAFT_PREFIX = "gymapp-draft:v1:";
const DRAFT_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
/** Ruimte tussen de kaarten (space-y-3), nodig om te bepalen wanneer een gesleepte kaart verspringt. */
const CARD_GAP = 12;

type LogCount = { sets: number; people: number };
type DraftItem = PlannedExercise & { id?: string };
type Draft = { savedAt: number; snap: string; title: string; date: string; notes: string; items: DraftItem[] };
type Confirm = { title: string; body: React.ReactNode; confirmLabel: string; run: () => void };
type Drag = { key: string; pointerId: number; startY: number; lastY: number; el: HTMLElement; lock: boolean; raf: number };

/** Vergelijkbare vorm van de inhoud, om te zien of er iets veranderd is. */
function snapshot(title: string, date: string, notes: string, items: BuilderItem[]) {
  return JSON.stringify({
    title,
    date,
    notes,
    items: items.map(({ slug, sets, reps, notes, id }) => ({ slug, sets, reps, notes: notes ?? "", id: id ?? null })),
  });
}

function defaultDraftKey(mode: string): string | null {
  if (typeof window === "undefined") return null;
  const edit = new URLSearchParams(window.location.search).get("edit");
  return `${DRAFT_PREFIX}${mode}:${window.location.pathname}${edit ? `:${edit}` : ""}`;
}

function readDraft(key: string | null, initialSnap: string): Draft | null {
  if (!key) return null;
  try {
    const d = JSON.parse(localStorage.getItem(key) ?? "null") as Draft | null;
    if (!d || !Array.isArray(d.items) || Date.now() - d.savedAt > DRAFT_MAX_AGE || d.snap === initialSnap) return null;
    if (d.items.length === 0 && !d.title.trim()) return null;
    return d;
  } catch {
    return null;
  }
}

/**
 * Concept van deze route wissen, bijv. als je bewust de nieuwste serverversie laadt: anders
 * wordt direct weer de versie aangeboden die je net hebt weggegooid.
 */
export function clearBuilderDraft(mode: "workout" | "template", draftKey?: string | null) {
  removeDraft(draftKey === undefined ? defaultDraftKey(mode) : draftKey);
}

function removeDraft(key: string | null) {
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // geen opslag
  }
}

const exName = (slug: string) => EXERCISE_BY_SLUG[slug]?.name ?? slug;

export function WorkoutBuilder({
  mode,
  initial,
  saving,
  onSave,
  onDelete,
  error,
  draftKey,
}: {
  mode: "workout" | "template";
  initial: BuilderValue;
  saving: boolean;
  onSave: (value: BuilderValue) => void;
  onDelete?: () => void;
  /** Foutmelding van het opslaan, getoond boven de opslaanbalk. */
  error?: string | null;
  /** Sleutel voor het lokaal bewaren van een concept; `null` = geen concept. Standaard per route. */
  draftKey?: string | null;
}) {
  const userId = useUserId();
  const [title, setTitle] = useState(initial.title);
  const [date, setDate] = useState(initial.date);
  const [notes, setNotes] = useState(initial.notes);
  const [items, setItems] = useState<BuilderItem[]>(initial.items);
  const [picker, setPicker] = useState(false);
  const [pickerInfo, setPickerInfo] = useState<Exercise | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [swapKey, setSwapKey] = useState<string | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [infoKey, setInfoKey] = useState<string | null>(null);
  const [noteKeys, setNoteKeys] = useState<Set<string>>(() => new Set());
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [loadedName, setLoadedName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Kaart waarvan het reps-veld focus heeft: daaronder staan de snelkeuzes (datalist werkt slecht op iOS). */
  const [repsKey, setRepsKey] = useState<string | null>(null);
  /** Aantal oefeningen toegevoegd sinds de kiezer openging (voor de knop "Klaar"). */
  const [pickerAdded, setPickerAdded] = useState(0);

  // ── Wijzigingen bijhouden + concept bewaren ──
  const [initialSnap] = useState(() => snapshot(initial.title, initial.date, initial.notes, initial.items));
  const [storageKey] = useState(() => (draftKey === undefined ? defaultDraftKey(mode) : draftKey));
  const [offer, setOffer] = useState<Draft | null>(() => readDraft(storageKey, initialSnap));
  const snap = snapshot(title, date, notes, items);
  const dirty = snap !== initialSnap;

  // Het concept blijft bewaard tot het opslaan echt gelukt is. Mislukt het (netwerk, rechten),
  // dan staat het werk nog lokaal, ook als je daarna via de terugknop of het menu weggaat.
  // Ook als de herstel-melding nog in beeld is: nieuwe wijzigingen worden bewaard (het oude concept
  // blijft in het geheugen voor "Herstellen"). Zonder wijzigingen laten we het oude concept staan.
  useEffect(() => {
    if (!storageKey) return;
    try {
      if (dirty) {
        const draft: Draft = {
          savedAt: Date.now(),
          snap,
          title,
          date,
          notes,
          items: items.map(({ slug, sets, reps, notes, id }) => ({ slug, sets, reps, notes, id })),
        };
        localStorage.setItem(storageKey, JSON.stringify(draft));
      } else if (!offer) {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // geen opslag beschikbaar: dan alleen geen concept
    }
  }, [storageKey, offer, dirty, snap, title, date, notes, items]);

  // Na een gelukte save navigeert de pagina weg terwijl `saving` nog aan staat: pas dan het
  // concept wissen. Gaat `saving` weer uit (fout), dan blijft het concept gewoon staan.
  const savingRef = useRef(saving);
  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);
  useEffect(() => {
    const state = savingRef;
    return () => {
      if (state.current) removeDraft(storageKey);
    };
  }, [storageKey]);

  // Meldingen (bijv. "Ongedaan maken") staan onderin; hier staat daar de opslaanbalk. Met deze
  // variabele schuiven ze erboven, zodat ze de knop Opslaan niet afdekken.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--toast-lift", "4.25rem");
    return () => {
      root.style.removeProperty("--toast-lift");
    };
  }, []);

  useEffect(() => {
    if (!dirty || saving) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty, saving]);

  function restoreDraft(d: Draft) {
    const known = new Set(initial.items.map((it) => it.id).filter(Boolean));
    setTitle(d.title);
    setDate(d.date || initial.date);
    setNotes(d.notes);
    setItems(
      d.items.map((p) =>
        toBuilderItem({ slug: p.slug, sets: p.sets, reps: p.reps, notes: p.notes }, p.id && known.has(p.id) ? p.id : undefined),
      ),
    );
    setOffer(null);
    notify("Wijzigingen hersteld");
  }

  function dismissDraft() {
    removeDraft(storageKey);
    setOffer(null);
  }

  // ── Gelogde sets per bestaande oefening (bij het aanpassen van een groepstraining) ──
  const idKey = useMemo(
    () =>
      initial.items
        .map((it) => it.id)
        .filter(Boolean)
        .join(","),
    [initial.items],
  );
  const [logCounts, setLogCounts] = useState<Record<string, LogCount> | null>(null);
  useEffect(() => {
    if (!idKey) return;
    let cancelled = false;
    supabase
      .from("set_logs")
      .select("workout_exercise_id, user_id")
      .in("workout_exercise_id", idKey.split(","))
      .then(({ data, error }) => {
        if (cancelled || error) return;
        const sets = new Map<string, number>();
        const people = new Map<string, Set<string>>();
        for (const r of (data ?? []) as { workout_exercise_id: string; user_id: string }[]) {
          sets.set(r.workout_exercise_id, (sets.get(r.workout_exercise_id) ?? 0) + 1);
          if (!people.has(r.workout_exercise_id)) people.set(r.workout_exercise_id, new Set());
          people.get(r.workout_exercise_id)!.add(r.user_id);
        }
        setLogCounts(Object.fromEntries([...sets].map(([id, n]) => [id, { sets: n, people: people.get(id)?.size ?? 0 }])));
      });
    return () => {
      cancelled = true;
    };
  }, [idKey]);

  const countFor = (it: BuilderItem): LogCount | null => {
    if (!it.id) return { sets: 0, people: 0 };
    if (!logCounts) return null; // onbekend (nog aan het laden of niet leesbaar)
    return logCounts[it.id] ?? { sets: 0, people: 0 };
  };
  /** Oefeningen die bij opslaan gelogde sets zouden meenemen (of waarvan we het niet zeker weten). */
  const atRisk = (list: BuilderItem[]) => list.filter((it) => it.id && (countFor(it)?.sets ?? 1) > 0);

  function riskBody(list: BuilderItem[]) {
    const known = list.map(countFor);
    const sets = known.reduce((s, c) => s + (c?.sets ?? 0), 0);
    const people = Math.max(0, ...known.map((c) => c?.people ?? 0));
    return (
      <>
        <p>
          <span className="font-semibold text-ink">{list.map((it) => exName(it.slug)).join(", ")}</span>{" "}
          {known.every(Boolean) && sets > 0
            ? `heeft al ${plural(sets, "gelogde set", "gelogde sets")}${people > 1 ? ` van ${people} personen` : ""}.`
            : list.length === 1
              ? "hoort bij deze training en kan al gelogde sets hebben."
              : "horen bij deze training en kunnen al gelogde sets hebben."}
        </p>
        <p>Als je daarna opslaat, worden die sets definitief verwijderd. Tot het opslaan kun je dit nog ongedaan maken.</p>
      </>
    );
  }

  // ── Schema uit de link (?template=<id>, vanaf "Plan deze training") ──
  const [pendingTpl, setPendingTpl] = useState<string | null>(() =>
    mode === "workout" && initial.items.length === 0 && typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("template")
      : null,
  );
  /** Staat niet in de (mogelijk verouderde) lijst: los ophalen voordat we "bestaat niet" zeggen. */
  const [lookupTpl, setLookupTpl] = useState<string | null>(null);
  const { templates, error: tplError, retry: retryTemplates } = useTemplateList(userId, templatesOpen || !!pendingTpl);
  // Lijst laden mislukt en niets in de cache (offline, eerste bezoek): dit ene schema los ophalen
  // in plaats van eindeloos een skeleton te tonen. Die losse fetch meldt zelf of het lukte.
  if (pendingTpl && !templates && tplError) {
    setPendingTpl(null);
    setLookupTpl(pendingTpl);
  }
  if (pendingTpl && templates) {
    setPendingTpl(null);
    const t = templates.find((x) => x.id === pendingTpl);
    if (t) {
      setItems(t.exercises.map((p) => toBuilderItem(p)));
      if (!title.trim()) setTitle(t.name);
      setLoadedName(t.name);
      setNotice(`Schema "${t.name}" is geladen. Pas aan wat je wilt en sla op.`);
    } else {
      setLookupTpl(pendingTpl);
    }
  }
  useEffect(() => {
    if (!lookupTpl) return;
    let cancelled = false;
    supabase
      .from("templates")
      .select("*")
      .eq("id", lookupTpl)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setLookupTpl(null);
        const t = data as Template | null;
        if (t) {
          setItems((prev) => (prev.length ? prev : t.exercises.map((p) => toBuilderItem(p))));
          setTitle((prev) => (prev.trim() ? prev : t.name));
          setLoadedName(t.name);
          setNotice(`Schema "${t.name}" is geladen. Pas aan wat je wilt en sla op.`);
        } else {
          setNotice(
            error
              ? `Schema laden mislukt: ${errorMessage(error)}. Probeer het via Schema laden.`
              : "Dat schema bestaat niet meer. Kies er een via Schema laden.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [lookupTpl]);
  const loadingTpl = !!pendingTpl || !!lookupTpl;

  const recent = useRecentExercises(userId);
  const recentTop = useMemo(() => recent?.slice(0, 8), [recent]);
  const recentSet = useMemo(() => new Set(recentTop), [recentTop]);
  const lastBySlug = useLastSessions(userId);
  const analysis = useMemo(() => analyzePlan(items), [items]);

  // ── Acties ──
  function markFresh(keys: string[]) {
    setFresh((prev) => new Set([...prev, ...keys]));
    setTimeout(() => {
      setFresh((prev) => {
        const next = new Set(prev);
        for (const k of keys) next.delete(k);
        return next;
      });
    }, 500);
  }

  /** `quiet`: geen melding (in de kiezer laten het teller-rondje en de knop "Klaar" het al zien). */
  function add(e: Exercise, quiet = false) {
    const item = toBuilderItem({ slug: e.slug, sets: 3, reps: defaultTargetReps(e.slug) });
    setItems((prev) => [...prev, item]);
    markFresh([item.key]);
    if (!quiet) notify(`${e.name} toegevoegd`);
  }

  function update(key: string, patch: Partial<BuilderItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  const moveTo = useCallback((key: string, to: number | "up" | "down") => {
    setItems((prev) => {
      const from = prev.findIndex((x) => x.key === key);
      if (from < 0) return prev;
      const target = to === "up" ? from - 1 : to === "down" ? from + 1 : to;
      const j = Math.max(0, Math.min(prev.length - 1, target));
      if (j === from) return prev;
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(j, 0, it);
      return next;
    });
  }, []);

  function duplicate(it: BuilderItem) {
    const copy = toBuilderItem({ slug: it.slug, sets: it.sets, reps: it.reps, notes: it.notes });
    setItems((prev) => {
      const i = prev.findIndex((x) => x.key === it.key);
      const next = [...prev];
      next.splice(i + 1, 0, copy);
      return next;
    });
    markFresh([copy.key]);
    notify(`${exName(it.slug)} gedupliceerd`);
  }

  function remove(it: BuilderItem) {
    const run = () => {
      const index = items.findIndex((x) => x.key === it.key);
      setItems((prev) => prev.filter((x) => x.key !== it.key));
      notify(`${exName(it.slug)} verwijderd`, {
        action: {
          label: "Ongedaan maken",
          run: () =>
            setItems((prev) => {
              if (prev.some((x) => x.key === it.key)) return prev;
              const next = [...prev];
              next.splice(Math.min(Math.max(0, index), next.length), 0, it);
              return next;
            }),
        },
      });
    };
    const risky = atRisk([it]);
    if (risky.length) setConfirm({ title: "Oefening verwijderen?", body: riskBody(risky), confirmLabel: "Verwijderen", run });
    else run();
  }

  function swap(it: BuilderItem, next: Exercise) {
    setSwapKey(null);
    if (next.slug === it.slug) return;
    const risky = atRisk([it]).length > 0;
    const run = () => {
      // Met gelogde sets: als nieuwe oefening opslaan (anders zouden die sets bij de nieuwe oefening horen).
      setItems((prev) => prev.map((x) => (x.key === it.key ? { ...x, slug: next.slug, id: risky ? undefined : x.id } : x)));
      notify(`Gewisseld naar ${next.name}`, {
        action: { label: "Ongedaan maken", run: () => setItems((prev) => prev.map((x) => (x.key === it.key ? it : x))) },
      });
    };
    if (risky) setConfirm({ title: "Oefening wisselen?", body: riskBody([it]), confirmLabel: "Wisselen", run });
    else run();
  }

  function applyTemplate(t: Template, replace: boolean) {
    setTemplatesOpen(false);
    const loaded = t.exercises.map((p) => toBuilderItem(p));
    const prevItems = items;
    const prevTitle = title;
    const takeTitle = !title.trim() || title === loadedName;
    const undo = {
      label: "Ongedaan maken",
      run: () => {
        setItems(prevItems);
        setTitle(prevTitle);
      },
    };
    if (!replace) {
      setItems((prev) => [...prev, ...loaded]);
      markFresh(loaded.map((x) => x.key));
      if (!title.trim()) setTitle(t.name);
      notify(`${plural(loaded.length, "oefening", "oefeningen")} toegevoegd`, { action: undo });
      return;
    }
    // Bestaande oefeningen met dezelfde naam houden hun id, zodat gelogde sets blijven bestaan.
    const used = new Set<string>();
    const next = loaded.map((p) => {
      const match = items.find((x) => x.id && x.slug === p.slug && !used.has(x.id));
      if (!match) return p;
      used.add(match.id!);
      return { ...p, id: match.id, key: match.key };
    });
    const dropped = items.filter((x) => x.id && !used.has(x.id));
    const run = () => {
      setItems(next);
      if (takeTitle) setTitle(t.name);
      setLoadedName(t.name);
      notify(`Schema "${t.name}" geladen`, { action: undo });
    };
    const risky = atRisk(dropped);
    if (risky.length) setConfirm({ title: "Training vervangen?", body: riskBody(risky), confirmLabel: "Vervangen", run });
    else run();
  }

  function submit() {
    onSave({
      title: title.trim(),
      date,
      notes: notes.trim(),
      items: items.map((it) => ({ ...it, reps: it.reps.trim() || defaultTargetReps(it.slug), notes: it.notes?.trim() || undefined })),
    });
  }

  // ── Slepen om de volgorde te veranderen (greep links op de kaart) ──
  const drag = useRef<Drag | null>(null);

  /** Zet de gesleepte kaart onder de vinger en wisselt van plek zodra hij half over de buurman ligt. */
  const dragStep = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    const dy = d.lastY - d.startY;
    d.el.style.transform = `translateY(${dy}px)`;
    if (d.lock) return;
    const next = d.el.nextElementSibling as HTMLElement | null;
    const prev = d.el.previousElementSibling as HTMLElement | null;
    if (dy > 0 && next && dy > next.offsetHeight / 2 + CARD_GAP / 2) {
      d.lock = true;
      d.startY += next.offsetHeight + CARD_GAP;
      moveTo(d.key, "down");
    } else if (dy < 0 && prev && -dy > prev.offsetHeight / 2 + CARD_GAP / 2) {
      d.lock = true;
      d.startY -= prev.offsetHeight + CARD_GAP;
      moveTo(d.key, "up");
    }
  }, [moveTo]);

  // Na het verspringen staat de kaart op zijn nieuwe plek in de DOM: positie opnieuw zetten.
  useLayoutEffect(() => {
    const d = drag.current;
    if (!d) return;
    d.lock = false;
    dragStep();
  }, [items, dragStep]);

  /** Opruimen van de lopende sleepactie (luisteraars en animatieframe). */
  const dragCleanup = useRef<(() => void) | null>(null);

  function endDrag() {
    const d = drag.current;
    if (!d) return;
    dragCleanup.current?.();
    dragCleanup.current = null;
    d.el.style.transform = "";
    drag.current = null;
    setDraggingKey(null);
  }

  function onGripDown(e: React.PointerEvent<HTMLButtonElement>, key: string) {
    if (e.button !== 0 || drag.current) return;
    const el = e.currentTarget.closest("li");
    if (!el) return;
    e.preventDefault();
    const d: Drag = { key, pointerId: e.pointerId, startY: e.clientY, lastY: e.clientY, el, lock: false, raf: 0 };
    drag.current = d;
    setDraggingKey(key);
    // Luisteren op window (niet via pointer capture): de kaart verhuist in de DOM tijdens het slepen.
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== d.pointerId) return;
      ev.preventDefault();
      d.lastY = ev.clientY;
      dragStep();
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId === d.pointerId) endDrag();
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    dragCleanup.current = () => {
      cancelAnimationFrame(d.raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // Automatisch scrollen als je de kaart naar de rand van het scherm sleept.
    const tick = () => {
      const cur = drag.current;
      if (!cur || cur !== d) return;
      const edgeTop = 96;
      const edgeBottom = window.innerHeight - 170;
      const speed = cur.lastY < edgeTop ? -Math.min(14, (edgeTop - cur.lastY) / 4) : cur.lastY > edgeBottom ? Math.min(14, (cur.lastY - edgeBottom) / 4) : 0;
      if (speed) {
        const before = window.scrollY;
        window.scrollBy(0, speed);
        const moved = window.scrollY - before;
        if (moved) {
          cur.startY -= moved;
          dragStep();
        }
      }
      cur.raf = requestAnimationFrame(tick);
    };
    d.raf = requestAnimationFrame(tick);
  }

  function onGripKey(e: React.KeyboardEvent<HTMLButtonElement>, it: BuilderItem, i: number) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const up = e.key === "ArrowUp";
    if ((up && i === 0) || (!up && i === items.length - 1)) return;
    moveTo(it.key, up ? "up" : "down");
    notify(`${exName(it.slug)} naar plek ${up ? i : i + 2}`, { ms: 1200, tone: "info" });
  }

  useEffect(() => {
    const cleanup = dragCleanup;
    return () => cleanup.current?.();
  }, []);

  const missing = !title.trim()
    ? mode === "workout"
      ? "Geef de training een naam."
      : "Geef het schema een naam."
    : items.length === 0
      ? "Voeg minstens één oefening toe."
      : mode === "workout" && !date
        ? "Kies een datum."
        : null;
  const sets = totalSets(items);
  const menuIndex = menuKey ? items.findIndex((x) => x.key === menuKey) : -1;
  const menuItem = menuIndex >= 0 ? items[menuIndex] : null;
  const infoItem = infoKey ? (items.find((x) => x.key === infoKey) ?? null) : null;
  const swapItem = swapKey ? (items.find((x) => x.key === swapKey) ?? null) : null;

  const menuActions: ExerciseAction[] = menuItem
    ? [
        { id: "info", label: "Uitleg en video", icon: ActionIcons.info, run: () => setInfoKey(menuItem.key) },
        {
          id: "swap",
          label: "Wisselen",
          hint: "Zelfde spieren, bijv. als het apparaat bezet is",
          icon: ActionIcons.swap,
          run: () => setSwapKey(menuItem.key),
        },
        {
          id: "note",
          label: menuItem.notes?.trim() || noteKeys.has(menuItem.key) ? "Notitie weghalen" : "Notitie toevoegen",
          icon: ActionIcons.note,
          run: () => {
            const has = !!menuItem.notes?.trim() || noteKeys.has(menuItem.key);
            if (has) update(menuItem.key, { notes: undefined });
            setNoteKeys((prev) => {
              const next = new Set(prev);
              if (has) next.delete(menuItem.key);
              else next.add(menuItem.key);
              return next;
            });
          },
        },
        { id: "copy", label: "Dupliceren", icon: ActionIcons.copy, run: () => duplicate(menuItem) },
        { id: "top", label: "Naar boven", icon: ActionIcons.top, disabled: menuIndex === 0, run: () => moveTo(menuItem.key, 0) },
        {
          id: "bottom",
          label: "Naar onder",
          icon: ActionIcons.bottom,
          disabled: menuIndex === items.length - 1,
          run: () => moveTo(menuItem.key, items.length - 1),
        },
        { id: "remove", label: "Verwijderen", icon: ActionIcons.trash, danger: true, run: () => remove(menuItem) },
      ]
    : [];

  return (
    <div className="space-y-5">
      {offer && (
        <div className="card animate-fade-up space-y-3 border-accent/40" role="status">
          <p className="text-sm">
            <span className="font-semibold">Niet-opgeslagen wijzigingen gevonden</span>
            <span className="text-muted">
              {" "}
              van {new Date(offer.savedAt).toLocaleString("nl-NL", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
              {offer.items.length > 0 ? ` (${plural(offer.items.length, "oefening", "oefeningen")})` : ""}.
            </span>
          </p>
          <div className="flex gap-2">
            <button className="btn-primary min-h-11 flex-1" onClick={() => restoreDraft(offer)}>
              Herstellen
            </button>
            <button className="btn-ghost min-h-11 flex-1" onClick={dismissDraft}>
              Negeren
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className="animate-fade-up flex items-center gap-3 rounded-2xl border border-line bg-surface-2 py-1 pl-3 pr-1 text-sm" role="status">
          <CheckIcon size={16} className="shrink-0 text-accent" />
          <p className="min-w-0 flex-1 py-2">{notice}</p>
          <button onClick={() => setNotice(null)} className="min-h-11 shrink-0 rounded-xl px-3 text-xs text-muted hover:text-ink" aria-label="Melding sluiten">
            Sluiten
          </button>
        </div>
      )}

      <div className="card space-y-3">
        <div>
          <label className="label" htmlFor="title">
            {mode === "workout" ? "Naam training" : "Naam schema"}
          </label>
          <input
            id="title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={mode === "workout" ? "Bijv. Push day" : "Bijv. Upper body A"}
            maxLength={80}
            enterKeyHint="done"
          />
        </div>
        {mode === "workout" && (
          <>
            <div>
              <label className="label" htmlFor="date">
                Datum
              </label>
              <input id="date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="notes">
                Notitie voor de groep (optioneel)
              </label>
              <textarea
                id="notes"
                className="input min-h-20"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Bijv. rustig opwarmen, focus op techniek"
              />
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary min-h-11 flex-1"
          onClick={() => {
            setPickerAdded(0);
            setPicker(true);
          }}
        >
          <PlusIcon size={16} /> Oefening toevoegen
        </button>
        {mode === "workout" && (
          <button className="btn-ghost min-h-11" onClick={() => setTemplatesOpen(true)}>
            Schema laden
          </button>
        )}
      </div>

      {items.length === 0 ? (
        loadingTpl ? (
          <div className="space-y-3" aria-busy aria-label="Schema laden">
            <div className="skeleton h-36" />
            <div className="skeleton h-36" />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center">
            <p className="font-medium">Nog geen oefeningen</p>
            <p className="mt-1 text-sm text-muted">
              {mode === "workout"
                ? "Voeg oefeningen toe of laad een bestaand schema."
                : "Voeg oefeningen toe; de spieranalyse hieronder vult zich vanzelf."}
            </p>
          </div>
        )
      ) : (
        <>
          <div className="-mb-2 flex items-baseline justify-between gap-2 text-xs text-muted">
            <p>
              {plural(items.length, "oefening", "oefeningen")} · {plural(sets, "set", "sets")} · ca. {estimateMinutes(items)} min
            </p>
            {items.length > 1 && <p className="hidden sm:block">Sleep aan de greep om te verplaatsen</p>}
          </div>
          <ol className="space-y-3">
            {items.map((it, i) => {
              const ex = EXERCISE_BY_SLUG[it.slug];
              const name = ex?.name ?? it.slug;
              const logged = countFor(it);
              const hint = lastHint(lastBySlug?.get(it.slug), it.slug, it.reps, it.sets);
              const showNote = !!it.notes || noteKeys.has(it.key);
              const dragging = draggingKey === it.key;
              return (
                <li
                  key={it.key}
                  className={`card space-y-2.5 p-3 ${fresh.has(it.key) ? "animate-fade-in" : ""} ${
                    dragging ? "relative z-10 border-accent/50 shadow-2xl shadow-black/50" : ""
                  }`}
                >
                  <div className="flex items-start gap-1">
                    <button
                      type="button"
                      onPointerDown={(e) => onGripDown(e, it.key)}
                      onKeyDown={(e) => onGripKey(e, it, i)}
                      aria-label={`${name}, plek ${i + 1} van ${items.length}. Sleep of gebruik pijl omhoog en omlaag om te verplaatsen`}
                      className={`-ml-1 flex h-11 w-8 shrink-0 touch-none select-none items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink ${
                        dragging ? "cursor-grabbing text-accent" : "cursor-grab"
                      }`}
                    >
                      <GripIcon />
                    </button>
                    <button
                      type="button"
                      onClick={() => setInfoKey(it.key)}
                      className="min-w-0 flex-1 rounded-lg py-1 text-left transition-colors hover:bg-surface-2/50"
                      aria-label={`${name}: uitleg en video`}
                    >
                      <p className="font-semibold leading-tight">
                        <span className="mr-1.5 text-xs font-bold tabular-nums text-muted">{i + 1}</span>
                        {name}
                      </p>
                      {ex && (
                        <div className="mt-1.5">
                          <MuscleChips primary={ex.primary} limit={3} />
                        </div>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMenuKey(it.key)}
                      aria-label={`Meer opties voor ${name}`}
                      aria-haspopup="menu"
                      className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink active:scale-90"
                    >
                      <DotsIcon />
                    </button>
                  </div>

                  {(hint || (logged && logged.sets > 0)) && (
                    <div className="space-y-0.5 pl-7 text-[11px] leading-snug">
                      {hint && (
                        <p className="text-muted">
                          <span className="tabular-nums">Jij {formatDate(hint.date, { month: "short" })}: {hint.last}</span>
                          {hint.next && (
                            <>
                              {" · "}
                              <span className="font-medium text-accent">Probeer {hint.next}</span>
                            </>
                          )}
                        </p>
                      )}
                      {logged && logged.sets > 0 && (
                        <p className="font-medium text-warn">
                          {plural(logged.sets, "set", "sets")} gelogd
                          {logged.people > 1 ? ` door ${logged.people} personen` : ""}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <Stepper value={it.sets} onChange={(v) => update(it.key, { sets: v })} label={`Sets voor ${name}`} suffix="sets" />
                    </div>
                    <div className="relative w-[6.75rem] shrink-0">
                      <input
                        id={`reps-${it.key}`}
                        className="input h-[46px] pr-11 text-center tabular-nums"
                        value={it.reps}
                        onChange={(e) => update(it.key, { reps: e.target.value })}
                        onFocus={() => setRepsKey(it.key)}
                        onBlur={(e) => {
                          if (!e.target.value.trim()) update(it.key, { reps: defaultTargetReps(it.slug) });
                          const key = it.key;
                          // Even wachten: een tik op een snelkeuze moet nog aankomen.
                          setTimeout(() => setRepsKey((k) => (k === key ? null : k)), 150);
                        }}
                        aria-controls={repsKey === it.key ? `reps-presets-${it.key}` : undefined}
                        placeholder={defaultTargetReps(it.slug)}
                        maxLength={20}
                        enterKeyHint="done"
                        aria-label={`${ex?.timed ? "Seconden" : "Reps"} voor ${name}`}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted" aria-hidden>
                        {ex?.timed ? "sec" : "reps"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setNoteKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(it.key) && !it.notes) next.delete(it.key);
                          else next.add(it.key);
                          return next;
                        })
                      }
                      aria-label={showNote ? `Notitie voor ${name}` : `Notitie toevoegen aan ${name}`}
                      aria-pressed={showNote}
                      className={`relative flex h-[46px] w-11 shrink-0 items-center justify-center rounded-xl border transition active:scale-95 ${
                        showNote ? "border-accent/40 text-accent" : "border-line text-muted hover:text-ink"
                      }`}
                    >
                      {ActionIcons.note}
                    </button>
                  </div>

                  {repsKey === it.key && (
                    <div
                      id={`reps-presets-${it.key}`}
                      role="group"
                      aria-label={`Snelkeuze ${ex?.timed ? "seconden" : "reps"} voor ${name}`}
                      className="animate-fade-in -mx-1 -mt-1.5 flex gap-1 overflow-x-auto px-1"
                    >
                      {(ex?.timed ? SECONDS_PRESETS : REPS_PRESETS).map((r) => (
                        <button
                          key={r}
                          type="button"
                          // Focus in het veld houden, zodat de rij niet verdwijnt voordat de tik telt.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            update(it.key, { reps: r });
                            setRepsKey(null);
                            (document.activeElement as HTMLElement | null)?.blur();
                          }}
                          aria-pressed={it.reps === r}
                          className="group flex min-h-11 shrink-0 items-center active:scale-95"
                        >
                          <span
                            className={`flex h-8 items-center rounded-full border px-3 text-xs font-semibold tabular-nums transition-colors ${
                              it.reps === r ? "border-accent bg-accent text-accent-ink" : "border-line text-muted group-hover:text-ink"
                            }`}
                          >
                            {r}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {showNote && (
                    <input
                      className="input animate-fade-in text-sm"
                      value={it.notes ?? ""}
                      onChange={(e) => update(it.key, { notes: e.target.value })}
                      placeholder="Notitie, bijv. 2 sec pauze onderin"
                      aria-label={`Notitie voor ${name}`}
                      maxLength={200}
                      enterKeyHint="done"
                      autoFocus={!it.notes}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}

      <MuscleAnalysis analysis={analysis} onAdd={add} mode={mode} />

      {items.length > 0 && (
        <Link
          href={`/coach?q=${encodeURIComponent(
            [
              `Geef feedback op dit ${mode === "workout" ? "trainingsplan" : "schema"}${title.trim() ? ` ("${title.trim()}")` : ""}:`,
              ...items.map((it) => `- ${exName(it.slug)}: ${it.sets}×${it.reps || defaultTargetReps(it.slug)}${EXERCISE_BY_SLUG[it.slug]?.timed ? " s" : ""}${it.notes?.trim() ? ` (${it.notes.trim()})` : ""}`),
              "Wat zou je aanpassen?",
            ].join("\n"),
          )}`}
          className="btn-ghost min-h-11 w-full"
        >
          <SparkleIcon className="text-accent" /> Vraag de coach om feedback
        </Link>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
          {storageKey ? " Je wijzigingen staan nog lokaal bewaard." : ""}
        </p>
      )}

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-10 space-y-1.5 rounded-2xl border border-line bg-bg/95 p-2 backdrop-blur">
        {missing && items.length > 0 && <p className="px-1 text-center text-xs text-muted">{missing}</p>}
        <div className="flex gap-2">
          {onDelete && (
            <button className="btn-danger min-h-11 px-3" onClick={onDelete} disabled={saving}>
              Verwijderen
            </button>
          )}
          {mode === "workout" && items.length > 0 && (
            <button className="btn-ghost min-h-11 px-3" onClick={() => setSaveTplOpen(true)} disabled={saving}>
              Bewaar als schema
            </button>
          )}
          <button className="btn-primary min-h-11 flex-1" disabled={saving || !!missing} onClick={submit}>
            {saving ? "Opslaan…" : "Opslaan"}
          </button>
        </div>
      </div>

      <Sheet open={picker} onClose={() => setPicker(false)} title="Oefening kiezen">
        <ExerciseFilter prioritize={recentTop} storageKey={`picker:${mode}`}>
          {(list) => (
            <ul className="divide-y divide-line">
              {list.map((e) => {
                const count = items.filter((it) => it.slug === e.slug).length;
                const last = lastBySlug?.get(e.slug);
                return (
                  <li key={e.slug} className="flex items-center gap-1" style={{ contentVisibility: "auto", containIntrinsicSize: "auto 72px" }}>
                    <button
                      onClick={() => {
                        add(e, true);
                        setPickerAdded((n) => n + 1);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left transition active:bg-surface-2"
                      aria-label={`${e.name} toevoegen${count ? `, staat er al ${count} keer in` : ""}`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="font-medium leading-tight">
                          {e.name}
                          {recentSet.has(e.slug) && (
                            <span className="ml-2 rounded-full border border-line px-1.5 py-px align-middle text-[10px] font-medium text-muted">
                              Recent
                            </span>
                          )}
                        </p>
                        <MuscleChips primary={e.primary} secondary={e.secondary} limit={4} />
                        {last && <p className="text-[11px] tabular-nums text-muted">Vorige keer {formatSet(last.bestSet)}</p>}
                      </div>
                      <span
                        key={count}
                        className={`flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full px-2 text-sm font-semibold ${
                          count ? "animate-pop bg-accent/15 text-accent" : "bg-surface-2 text-muted"
                        }`}
                        aria-hidden
                      >
                        {count ? (
                          <span className="inline-flex items-center gap-1">
                            <CheckIcon size={14} /> {count}
                          </span>
                        ) : (
                          <PlusIcon size={16} />
                        )}
                      </span>
                    </button>
                    <InfoButton label={`Uitleg over ${e.name}`} onClick={() => setPickerInfo(e)} />
                  </li>
                );
              })}
            </ul>
          )}
        </ExerciseFilter>
        <ExerciseInfoSheet
          exercise={pickerInfo}
          onClose={() => setPickerInfo(null)}
          last={pickerInfo ? lastBySlug?.get(pickerInfo.slug) : undefined}
          action={{
            label: "Toevoegen",
            run: (e) => {
              setPickerInfo(null);
              add(e, true);
              setPickerAdded((n) => n + 1);
            },
          }}
        />
        {pickerAdded > 0 && (
          <div className="sticky -bottom-px z-10 -mx-5 mt-3 border-t border-line bg-surface/95 px-5 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
            <button className="btn-primary min-h-11 w-full" onClick={() => setPicker(false)}>
              <CheckIcon size={16} /> Klaar ({pickerAdded} toegevoegd)
            </button>
          </div>
        )}
      </Sheet>

      <ExerciseInfoSheet
        exercise={infoItem ? (EXERCISE_BY_SLUG[infoItem.slug] ?? null) : null}
        onClose={() => setInfoKey(null)}
        last={infoItem ? lastBySlug?.get(infoItem.slug) : undefined}
        action={
          infoItem
            ? {
                label: "Wisselen",
                run: () => {
                  const key = infoItem.key;
                  setInfoKey(null);
                  setSwapKey(key);
                },
              }
            : undefined
        }
      />

      <ExerciseActionsSheet
        title={menuItem ? exName(menuItem.slug) : "Oefening"}
        open={!!menuItem}
        onClose={() => setMenuKey(null)}
        actions={menuActions}
      />

      <SwapSheet
        slug={swapItem?.slug ?? null}
        lastBySlug={lastBySlug}
        onClose={() => setSwapKey(null)}
        onPick={(e) => {
          if (swapItem) swap(swapItem, e);
        }}
      />

      <TemplatePicker
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        templates={templates}
        error={tplError}
        onRetry={retryTemplates}
        hasItems={items.length > 0}
        onPick={applyTemplate}
      />

      <SaveTemplateSheet
        open={saveTplOpen}
        onClose={() => setSaveTplOpen(false)}
        defaultName={title.trim() || "Mijn schema"}
        onSave={async (name) => {
          await insertTemplate(userId, name, items);
          setSaveTplOpen(false);
          notify(`Opgeslagen als schema "${name}"`);
        }}
      />

      <ConfirmSheet
        open={!!confirm}
        title={confirm?.title ?? ""}
        confirmLabel={confirm?.confirmLabel ?? "Doorgaan"}
        danger
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          confirm?.run();
          setConfirm(null);
        }}
      >
        {confirm?.body}
      </ConfirmSheet>
    </div>
  );
}

function GripIcon() {
  return (
    <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden>
      {[4, 10, 16].flatMap((y) => [<circle key={`a${y}`} cx="5" cy={y} r="1.6" />, <circle key={`b${y}`} cx="11" cy={y} r="1.6" />])}
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="19" cy="12" r="1.9" />
    </svg>
  );
}
