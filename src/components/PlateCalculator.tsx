"use client";

import { useState } from "react";
import type { Equipment } from "@/lib/exercise-types";
import { Sheet } from "./Sheet";

/** Schijven in kg met de gangbare (IWF) kleuren. */
const PLATES = [
  { kg: 25, color: "#d64045", h: 96 },
  { kg: 20, color: "#2f6fdb", h: 96 },
  { kg: 15, color: "#e7b416", h: 86 },
  { kg: 10, color: "#2e9e5b", h: 74 },
  { kg: 5, color: "#e8ebef", h: 58 },
  { kg: 2.5, color: "#d64045", h: 46 },
  { kg: 1.25, color: "#aab2bd", h: 38 },
  { kg: 0.5, color: "#c9ced6", h: 32 },
];

const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
const PLATES_KEY = "gymapp-plates";
const BAR_KEY = "gymapp-plates-bar";

const BARS = [
  { kg: 20, label: "Olympische stang (20 kg)" },
  { kg: 15, label: "Damesstang (15 kg)" },
  { kg: 10, label: "EZ-bar (±10 kg)" },
  { kg: 0, label: "Zonder stang (machine)" },
];

const nl = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 2, useGrouping: false });

/** Rekeneenheid: alle schijven zijn veelvouden van 0,25 kg. */
const UNIT = 0.25;
/** Meer dan 250 kg per kant komt in de praktijk niet voor; daarboven rekenen we niet verder. */
const MAX_SIDE_UNITS = 1000;

/**
 * Welke schijven per kant nodig zijn voor een totaalgewicht. Zoekt eerst de combinatie die het
 * dichtst bij het doel komt (zonder eroverheen te gaan) en daarbinnen de minste schijven, met de
 * zwaarste schijven eerst. Werkt dus ook als je schijven hebt uitgezet: met alleen 20 en 15 kg
 * wordt 30 kg per kant 15 + 15 in plaats van 20 met 10 kg tekort.
 */
export function platesPerSide(total: number, bar: number, available = PLATES.map((p) => p.kg)) {
  const sideKg = Math.max(0, (total - bar) / 2);
  const target = Math.min(MAX_SIDE_UNITS, Math.floor(sideKg / UNIT + 1e-9));
  const sizes = [...new Set(available)]
    .map((kg) => Math.round(kg / UNIT))
    .filter((u) => u > 0)
    .sort((a, b) => b - a);
  // count[s] = minste aantal schijven voor precies s eenheden (Infinity = niet te maken).
  const count = new Array<number>(target + 1).fill(Infinity);
  count[0] = 0;
  for (let s = 1; s <= target; s++) {
    for (const u of sizes) if (u <= s && count[s - u] + 1 < count[s]) count[s] = count[s - u] + 1;
  }
  let reach = target;
  while (reach > 0 && !Number.isFinite(count[reach])) reach--;
  const out: number[] = [];
  for (let s = reach; s > 0; ) {
    // Bij gelijk aantal schijven de zwaarste eerst (zo laad je een stang ook).
    const u = sizes.find((x) => x <= s && count[s - x] === count[s] - 1)!;
    out.push(u * UNIT);
    s -= u;
  }
  out.sort((a, b) => b - a);
  const remainder = Math.round((sideKg - reach * UNIT) * 2 * 100) / 100;
  return { plates: out, remainder: Math.max(0, remainder) };
}

/** Welke schijven in jouw sportschool liggen (per toestel in deze browser bewaard). */
function loadPlates(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PLATES_KEY) ?? "null");
    if (Array.isArray(raw) && raw.every((n) => typeof n === "number")) return raw;
  } catch {
    // geen opslag: standaardset
  }
  return DEFAULT_PLATES;
}

/** Gekozen stang per soort toestel (barbell, EZ-bar), zodat je hem niet elke keer opnieuw kiest. */
function loadBar(equipment: Equipment | undefined): number {
  const fallback = equipment === "ez_bar" ? 10 : 20;
  try {
    const raw = JSON.parse(localStorage.getItem(BAR_KEY) ?? "{}") as Record<string, unknown>;
    const kg = raw[equipment ?? "barbell"];
    return typeof kg === "number" && BARS.some((b) => b.kg === kg) ? kg : fallback;
  } catch {
    return fallback;
  }
}

function saveBar(equipment: Equipment | undefined, kg: number) {
  try {
    const raw = JSON.parse(localStorage.getItem(BAR_KEY) ?? "{}") as Record<string, unknown>;
    localStorage.setItem(BAR_KEY, JSON.stringify({ ...raw, [equipment ?? "barbell"]: kg }));
  } catch {
    // niet bewaren is geen probleem
  }
}

function savePlates(kgs: number[]) {
  try {
    localStorage.setItem(PLATES_KEY, JSON.stringify(kgs));
  } catch {
    // niet bewaren is geen probleem
  }
}

export function PlateCalculator({
  open,
  onClose,
  initial,
  equipment,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  initial: number | null;
  /** Bepaalt de standaardstang (EZ-bar = 10 kg). */
  equipment?: Equipment;
  /** Gebruikt het berekende gewicht voor de volgende set. */
  onUse?: (kg: number) => void;
}) {
  const [weight, setWeight] = useState(initial ? nl(initial) : "");
  const [bar, setBar] = useState(() => loadBar(equipment));
  const [available, setAvailable] = useState<number[]>(loadPlates);
  const [showPlates, setShowPlates] = useState(false);
  const total = Number(weight.replace(",", "."));
  const valid = total > 0 && total >= bar;
  const { plates, remainder } = valid ? platesPerSide(total, bar, available) : { plates: [], remainder: 0 };
  const loaded = bar + plates.reduce((a, b) => a + b, 0) * 2;

  function togglePlate(kg: number) {
    const next = available.includes(kg) ? available.filter((k) => k !== kg) : [...available, kg].sort((a, b) => b - a);
    setAvailable(next);
    savePlates(next);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Schijvencalculator">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="pc-weight">
              Totaalgewicht (kg)
            </label>
            <input
              id="pc-weight"
              className="input text-lg font-bold tabular-nums"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="bijv. 100"
              // Alleen het toetsenbord openen als er nog niets is ingevuld; anders bedekt het de tekening.
              autoFocus={!initial}
            />
          </div>
          <div>
            <label className="label" htmlFor="pc-bar">
              Stang
            </label>
            <select
              id="pc-bar"
              className="input"
              value={bar}
              onChange={(e) => {
                const kg = Number(e.target.value);
                setBar(kg);
                saveBar(equipment, kg);
              }}
            >
              {BARS.map((b) => (
                <option key={b.kg} value={b.kg}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!valid ? (
          <p className="text-sm text-muted">
            {total > 0 && total < bar ? `Lichter dan de stang (${bar} kg).` : "Vul het totaalgewicht in, inclusief de stang."}
          </p>
        ) : (
          <>
            {/* Tekening: stang met schijven aan één kant */}
            <div className="flex h-28 items-center overflow-hidden rounded-xl bg-surface-2 px-3" aria-hidden>
              <div className="h-3 w-8 shrink-0 rounded-l bg-[#8a929c]" />
              <div className="h-6 w-2 shrink-0 bg-[#6b7380]" />
              {plates.map((kg, i) => {
                const p = PLATES.find((x) => x.kg === kg)!;
                return (
                  <div
                    key={`${kg}-${i}`}
                    className="animate-scale-in mx-px flex shrink-0 items-center justify-center rounded-sm text-[9px] font-bold"
                    style={
                      {
                        height: p.h,
                        width: kg >= 10 ? 16 : 11,
                        background: p.color,
                        color: kg === 5 || kg === 15 || kg === 0.5 ? "#12160a" : "#fff",
                        animationDelay: `${i * 40}ms`,
                      } as React.CSSProperties
                    }
                  >
                    <span className="-rotate-90 whitespace-nowrap">{nl(kg)}</span>
                  </div>
                );
              })}
              <div className="h-3 flex-1 rounded-r bg-[#8a929c]" />
            </div>

            <div className="space-y-1" aria-live="polite">
              <p className="text-sm">
                <span className="text-muted">Per kant:</span>{" "}
                <span className="font-semibold">{plates.length ? plates.map(nl).join(" + ") + " kg" : "geen schijven"}</span>
              </p>
              <p className="text-xs text-muted">
                {bar > 0 ? `Stang ${bar} kg + ` : ""}2 × {nl(plates.reduce((a, b) => a + b, 0))} kg = {nl(loaded)} kg
                {remainder > 0 && <span className="text-warn"> · {nl(remainder)} kg kan niet exact met deze schijven</span>}
              </p>
            </div>

            {onUse && (
              <button
                className="btn-primary w-full"
                onClick={() => {
                  onUse(loaded);
                  onClose();
                }}
              >
                {nl(loaded)} kg gebruiken voor de volgende sets
              </button>
            )}
          </>
        )}

        <div className="border-t border-line pt-3">
          <button
            className="-my-2 min-h-11 text-sm text-muted hover:text-ink"
            onClick={() => setShowPlates((v) => !v)}
            aria-expanded={showPlates}
          >
            Beschikbare schijven ({available.length}) {showPlates ? "verbergen" : "aanpassen"}
          </button>
          {showPlates && (
            <div className="animate-fade-in mt-3 flex flex-wrap gap-2">
              {PLATES.map((p) => {
                const on = available.includes(p.kg);
                return (
                  <button
                    key={p.kg}
                    onClick={() => togglePlate(p.kg)}
                    aria-pressed={on}
                    className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition active:scale-95 ${
                      on ? "border-accent/60 bg-accent/10 text-ink" : "border-line text-muted line-through"
                    }`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} aria-hidden />
                    {nl(p.kg)} kg
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
