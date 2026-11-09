import type { ReactNode } from "react";
import { MUSCLE_BY_ID, type MuscleId } from "@/lib/muscles";

type MuscleRole = "primary" | "secondary";

const SWATCH_BG: Record<MuscleRole | "idle", string> = {
  primary: "bg-muscle",
  secondary: "bg-muscle-help",
  idle: "bg-muscle-idle",
};

/**
 * Het gekleurde blokje voor een spier: rood voor een hoofdspier, oranje voor een spier die
 * meehelpt en grijs voor een spier die niet getraind wordt (bg-muscle / bg-muscle-help /
 * bg-muscle-idle, dezelfde tokens als MUSCLE_COLOR). Overal hetzelfde formaat (8px, vierkant met
 * licht afgeronde hoeken): in de chips, de spierlijst en de legenda's van de spierkaart. Vierkant
 * en geen rondje, zodat het niet verward wordt met de ronde regiobolletjes (REGION_COLOR) in de
 * spieranalyse.
 */
export function MuscleSwatch({ role, className = "" }: { role: MuscleRole | "idle"; className?: string }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-[2px] ${SWATCH_BG[role]} ${className}`} aria-hidden />;
}

/**
 * Spierlabel in de kleurtaal van de spierkaart, gebouwd op de gewone `chip` (zelfde vorm en
 * hoogte als bijv. de materiaalchip ernaast, die ook py-0.5 gebruikt):
 * - `primary` (hoofdspier): lichtrode tint met rode rand, rood blokje en lichte tekst (ink).
 * - `secondary` (helpt mee): lichtere oranje tint met oranje rand, oranje blokje en gedempte tekst.
 * De tint is laag gehouden (15% en 10%), zodat de tekst goed leesbaar blijft (ink op de rode tint
 * minstens 11:1, gedempte tekst op de oranje tint minstens 5:1, op surface en surface-2) en een rij
 * chips niet als foutmelding leest. Het blokje maakt rood en oranje ook bij lage tint duidelijk.
 * `swatch={false}` laat het blokje weg: voor labels die geen hoofdspier/helpt-mee aangeven maar
 * belasting (de zwaarst getrainde spiergroepen van een schema, de rode plekken op de heatmap), zodat
 * het blokje uit de legenda "Hoofdspier" daar niet iets anders betekent.
 */
export function MuscleTag({
  role = "primary",
  swatch = true,
  title,
  children,
}: {
  role?: MuscleRole;
  swatch?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`chip gap-1.5 py-0.5 ${swatch ? "pl-2" : ""} ${
        role === "primary" ? "border-muscle/35 bg-muscle/15 font-medium text-ink" : "border-muscle-help/25 bg-muscle-help/10"
      }`}
    >
      {swatch && <MuscleSwatch role={role} />}
      {children}
      {role === "secondary" && <span className="sr-only"> (helpt mee)</span>}
    </span>
  );
}

/** Spieren als chips: eerst de hoofdspieren (rood), dan de spieren die meehelpen (oranje). */
export function MuscleChips({
  primary,
  secondary = [],
  limit,
}: {
  primary: MuscleId[];
  secondary?: MuscleId[];
  /** Maximaal aantal chips; de rest wordt als "+n" getoond. */
  limit?: number;
}) {
  const all = [...primary.map((m) => ({ m, main: true })), ...secondary.map((m) => ({ m, main: false }))];
  const shown = limit ? all.slice(0, limit) : all;
  const rest = all.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map(({ m, main }) => (
        <MuscleTag key={m} role={main ? "primary" : "secondary"} title={MUSCLE_BY_ID[m].name}>
          {MUSCLE_BY_ID[m].short}
        </MuscleTag>
      ))}
      {rest > 0 && (
        <span className="px-1 py-0.5 text-xs text-muted">
          <span aria-hidden>+{rest}</span>
          <span className="sr-only">en nog {rest === 1 ? "1 spier" : `${rest} spieren`}</span>
        </span>
      )}
    </div>
  );
}
