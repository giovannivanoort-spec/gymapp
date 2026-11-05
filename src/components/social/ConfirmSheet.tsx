"use client";

import { useState } from "react";
import { Sheet } from "../Sheet";
import { errorMessage } from "@/lib/supabase";

/**
 * Bevestigingspaneel in app-stijl (in plaats van window.confirm). De actie mag async zijn: de knop
 * toont dan een bezig-status en een fout verschijnt in het paneel zelf.
 */
export function ConfirmSheet({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  busyLabel = "Bezig…",
  danger = false,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  danger?: boolean;
  /** Sluit het paneel niet zelf; dat doet de aanroeper (of hij navigeert weg). */
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (busy) return;
    setError(null);
    onClose();
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={close} title={title}>
      <div className="space-y-4">
        <div className="text-sm text-muted">{body}</div>
        {error && (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-ghost" onClick={close} disabled={busy}>
            Annuleren
          </button>
          <button
            type="button"
            className={danger ? "btn border border-danger/40 bg-danger/15 text-danger hover:bg-danger/25" : "btn-primary"}
            onClick={confirm}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
