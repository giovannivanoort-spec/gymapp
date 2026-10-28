"use client";

import { useState } from "react";
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
];

const BARS = [
  { kg: 20, label: "Olympische stang (20 kg)" },
  { kg: 15, label: "Damesstang (15 kg)" },
  { kg: 10, label: "EZ-bar (±10 kg)" },
  { kg: 0, label: "Zonder stang (machine)" },
];

const nl = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 2 });

/** Welke schijven per kant nodig zijn voor een totaalgewicht. */
export function platesPerSide(total: number, bar: number, available = PLATES.map((p) => p.kg)) {
  let side = Math.max(0, (total - bar) / 2);
  const out: number[] = [];
  for (const kg of available) {
    while (side >= kg - 1e-9) {
      out.push(kg);
      side -= kg;
    }
  }
  return { plates: out, remainder: Math.round(side * 2 * 100) / 100 };
}

export function PlateCalculator({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: number | null }) {
  const [weight, setWeight] = useState(initial ? String(initial) : "");
  const [bar, setBar] = useState(20);
  const total = Number(weight.replace(",", "."));
  const valid = total > 0 && total >= bar;
  const { plates, remainder } = valid ? platesPerSide(total, bar) : { plates: [], remainder: 0 };

  return (
    <Sheet open={open} onClose={onClose} title="Schijvencalculator">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="pc-weight">Totaalgewicht (kg)</label>
            <input
              id="pc-weight"
              className="input text-lg font-bold tabular-nums"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="bijv. 100"
              autoFocus
            />
          </div>
          <div>
            <label className="label" htmlFor="pc-bar">Stang</label>
            <select id="pc-bar" className="input" value={bar} onChange={(e) => setBar(Number(e.target.value))}>
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
            <div className="flex h-28 items-center rounded-xl bg-surface-2 px-3">
              <div className="h-3 w-8 rounded-l bg-[#8a929c]" />
              <div className="h-6 w-2 bg-[#6b7380]" />
              {plates.map((kg, i) => {
                const p = PLATES.find((x) => x.kg === kg)!;
                return (
                  <div
                    key={i}
                    className="animate-scale-in mx-px flex items-center justify-center rounded-sm text-[9px] font-bold"
                    style={{
                      height: p.h,
                      width: kg >= 10 ? 16 : 11,
                      background: p.color,
                      color: kg === 5 || kg === 15 ? "#12160a" : "#fff",
                      "--i": i,
                      animationDelay: `${i * 40}ms`,
                    } as React.CSSProperties}
                  >
                    <span className="-rotate-90 whitespace-nowrap">{nl(kg)}</span>
                  </div>
                );
              })}
              <div className="h-3 flex-1 rounded-r bg-[#8a929c]" />
            </div>

            <div className="space-y-1">
              <p className="text-sm">
                <span className="text-muted">Per kant:</span>{" "}
                <span className="font-semibold">{plates.length ? plates.map(nl).join(" + ") + " kg" : "geen schijven"}</span>
              </p>
              <p className="text-xs text-muted">
                {bar > 0 ? `Stang ${bar} kg + ` : ""}2 × {nl(plates.reduce((a, b) => a + b, 0))} kg ={" "}
                {nl(bar + plates.reduce((a, b) => a + b, 0) * 2)} kg
                {remainder > 0 && <span className="text-warn"> · {nl(remainder)} kg kan niet exact met deze schijven</span>}
              </p>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
