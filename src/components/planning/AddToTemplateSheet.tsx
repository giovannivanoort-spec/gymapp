"use client";

import Link from "next/link";
import { useState } from "react";
import type { Exercise } from "@/lib/exercise-types";
import { errorMessage, supabase } from "@/lib/supabase";
import { cleanPlan, plural, putTemplateInCache } from "@/lib/templates";
import type { Template } from "@/lib/types";
import { useUserId } from "../AuthProvider";
import { CheckIcon, PlusIcon } from "../Icons";
import { Sheet } from "../Sheet";
import { useTemplateList } from "./useTemplateList";

/** Oefening achteraan een bestaand schema zetten, of een nieuw schema ermee beginnen. */
export function AddToTemplateSheet({
  exercise,
  open,
  onClose,
  onAdded,
}: {
  exercise: Exercise;
  open: boolean;
  onClose: () => void;
  onAdded: (template: Template) => void;
}) {
  const userId = useUserId();
  const { templates: all, error, retry } = useTemplateList(userId, open);
  // Alleen je eigen schema's: een gedeeld schema van je trainer kun je niet aanpassen (kopieer het eerst).
  const templates = all?.filter((t) => t.owner_id === userId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function addTo(t: Template) {
    setBusyId(t.id);
    setFailed(null);
    // Altijd de actuele versie als basis (de lijst kan uit de cache komen of op een ander toestel
    // gewijzigd zijn); anders zou dit die wijzigingen stil overschrijven.
    const fresh = await supabase.from("templates").select("exercises").eq("id", t.id).maybeSingle();
    if (fresh.error || !fresh.data) {
      setBusyId(null);
      return setFailed(fresh.error ? errorMessage(fresh.error) : "Dit schema bestaat niet meer.");
    }
    const current = (fresh.data as Pick<Template, "exercises">).exercises ?? [];
    const exercises = cleanPlan([...current, { slug: exercise.slug, sets: 3, reps: "8-12" }]);
    const { data, error } = await supabase.from("templates").update({ exercises }).eq("id", t.id).select("*").single();
    setBusyId(null);
    if (error || !data) return setFailed(error ? errorMessage(error) : "Schema niet gevonden.");
    putTemplateInCache(userId, data as Template);
    onAdded(data as Template);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Toevoegen aan schema">
      <div className="space-y-3">
        <p className="text-sm text-muted">
          <span className="font-semibold text-ink">{exercise.name}</span> komt achteraan het schema met 3 sets van 8-12 reps.
          Dat kun je daarna aanpassen.
        </p>
        <Link href={`/templates/new?add=${encodeURIComponent(exercise.slug)}`} className="btn-ghost min-h-11 w-full">
          <PlusIcon size={16} /> Nieuw schema met deze oefening
        </Link>
        {failed && (
          <p role="alert" className="text-sm text-danger">
            Toevoegen mislukt: {failed}
          </p>
        )}
        {templates === undefined ? (
          error ? (
            <div className="space-y-2 text-sm">
              <p className="text-danger">Schema&apos;s laden mislukt: {error}</p>
              <button className="btn-ghost min-h-11 w-full" onClick={retry}>
                Opnieuw proberen
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="skeleton h-16" />
              <div className="skeleton h-16" />
            </div>
          )
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted">Je hebt nog geen schema&apos;s.</p>
        ) : (
          <ul className="divide-y divide-line">
            {templates.map((t) => {
              const has = t.exercises.filter((p) => p.slug === exercise.slug).length;
              return (
                <li key={t.id}>
                  <button
                    onClick={() => addTo(t)}
                    disabled={busyId !== null}
                    className="flex min-h-14 w-full items-center gap-3 py-3 text-left transition active:bg-surface-2 disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.name}</span>
                      <span className="text-xs text-muted">
                        {plural(t.exercises.length, "oefening", "oefeningen")}
                        {has > 0 ? ` · staat er al ${has === 1 ? "in" : `${has} keer in`}` : ""}
                      </span>
                    </span>
                    <span
                      className={`flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full px-2 text-xs font-semibold ${
                        has ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted"
                      }`}
                    >
                      {busyId === t.id ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-label="Bezig" />
                    ) : has ? (
                      <CheckIcon size={14} />
                    ) : (
                      <PlusIcon size={16} />
                    )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
