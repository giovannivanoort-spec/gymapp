"use client";

import { useEffect } from "react";
import { Portal } from "./Portal";

/** Onderaan uitschuivend paneel (mobiel), gecentreerd op grotere schermen. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal>
        <div className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
        <div className="animate-sheet-up relative flex max-h-[88dvh] w-full max-w-2xl flex-col rounded-t-3xl border border-line bg-surface shadow-2xl sm:animate-scale-in sm:rounded-3xl">
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line sm:hidden" />
          <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <button onClick={onClose} className="rounded-lg p-1 text-muted hover:text-ink" aria-label="Sluiten">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {/* min-h-0: zonder dit kan het scrollgebied niet krimpen en valt de onderkant buiten beeld. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))]">
            {children}
          </div>
        </div>
      </div>
    </Portal>
  );
}
