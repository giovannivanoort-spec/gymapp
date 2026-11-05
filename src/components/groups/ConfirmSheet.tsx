"use client";

import { Sheet } from "@/components/Sheet";

/** Bevestiging in app-stijl (in plaats van window.confirm), met bezig- en foutstatus. */
export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  danger = false,
  busy = false,
  confirmDisabled = false,
  error,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  confirmDisabled?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} title={title}>
      <div className="space-y-4">
        {body && <div className="text-sm text-muted">{body}</div>}
        {children}
        {error && (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost min-h-11" onClick={onClose} disabled={busy}>
            Annuleren
          </button>
          <button className={`${danger ? "btn-danger" : "btn-primary"} min-h-11`} onClick={onConfirm} disabled={busy || confirmDisabled}>
            {busy ? "Bezig…" : confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
