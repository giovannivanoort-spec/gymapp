"use client";

import { CloseIcon } from "@/components/Icons";

export type JumpCheckItem = {
  id: number;
  /** Bijv. "140 kg × 5 bij Bankdrukken (Sam)". */
  set: string;
  onConfirm: () => void;
  onFix: () => void;
};

/**
 * Controlevraag bij een onwaarschijnlijke sprong (waarschijnlijk een typfout). Staat in de vaste
 * balk bovenin de training, zodat hij niet wordt weggedrukt door andere meldingen en altijd in
 * beeld is, waar je ook scrolt. Pas na "Klopt" wordt het record gevierd en gedeeld.
 */
export function JumpCheck({ items, onDone }: { items: JumpCheckItem[]; onDone: (id: number) => void }) {
  const item = items[0];
  if (!item) return null;
  const more = items.length - 1;
  return (
    <div
      key={item.id}
      role="alert"
      className="animate-fade-in mt-2 rounded-xl border border-warn/50 bg-surface/95 p-3 shadow-lg shadow-black/30"
    >
      <div className="flex items-start gap-2">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">Flinke sprong, klopt dit?</span>{" "}
          <span className="text-muted">{item.set}</span>
          {more > 0 && <span className="ml-1.5 whitespace-nowrap text-xs text-muted">+{more}</span>}
        </p>
        <button
          type="button"
          className="-m-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:text-ink"
          onClick={() => onDone(item.id)}
          aria-label="Vraag sluiten zonder te vieren"
        >
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          className="min-h-10 rounded-xl px-3 text-sm font-medium text-muted transition hover:text-ink active:scale-95"
          onClick={() => {
            item.onFix();
            onDone(item.id);
          }}
        >
          Typfout, aanpassen
        </button>
        <button
          type="button"
          className="min-h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink transition active:scale-95"
          onClick={() => {
            item.onConfirm();
            onDone(item.id);
          }}
        >
          Klopt
        </button>
      </div>
    </div>
  );
}
