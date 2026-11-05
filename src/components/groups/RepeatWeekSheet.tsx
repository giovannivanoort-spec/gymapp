"use client";

import { useMemo, useState } from "react";
import { CheckIcon } from "@/components/Icons";
import { Sheet } from "@/components/Sheet";
import { toBuilderItem } from "@/components/WorkoutBuilder";
import { toISODate } from "@/lib/dates";
import { errorMessage, supabase } from "@/lib/supabase";
import type { WorkoutExercise } from "@/lib/types";
import { formatWeekRange, parseISODate, weekRange } from "@/lib/week";
import { plural, type GroupWorkout } from "./groupData";
import { saveGroupWorkout } from "./saveGroupWorkout";

const shortDay = (iso: string) =>
  parseISODate(iso)
    .toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })
    .replace(/\./g, "");

type Row = {
  w: GroupWorkout;
  target: string;
  /** Waarom deze training niet over te nemen is (null = kan wel). */
  blocked: string | null;
};

function friendly(err: unknown): string {
  const msg = errorMessage(err);
  if (/failed to fetch|network|load failed/i.test(msg)) return "Geen verbinding. Probeer het opnieuw.";
  if (/row-level security|permission|42501/i.test(msg)) return "Alleen trainers van deze groep kunnen trainingen plannen.";
  return msg;
}

/**
 * Vorige week herhalen: de groepstrainingen van vorige week op dezelfde weekdagen van deze of
 * volgende week zetten (zelfde oefeningen, sets en reps). Eerst een overzicht, dan opslaan.
 */
export function RepeatWeekSheet({
  groupId,
  lastWeek,
  existing,
  onClose,
  onDone,
}: {
  groupId: string;
  /** Groepstrainingen van vorige week. */
  lastWeek: GroupWorkout[];
  /** Alle bekende trainingen, om dubbelingen te herkennen. */
  existing: GroupWorkout[];
  onClose: () => void;
  /** Klaar: aantal geplande trainingen, met een melding als een deel niet lukte. */
  onDone: (count: number, partialError?: string) => void;
}) {
  const today = toISODate();
  const prev = useMemo(() => weekRange(-1), []);
  const [offset, setOffset] = useState<0 | 1>(() => {
    // Liggen alle dagen van deze week al achter ons (of staat alles er al), dan volgende week.
    const days = weekRange(0).days;
    return lastWeek.some((w) => days[prev.days.indexOf(w.date)] >= today) ? 0 : 1;
  });
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = weekRange(offset);
  const rows: Row[] = useMemo(() => {
    const taken = new Set(existing.map((w) => `${w.date}|${w.title.trim().toLowerCase()}`));
    return [...lastWeek]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((w) => {
        const t = target.days[prev.days.indexOf(w.date)] ?? target.days[0];
        const blocked =
          w.exerciseCount === 0
            ? "Geen oefeningen"
            : t < today
              ? "Dag is al voorbij"
              : taken.has(`${t}|${w.title.trim().toLowerCase()}`)
                ? "Staat er al"
                : null;
        return { w, target: t, blocked };
      });
  }, [lastWeek, existing, target.days, prev.days, today]);

  const chosen = rows.filter((r) => !r.blocked && !excluded.has(r.w.id));

  function toggle(id: string) {
    setExcluded((prevSet) => {
      const next = new Set(prevSet);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirm() {
    if (!chosen.length) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: loadErr } = await supabase
        .from("workouts")
        .select("id, title, notes, workout_exercises(*)")
        .in(
          "id",
          chosen.map((r) => r.w.id),
        )
        .eq("group_id", groupId);
      if (loadErr) throw loadErr;
      const byId = new Map((data ?? []).map((w) => [w.id as string, w]));
      let saved = 0;
      let failed = 0;
      for (const r of chosen) {
        const src = byId.get(r.w.id);
        if (!src) {
          failed++;
          continue;
        }
        const wex = [...((src.workout_exercises as WorkoutExercise[]) ?? [])].sort((a, b) => a.position - b.position);
        try {
          await saveGroupWorkout(
            groupId,
            null,
            {
              title: src.title as string,
              date: r.target,
              notes: (src.notes as string | null) ?? "",
              items: wex.map((we) =>
                toBuilderItem({ slug: we.exercise_slug, sets: we.target_sets, reps: we.target_reps, notes: we.notes ?? "" }),
              ),
            },
            () => {},
          );
          saved++;
        } catch (err) {
          // Rechten of verbinding: verder proberen heeft geen zin.
          if (saved === 0) throw err;
          failed++;
        }
      }
      if (failed && !saved) throw new Error("De trainingen van vorige week zijn niet meer te vinden.");
      onDone(saved, failed ? `${plural(saved, "training", "trainingen")} gepland, ${failed} niet. Probeer de rest opnieuw.` : undefined);
    } catch (err) {
      setError(friendly(err));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={busy ? () => {} : onClose} title="Vorige week herhalen">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Dezelfde trainingen als vorige week ({formatWeekRange(prev)}), op dezelfde dagen. Oefeningen, sets en reps worden
          overgenomen; aanpassen kan daarna per training.
        </p>

        <div role="radiogroup" aria-label="Naar welke week" className="grid grid-cols-2 gap-1 rounded-2xl border border-line bg-surface p-1">
          {([0, 1] as const).map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={offset === o}
              disabled={busy}
              onClick={() => setOffset(o)}
              className={`min-h-11 rounded-xl px-2 text-[13px] font-semibold transition active:scale-95 ${
                offset === o ? "bg-surface-2 text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {o === 0 ? "Deze week" : "Volgende week"}
              <span className="block text-[11px] font-normal text-muted">{formatWeekRange(weekRange(o))}</span>
            </button>
          ))}
        </div>

        <ul className="space-y-2" aria-label="Trainingen om te plannen">
          {rows.map((r, i) => {
            const on = !r.blocked && !excluded.has(r.w.id);
            return (
              <li key={r.w.id} className="animate-fade-up" style={{ "--i": i } as React.CSSProperties}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-disabled={!!r.blocked}
                  disabled={busy || !!r.blocked}
                  onClick={() => toggle(r.w.id)}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99] disabled:active:scale-100 ${
                    on ? "border-accent/60 bg-accent/10" : "border-line bg-surface-2"
                  } ${r.blocked ? "opacity-60" : ""}`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition ${
                      on ? "border-accent bg-accent text-accent-ink" : "border-line"
                    }`}
                    aria-hidden
                  >
                    {on && <CheckIcon size={12} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{r.w.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {shortDay(r.w.date)} → <span className="font-medium text-ink">{shortDay(r.target)}</span> ·{" "}
                      {plural(r.w.exerciseCount, "oefening", "oefeningen")}
                    </span>
                  </span>
                  {r.blocked && <span className="shrink-0 text-[11px] font-medium text-muted">{r.blocked}</span>}
                </button>
              </li>
            );
          })}
        </ul>

        {error && (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost min-h-11" onClick={onClose} disabled={busy}>
            Annuleren
          </button>
          <button className="btn-primary min-h-11" onClick={confirm} disabled={busy || chosen.length === 0}>
            {busy ? "Plannen…" : chosen.length ? `${plural(chosen.length, "training", "trainingen")} plannen` : "Niets te plannen"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
