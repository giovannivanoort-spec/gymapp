"use client";

import { useId, useState } from "react";
import { CheckIcon, TurnsIcon } from "@/components/Icons";
import { Sheet } from "@/components/Sheet";
import { toast } from "@/components/ui/Toast";

type Person = { uid: string; name: string };

/**
 * Schakelaar "Om de beurt" in de personenbalk: één tik zet het aan of uit (aria-pressed). Alleen een
 * pictogram, zodat de personen ernaast hun ruimte houden; aan is ook zonder kleur te zien aan het
 * vinkje in de hoek. Bij aanzetten legt een melding uit wat het doet, met "Wie doet mee" om mensen
 * die vandaag niet trainen over te slaan.
 */
export function TurnsControl({
  on,
  people,
  takesPart,
  onToggle,
  onTakePart,
}: {
  on: boolean;
  /** Leden die je mag invullen, in de volgorde van de groep. */
  people: Person[];
  takesPart: (uid: string) => boolean;
  onToggle: (on: boolean) => void;
  onTakePart: (uid: string, part: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const peopleId = useId();
  const joined = people.filter((p) => takesPart(p.uid)).length;

  function toggle() {
    const next = !on;
    onToggle(next);
    if (next) {
      toast("Om de beurt staat aan. Na het afvinken ga je door naar de volgende persoon.", {
        action: { label: "Wie doet mee", run: () => setOpen(true) },
      });
    } else {
      toast("Om de beurt staat uit");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={on}
        title={on ? "Om de beurt staat aan, tik om uit te zetten" : "Om de beurt: na het afvinken door naar de volgende persoon"}
        className={`relative flex min-h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition active:scale-[0.97] ${
          on ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface-2 text-muted hover:text-ink"
        }`}
      >
        <TurnsIcon size={20} />
        <span className="sr-only">Om de beurt</span>
        {on && (
          <span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent text-accent-ink" aria-hidden>
            <CheckIcon size={9} strokeWidth={3.5} />
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Wie doet mee">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Na elke afgevinkte set ga je door naar de volgende persoon die bij dezelfde oefening nog een set open heeft. Alleen als je het
            vinkje aantikt; met Klaar op het toetsenbord blijf je bij dezelfde persoon.
          </p>
          <div className="space-y-2" role="group" aria-labelledby={peopleId}>
            <h3 className="label" id={peopleId}>
              Doet vandaag mee
            </h3>
            {people.map((p) => {
              const part = takesPart(p.uid);
              return (
                <button
                  key={p.uid}
                  type="button"
                  role="checkbox"
                  aria-checked={part}
                  onClick={() => onTakePart(p.uid, !part)}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                    part ? "border-accent/40 bg-accent/5" : "border-line hover:border-muted"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm font-medium ${part ? "" : "text-muted"}`}>{p.name}</span>
                    <span className="block text-xs text-muted">{part ? "Doet mee" : "Wordt overgeslagen"}</span>
                  </span>
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
                      part ? "border-accent bg-accent text-accent-ink" : "border-line"
                    }`}
                    aria-hidden
                  >
                    {part && <CheckIcon size={14} strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted">Wie je overslaat, doet weer mee zodra je voor diegene een set afvinkt.</p>
          {joined < 2 && (
            <p className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn" role="status">
              Kies minstens twee personen, anders is er niemand om naar door te gaan.
            </p>
          )}
          <button type="button" className="btn-primary w-full" onClick={() => setOpen(false)}>
            Klaar
          </button>
        </div>
      </Sheet>
    </>
  );
}
