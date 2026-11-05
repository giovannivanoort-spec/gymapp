"use client";

import { Sheet } from "../Sheet";

/** Bevestiging in de stijl van de app (in plaats van window.confirm). */
export function ConfirmSheet({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Annuleren",
  danger,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} title={title}>
      <div className="space-y-4">
        <div className="space-y-2 text-sm text-muted">{children}</div>
        {error && (
          <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button className="btn-ghost min-h-11 flex-1" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button className={`${danger ? "btn-danger" : "btn-primary"} min-h-11 flex-1`} onClick={onConfirm} disabled={busy}>
            {busy ? "Bezig…" : confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
