"use client";

import { useState } from "react";
import { fmt } from "@/lib/nutrition/format";
import { saveMeal, type FoodLog } from "@/lib/nutrition/log";
import { sumMacros } from "@/lib/nutrition/types";
import { errorMessage } from "@/lib/supabase";
import { Sheet } from "../Sheet";

/** Items van een maaltijd bewaren als vaste maaltijd (bijv. "Mijn ontbijt"), om later in één tik toe te voegen. */
export function SaveMealSheet({
  items,
  defaultName,
  onClose,
  onSaved,
}: {
  items: FoodLog[];
  defaultName: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = sumMacros(items);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveMeal(n, items);
      onSaved(n);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Bewaren als maaltijd">
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="label" htmlFor="sm-name">
            Naam
          </label>
          <input
            id="sm-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()}
            maxLength={60}
            placeholder="bijv. Mijn vaste ontbijt"
            autoFocus
            required
          />
        </div>
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {items.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">{l.name}</span>
              <span className="shrink-0 text-xs text-muted tabular-nums">
                {fmt(l.grams, 1)} g · {fmt(l.kcal)} kcal
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">
          Totaal {fmt(t.kcal)} kcal · E {fmt(t.protein)} g. Je vindt hem daarna bij Toevoegen onder Mijn maaltijden.
        </p>
        {error && (
          <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <button className="btn-primary w-full py-3" disabled={busy || !name.trim()}>
          {busy ? "Opslaan…" : "Opslaan"}
        </button>
      </form>
    </Sheet>
  );
}
