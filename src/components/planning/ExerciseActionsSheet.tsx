"use client";

import { Sheet } from "../Sheet";

export type ExerciseAction = {
  id: string;
  label: string;
  icon: React.ReactNode;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
};

/** Actiemenu van één oefening in de builder (in plaats van een rij knoppen op elke kaart). */
export function ExerciseActionsSheet({
  title,
  open,
  onClose,
  actions,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  actions: ExerciseAction[];
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <ul className="-mx-2 -mt-1 space-y-0.5" role="menu" aria-label={`Opties voor ${title}`}>
        {actions.map((a) => (
          <li key={a.id} role="none">
            <button
              role="menuitem"
              onClick={() => {
                onClose();
                a.run();
              }}
              disabled={a.disabled}
              className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium transition active:scale-[0.99] disabled:opacity-35 ${
                a.danger ? "text-danger hover:bg-danger/10" : "text-ink hover:bg-surface-2"
              }`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center ${a.danger ? "text-danger" : "text-muted"}`} aria-hidden>
                {a.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block">{a.label}</span>
                {a.hint && <span className="block text-xs font-normal text-muted">{a.hint}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

const svg = (d: string) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

export const ActionIcons = {
  info: svg("M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 7.5v.01"),
  swap: svg("M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"),
  note: svg("M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16v4zM13.5 6.5l4 4"),
  copy: svg("M9 9h11v11H9zM5 15H4V4h11v1"),
  top: svg("M5 4h14M12 20V9M7 13l5-5 5 5"),
  bottom: svg("M5 20h14M12 4v11M7 11l5 5 5-5"),
  trash: svg("M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"),
};
