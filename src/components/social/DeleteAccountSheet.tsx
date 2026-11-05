"use client";

import { useId, useState } from "react";
import { Sheet } from "../Sheet";
import { errorMessage } from "@/lib/supabase";

/**
 * Account verwijderen: pas mogelijk nadat je je naam hebt overgetypt, zodat het niet per ongeluk
 * gebeurt. `onConfirm` doet het werk (en navigeert weg); een fout verschijnt in het paneel.
 */
export function DeleteAccountSheet({
  open,
  onClose,
  name,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();
  const expected = name.trim();
  const matches = !!expected && typed.trim().toLocaleLowerCase("nl-NL") === expected.toLocaleLowerCase("nl-NL");

  function close() {
    if (busy) return;
    setTyped("");
    setError(null);
    onClose();
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={close} title="Account verwijderen">
      <form className="space-y-4" onSubmit={confirm} noValidate>
        <div className="space-y-2 text-sm text-muted">
          <p>
            Dit verwijdert je account en <span className="font-semibold text-ink">al je gegevens</span>: gelogde sets, ranks,
            lichaamsgewicht, voeding, vriendschappen en meldingen. Dit kan niet ongedaan worden gemaakt.
          </p>
          <p>
            Groepen waar je in zit blijven bestaan voor de anderen; heb je een groep gemaakt, dan neemt een ander lid hem over.
            Download eventueel eerst je gegevens.
          </p>
        </div>
        <div>
          <label htmlFor={inputId} className="label">
            Typ je naam ter bevestiging
          </label>
          <input
            id={inputId}
            className="input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={expected}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={hintId}
            disabled={busy}
          />
          <p id={hintId} className="mt-1 text-xs text-muted">
            Je naam in de app: <span className="font-semibold text-ink">{expected}</span>
          </p>
        </div>
        {error && (
          <p role="alert" className="animate-fade-in rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-ghost" onClick={close} disabled={busy}>
            Annuleren
          </button>
          <button
            type="submit"
            className="btn border border-danger/40 bg-danger/15 text-danger hover:bg-danger/25 disabled:opacity-50"
            disabled={!matches || busy}
            aria-busy={busy}
          >
            {busy ? "Verwijderen…" : "Verwijderen"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
