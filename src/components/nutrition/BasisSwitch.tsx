"use client";

import { fmt } from "@/lib/nutrition/format";
import { KCAL_WARN_RATIO, kcalRatio, type Basis } from "@/lib/nutrition/basisMatch";

/**
 * Schakelaar "Basiswaarden" onder een geschat onderdeel: de waarden per 100 g van een basisproduct
 * gebruiken in plaats van de schatting. Eén korte regel; de schakelaar zelf is 24 px hoog en het
 * tikvlak (before) loopt alleen omlaag door, 20 px in de onderruimte van het eigen onderdeel
 * (`BASIS_ROW_PADDING`): samen 44 px, zonder over de knoppen en het grammenveld erboven te vallen.
 */
export function BasisSwitch({
  basis,
  on,
  estimatedKcal,
  disabled,
  onToggle,
}: {
  basis: Basis;
  /** Staan de basiswaarden aan? */
  on: boolean;
  /** De eigen schatting per 100 g, ook als de basiswaarden aan staan. */
  estimatedKcal: number;
  disabled?: boolean;
  onToggle: () => void;
}) {
  // Groot verschil (anderhalf keer of meer) tussen schatting en basisproduct: valt zo meteen op.
  const jump = kcalRatio(basis.per100.kcal, estimatedKcal) >= KCAL_WARN_RATIO;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Basiswaarden ${fmt(basis.per100.kcal)} kcal per 100 g (schatting ${fmt(estimatedKcal)}), van basisproduct ${basis.name}`}
      disabled={disabled}
      onClick={onToggle}
      title={basis.name}
      className="relative ml-2 flex h-6 max-w-full items-center gap-2 rounded-md px-1 text-[11px] text-muted transition before:absolute before:-inset-x-1 before:top-0 before:-bottom-5 before:content-[''] hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
    >
      <span aria-hidden className={`relative h-4 w-7 shrink-0 rounded-full transition-colors duration-200 ${on ? "bg-accent" : "bg-surface-2 ring-1 ring-line"}`}>
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full transition-all duration-200 motion-reduce:transition-none ${on ? "left-3.5 bg-accent-ink" : "left-0.5 bg-muted"}`}
        />
      </span>
      <span className="truncate whitespace-nowrap">
        Basiswaarden <span className={`tabular-nums ${jump ? "font-semibold text-warn" : "text-ink"}`}>{fmt(basis.per100.kcal)}</span> kcal/100 g
        <span className="tabular-nums"> (schatting {fmt(estimatedKcal)})</span>
      </span>
    </button>
  );
}

/** Onderruimte van een onderdeel met schakelaar: precies het tikvlak onder de schakelaar (before:-bottom-5). */
export const BASIS_ROW_PADDING = "pb-5";
