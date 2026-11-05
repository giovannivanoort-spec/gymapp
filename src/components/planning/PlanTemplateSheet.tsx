"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toISODate } from "@/lib/dates";
import { planTemplateHref, plural, totalSets } from "@/lib/templates";
import type { Template } from "@/lib/types";
import { useUserId } from "../AuthProvider";
import { ChevronRightIcon } from "../Icons";
import { Sheet } from "../Sheet";
import { useMyGroupsState } from "./sharing";

/** Kies groep en datum en ga naar het plannen met dit schema al ingeladen. */
export function PlanTemplateSheet({ template, onClose }: { template: Template | null; onClose: () => void }) {
  const userId = useUserId();
  const router = useRouter();
  const { trainerGroups: trainer, error, refreshing, retry } = useMyGroupsState(userId);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [date, setDate] = useState(() => toISODate());
  const selected = groupId && trainer?.some((g) => g.id === groupId) ? groupId : (trainer?.[0]?.id ?? null);

  function go() {
    if (!template || !selected || !date) return;
    onClose();
    router.push(planTemplateHref(selected, date, template.id));
  }

  return (
    <Sheet open={!!template} onClose={onClose} title="Plan deze training">
      {template && (
        <div className="space-y-4">
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="font-semibold">{template.name}</p>
            <p className="text-xs text-muted">
              {plural(template.exercises.length, "oefening", "oefeningen")} · {plural(totalSets(template.exercises), "set", "sets")}
            </p>
          </div>

          {trainer === undefined && error ? (
            <div className="space-y-3 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm" role="alert">
              <p>
                <span className="font-semibold">Groepen laden mislukt.</span> <span className="text-muted">{error}</span>
              </p>
              <button className="btn-ghost min-h-11 w-full" onClick={retry} disabled={refreshing}>
                {refreshing ? "Bezig…" : "Opnieuw proberen"}
              </button>
            </div>
          ) : trainer === undefined ? (
            <div className="space-y-2" aria-busy aria-label="Groepen laden">
              <div className="skeleton h-14" />
              <div className="skeleton h-14" />
            </div>
          ) : trainer.length === 0 ? (
            <p className="text-sm text-muted">
              Alleen trainers van een groep plannen trainingen. Maak een eigen groep aan met de plusknop onderin, of vraag je
              trainer om dit schema te gebruiken.
            </p>
          ) : (
            <>
              <fieldset className="space-y-2">
                <legend className="label">Groep</legend>
                {trainer.map((g) => (
                  <label
                    key={g.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${
                      selected === g.id ? "border-accent bg-accent/5" : "border-line hover:border-muted"
                    }`}
                  >
                    <input
                      type="radio"
                      name="plan-group"
                      className="sr-only"
                      checked={selected === g.id}
                      onChange={() => setGroupId(g.id)}
                    />
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 font-bold text-accent">
                      {g.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{g.name}</span>
                      <span className="text-xs text-muted">
                        {g.memberCount} {g.memberCount === 1 ? "lid" : "leden"}
                      </span>
                    </span>
                    <span
                      className={`h-5 w-5 shrink-0 rounded-full border-2 ${selected === g.id ? "border-accent bg-accent shadow-[inset_0_0_0_3px_var(--color-surface)]" : "border-line"}`}
                      aria-hidden
                    />
                  </label>
                ))}
              </fieldset>
              <div>
                <label className="label" htmlFor="plan-date">
                  Datum
                </label>
                <input id="plan-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <button className="btn-primary min-h-11 w-full" disabled={!selected || !date} onClick={go}>
                Verder naar plannen <ChevronRightIcon size={16} />
              </button>
              <p className="text-center text-xs text-muted">Je kunt alles nog aanpassen voordat je opslaat.</p>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
