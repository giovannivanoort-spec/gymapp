"use client";

import Link from "next/link";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { estimateMinutes, plural, totalSets } from "@/lib/templates";
import type { Template } from "@/lib/types";
import { Sheet } from "../Sheet";

const exName = (slug: string) => EXERCISE_BY_SLUG[slug]?.name ?? slug;

/** Een schema kiezen om de training mee te vullen (vervangen of toevoegen). */
export function TemplatePicker({
  open,
  onClose,
  templates,
  error,
  onRetry,
  hasItems,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  templates: Template[] | undefined;
  error: string | null;
  onRetry: () => void;
  hasItems: boolean;
  onPick: (t: Template, replace: boolean) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Schema laden">
      {templates === undefined ? (
        error ? (
          <div className="space-y-3 text-sm" role="alert">
            <p className="text-danger">Schema&apos;s laden mislukt: {error}</p>
            <button className="btn-ghost min-h-11 w-full" onClick={onRetry}>
              Opnieuw proberen
            </button>
          </div>
        ) : (
          <div className="space-y-2" aria-busy>
            <div className="skeleton h-28" />
            <div className="skeleton h-28" />
          </div>
        )
      ) : templates.length === 0 ? (
        <div className="space-y-3 text-sm text-muted">
          <p>Je hebt nog geen schema&apos;s. Bewaar deze training als schema, of maak er een op het tabblad Schema&apos;s.</p>
          <Link href="/templates/new" className="btn-ghost min-h-11 w-full">
            Nieuw schema maken
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {error && (
            <li className="flex items-center justify-between gap-2 text-xs text-danger">
              <span>Verversen mislukt, je ziet de laatst bekende schema&apos;s.</span>
              <button onClick={onRetry} className="min-h-11 shrink-0 px-3 font-semibold underline">
                Opnieuw
              </button>
            </li>
          )}
          {templates.map((t, i) => (
            <li key={t.id} className="animate-fade-up rounded-xl border border-line p-3" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate font-semibold">{t.name}</p>
                <span className="shrink-0 text-xs text-muted">ca. {estimateMinutes(t.exercises)} min</span>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {plural(t.exercises.length, "oefening", "oefeningen")} · {plural(totalSets(t.exercises), "set", "sets")}
              </p>
              <p className="mb-3 mt-1 line-clamp-2 text-xs text-muted">{t.exercises.map((p) => exName(p.slug)).join(" · ")}</p>
              <div className="flex gap-2">
                <button
                  className="btn-primary min-h-11 flex-1 px-3 text-xs"
                  onClick={() => onPick(t, true)}
                  disabled={t.exercises.length === 0}
                >
                  {hasItems ? "Vervang huidige" : "Gebruiken"}
                </button>
                {hasItems && (
                  <button
                    className="btn-ghost min-h-11 flex-1 px-3 text-xs"
                    onClick={() => onPick(t, false)}
                    disabled={t.exercises.length === 0}
                  >
                    Toevoegen
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
