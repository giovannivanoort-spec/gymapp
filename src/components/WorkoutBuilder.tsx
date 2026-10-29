"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { analyzePlan } from "@/lib/analysis";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import type { Exercise } from "@/lib/exercise-types";
import { errorMessage, supabase } from "@/lib/supabase";
import type { PlannedExercise, Template } from "@/lib/types";
import { ExerciseFilter } from "./ExerciseFilter";
import { MuscleAnalysis } from "./MuscleAnalysis";
import { MuscleChips } from "./MuscleChips";
import { Sheet } from "./Sheet";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CloseIcon, PlusIcon, SparkleIcon } from "./Icons";

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

export function WorkoutBuilder({
  mode,
  initial,
  saving,
  onSave,
  onDelete,
}: {
  mode: "workout" | "template";
  initial: BuilderValue;
  saving: boolean;
  onSave: (value: BuilderValue) => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [date, setDate] = useState(initial.date);
  const [notes, setNotes] = useState(initial.notes);
  const [items, setItems] = useState<BuilderItem[]>(initial.items);
  const [picker, setPicker] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const analysis = useMemo(() => analyzePlan(items), [items]);

  function add(e: Exercise) {
    setItems((prev) => [...prev, toBuilderItem({ slug: e.slug, sets: 3, reps: "8-12" })]);
    setFlash(`${e.name} toegevoegd`);
    setTimeout(() => setFlash(null), 1500);
  }

  function update(key: string, patch: Partial<BuilderItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function move(index: number, dir: -1 | 1) {
    setItems((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  async function saveAsTemplate() {
    const name = window.prompt("Naam van het schema", title || "Mijn schema");
    if (!name) return;
    const { error } = await supabase.from("templates").insert({
      name,
      exercises: items.map(({ slug, sets, reps, notes }) => ({ slug, sets, reps, notes })),
    });
    setFlash(error ? errorMessage(error) : "Opgeslagen als schema");
    setTimeout(() => setFlash(null), 2000);
  }

  return (
    <div className="space-y-5">
      <div className="card space-y-3">
        <div>
          <label className="label" htmlFor="title">{mode === "workout" ? "Naam training" : "Naam schema"}</label>
          <input
            id="title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={mode === "workout" ? "Bijv. Push day" : "Bijv. Upper body A"}
          />
        </div>
        {mode === "workout" && (
          <>
            <div>
              <label className="label" htmlFor="date">Datum</label>
              <input id="date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="notes">Notitie voor de groep (optioneel)</label>
              <textarea
                id="notes"
                className="input min-h-20"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Bijv. rustig opwarmen, 90 sec rust tussen sets"
              />
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn-primary flex-1" onClick={() => setPicker(true)}>
          + Oefening toevoegen
        </button>
        {mode === "workout" && (
          <button className="btn-ghost" onClick={() => setTemplatesOpen(true)}>
            Schema laden
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nog geen oefeningen.</p>
      ) : (
        <ol className="space-y-3">
          {items.map((it, i) => {
            const ex = EXERCISE_BY_SLUG[it.slug];
            return (
              <li key={it.key} className="card space-y-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-muted">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{ex?.name ?? it.slug}</p>
                    {ex && <MuscleChips primary={ex.primary} />}
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <IconBtn label="Omhoog" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUpIcon size={16} /></IconBtn>
                    <IconBtn label="Omlaag" onClick={() => move(i, 1)} disabled={i === items.length - 1}><ArrowDownIcon size={16} /></IconBtn>
                    <IconBtn label="Verwijderen" onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))}><CloseIcon size={16} /></IconBtn>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label">Sets</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={20}
                      className="input"
                      value={it.sets}
                      onChange={(e) => update(it.key, { sets: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
                    />
                  </div>
                  <div>
                    <label className="label">Reps</label>
                    <input
                      className="input"
                      value={it.reps}
                      onChange={(e) => update(it.key, { reps: e.target.value })}
                      placeholder="8-12"
                    />
                  </div>
                </div>
                <input
                  className="input text-sm"
                  value={it.notes ?? ""}
                  onChange={(e) => update(it.key, { notes: e.target.value })}
                  placeholder="Notitie, bijv. 2 sec pauze onderin"
                />
              </li>
            );
          })}
        </ol>
      )}

      <MuscleAnalysis analysis={analysis} onAdd={add} />

      {items.length > 0 && (
        <Link
          href={`/coach?q=${encodeURIComponent(
            [
              `Geef feedback op dit schema${title ? ` ("${title}")` : ""}:`,
              ...items.map((it) => `- ${EXERCISE_BY_SLUG[it.slug]?.name ?? it.slug}: ${it.sets}×${it.reps}`),
              "Wat zou je aanpassen?",
            ].join("\n"),
          )}`}
          className="btn-ghost w-full"
        >
          <SparkleIcon className="text-accent" /> Vraag de coach om feedback op dit schema
        </Link>
      )}

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-10 flex gap-2 rounded-2xl border border-line bg-bg/95 p-2 backdrop-blur">
        {onDelete && (
          <button className="btn-danger" onClick={onDelete} disabled={saving}>
            Verwijderen
          </button>
        )}
        {mode === "workout" && items.length > 0 && (
          <button className="btn-ghost" onClick={saveAsTemplate} disabled={saving}>
            Bewaar als schema
          </button>
        )}
        <button
          className="btn-primary flex-1"
          disabled={saving || !title.trim() || items.length === 0 || (mode === "workout" && !date)}
          onClick={() => onSave({ title: title.trim(), date, notes: notes.trim(), items })}
        >
          {saving ? "Opslaan…" : "Opslaan"}
        </button>
      </div>

      {flash && (
        <div className="fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[60] mx-auto w-fit rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink shadow-lg">
          {flash}
        </div>
      )}

      <Sheet open={picker} onClose={() => setPicker(false)} title="Oefening kiezen">
        <ExerciseFilter>
          {(list) => (
            <ul className="divide-y divide-line">
              {list.map((e) => {
                const count = items.filter((it) => it.slug === e.slug).length;
                return (
                  <li key={e.slug}>
                    <button onClick={() => add(e)} className="flex w-full items-center gap-3 py-3 text-left">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{e.name}</p>
                        <MuscleChips primary={e.primary} secondary={e.secondary} limit={4} />
                      </div>
                      <span className={`text-sm font-semibold ${count ? "text-accent" : "text-muted"}`}>
                        {count ? <span className="inline-flex items-center gap-1"><CheckIcon size={14} /> {count}</span> : <PlusIcon />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ExerciseFilter>
      </Sheet>

      <TemplatePicker
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onPick={(t, replace) => {
          const loaded = t.exercises.map((p) => toBuilderItem(p));
          setItems((prev) => (replace ? loaded : [...prev, ...loaded]));
          if (!title.trim() || replace) setTitle(t.name);
          setTemplatesOpen(false);
        }}
      />
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink active:scale-90 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function TemplatePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (t: Template, replace: boolean) => void;
}) {
  const [templates, setTemplates] = useState<Template[] | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("templates")
      .select("*")
      .order("name")
      .then(({ data }) => setTemplates(data ?? []));
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="Schema laden">
      {templates === null ? (
        <div className="space-y-3"><div className="skeleton h-24" /><div className="skeleton h-40" /></div>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted">
          Je hebt nog geen schema&apos;s. Maak er een via het tabblad Schema&apos;s, of bewaar deze training als schema.
        </p>
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => (
            <li key={t.id} className="rounded-xl border border-line p-3">
              <p className="font-semibold">{t.name}</p>
              <p className="mb-2 text-xs text-muted">
                {t.exercises.map((p) => EXERCISE_BY_SLUG[p.slug]?.name ?? p.slug).join(" · ")}
              </p>
              <div className="flex gap-2">
                <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => onPick(t, true)}>
                  Gebruiken
                </button>
                <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => onPick(t, false)}>
                  Toevoegen aan huidige
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
