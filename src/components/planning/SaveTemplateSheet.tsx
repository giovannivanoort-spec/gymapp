"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/supabase";
import { Sheet } from "../Sheet";

/** De oefeningen van een training bewaren als herbruikbaar schema. */
export function SaveTemplateSheet({
  open,
  onClose,
  defaultName,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  defaultName: string;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(defaultName);
      setError(null);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    onSave(name.trim())
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  }

  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} title="Bewaar als schema">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">Hergebruik deze oefeningen later met &quot;Schema laden&quot;.</p>
        <div>
          <label className="label" htmlFor="template-name">
            Naam schema
          </label>
          <input
            id="template-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoFocus
            enterKeyHint="done"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            Opslaan mislukt: {error}
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" className="btn-ghost min-h-11 flex-1" onClick={onClose} disabled={busy}>
            Annuleren
          </button>
          <button type="submit" className="btn-primary min-h-11 flex-1" disabled={busy || !name.trim()}>
            {busy ? "Opslaan…" : "Opslaan"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
