"use client";

import { useRef, useState } from "react";
import { addLog, resizeImage } from "@/lib/nutrition/log";
import { macrosFor, sumMacros, type Food, type Meal } from "@/lib/nutrition/types";
import { supabase } from "@/lib/supabase";
import { CloseIcon, SparkleIcon } from "../Icons";

type Item = {
  name: string;
  grams: number;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  confidence: "hoog" | "middel" | "laag";
};

const nl = (n: number, d = 0) => n.toLocaleString("nl-NL", { maximumFractionDigits: d });

function toFood(it: Item): Food {
  const slug = it.name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    id: `ai:${slug}`,
    source: "ai",
    name: it.name,
    per100: {
      kcal: Math.round(it.kcal_per_100g),
      protein: Math.round(it.protein_per_100g * 10) / 10,
      carbs: Math.round(it.carbs_per_100g * 10) / 10,
      fat: Math.round(it.fat_per_100g * 10) / 10,
    },
    portions: [],
  };
}

/** Foto van je maaltijd → schatting per onderdeel (aanpasbaar) → toevoegen aan het dagboek. */
export function PhotoEstimate({ meal, date, onDone }: { meal: Meal; date: string; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ description: string; notes: string; items: (Item & { grams: number })[] } | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      setImage(await resizeImage(file));
    } catch {
      setError("Deze foto kon niet worden gelezen.");
    }
  }

  async function estimate() {
    if (!image) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch("/api/nutrition/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
        body: JSON.stringify({ image, hint }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Schatten mislukt.");
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Schatten mislukt.");
    } finally {
      setBusy(false);
    }
  }

  async function addAll() {
    if (!result) return;
    setBusy(true);
    try {
      for (const it of result.items.filter((i) => i.grams > 0)) await addLog(toFood(it), it.grams, meal, date, "Foto-schatting");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toevoegen mislukt.");
      setBusy(false);
    }
  }

  const totals = result ? sumMacros(result.items.map((it) => macrosFor(toFood(it).per100, it.grams))) : null;

  return (
    <div className="space-y-4">
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

      {image ? (
        <div className="relative overflow-hidden rounded-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element -- lokale data-URL, geen optimalisatie nodig */}
          <img src={image} alt="Foto van je maaltijd" className="max-h-64 w-full object-cover" />
          {busy && !result && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[1px]">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Claude bekijkt je bord…
              </span>
            </div>
          )}
          <button className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5" onClick={() => input.current?.click()} aria-label="Andere foto">
            <CloseIcon size={14} />
          </button>
        </div>
      ) : (
        <button onClick={() => input.current?.click()} className="flex h-44 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line text-muted transition hover:border-accent hover:text-accent">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
          <span className="text-sm font-medium">Maak of kies een foto van je maaltijd</span>
        </button>
      )}

      {image && !result && (
        <>
          <input className="input" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Optioneel: toelichting, bijv. 'gebakken in olijfolie, 2 eieren'" maxLength={300} />
          <button className="btn-primary w-full py-3" onClick={estimate} disabled={busy}>
            <SparkleIcon /> {busy ? "Bezig met schatten…" : "Schat voedingswaarden"}
          </button>
          <p className="text-center text-[11px] text-muted">Kost ±2–3 cent van je Claude-tegoed. Het blijft een schatting: controleer de grammen.</p>
        </>
      )}

      {error && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {result && (
        <div className="animate-fade-up space-y-3">
          <p className="text-sm font-semibold">{result.description}</p>
          {result.items.length === 0 ? (
            <p className="text-sm text-muted">{result.notes || "Geen eten herkend."}</p>
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {result.items.map((it, i) => {
                const m = macrosFor(toFood(it).per100, it.grams);
                return (
                  <li key={i} className="flex items-center gap-2 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{it.name}</p>
                      <p className="text-xs text-muted">
                        {nl(m.kcal)} kcal · E {nl(m.protein, 1)} g ·{" "}
                        <span className={it.confidence === "laag" ? "text-warn" : ""}>zekerheid {it.confidence}</span>
                      </p>
                    </div>
                    <input
                      className="input w-20 py-1.5 text-center tabular-nums"
                      inputMode="decimal"
                      value={it.grams}
                      onChange={(e) => {
                        const g = Number(e.target.value.replace(",", ".")) || 0;
                        setResult({ ...result, items: result.items.map((x, j) => (j === i ? { ...x, grams: g } : x)) });
                      }}
                      aria-label={`Grammen ${it.name}`}
                    />
                    <span className="text-xs text-muted">g</span>
                    <button
                      className="p-1 text-muted hover:text-danger"
                      onClick={() => setResult({ ...result, items: result.items.filter((_, j) => j !== i) })}
                      aria-label={`${it.name} verwijderen`}
                    >
                      <CloseIcon size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {result.notes && result.items.length > 0 && <p className="text-xs text-muted">{result.notes}</p>}
          {totals && result.items.length > 0 && (
            <button className="btn-primary w-full py-3" onClick={addAll} disabled={busy}>
              {busy ? "Toevoegen…" : `Alles toevoegen · ${nl(totals.kcal)} kcal · ${nl(totals.protein, 0)} g eiwit`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
