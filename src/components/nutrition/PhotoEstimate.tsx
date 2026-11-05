"use client";

import { useEffect, useRef, useState } from "react";
import { toISODate } from "@/lib/dates";
import { fmt, parseAmount } from "@/lib/nutrition/format";
import { addLogs, resizeImage, type FoodLog } from "@/lib/nutrition/log";
import { macrosFor, sumMacros, type Food, type Meal } from "@/lib/nutrition/types";
import { errorMessage, supabase } from "@/lib/supabase";
import { CheckIcon, CloseIcon, PlusIcon, SparkleIcon } from "../Icons";

type Item = {
  name: string;
  grams: number;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  confidence: "hoog" | "middel" | "laag";
};

/** In het formulier blijven de grammen tekst, zodat je "12,5" kunt typen of het veld even leeg kunt maken. */
type EditItem = Omit<Item, "grams"> & { grams: string; key: number; manual?: boolean };

/** Concept tijdens het bewerken van een onderdeel (alles als tekst). */
type Draft = { name: string; kcal: string; protein: string; carbs: string; fat: string };

const nl = fmt;
const str = (n: number) => String(n).replace(".", ",");
const gramsOf = (it: EditItem) => {
  const g = parseAmount(it.grams);
  return Number.isFinite(g) && g > 0 ? Math.min(g, 5000) : 0;
};

function toFood(it: Omit<Item, "grams" | "confidence">): Food {
  const slug = it.name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    id: `ai:${slug || "onderdeel"}`,
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

const DRAFT_FIELDS = [
  ["kcal", "kcal"],
  ["protein", "Eiwit"],
  ["carbs", "Koolh."],
  ["fat", "Vet"],
] as const;

/** Geldig concept: naam en per-100-waarden die kunnen bestaan. */
function draftValues(d: Draft) {
  const v = { kcal: parseAmount(d.kcal), protein: parseAmount(d.protein || "0"), carbs: parseAmount(d.carbs || "0"), fat: parseAmount(d.fat || "0") };
  const ok =
    d.name.trim().length > 0 &&
    Object.values(v).every((x) => Number.isFinite(x) && x >= 0) &&
    v.kcal <= 950 &&
    v.protein <= 100 &&
    v.carbs <= 100 &&
    v.fat <= 100 &&
    v.protein + v.carbs + v.fat <= 105;
  return ok ? v : null;
}

let nextKey = 1;

/** Foto van je maaltijd → schatting per onderdeel (aanpasbaar) → toevoegen aan het dagboek. */
export function PhotoEstimate({ meal, date, onDone }: { meal: Meal; date: string; onDone: (added?: FoodLog[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ description: string; notes: string; items: EditItem[] } | null>(null);
  const [editing, setEditing] = useState<{ key: number; draft: Draft } | null>(null);
  /** Schattingen die vandaag nog over zijn (null = onbekend). */
  const [quota, setQuota] = useState<{ remaining: number; limit: number } | null>(null);
  const planned = date > toISODate();

  // Hoeveel schattingen er vandaag nog over zijn; mislukt dat, dan tonen we het gewoon niet.
  useEffect(() => {
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) =>
        fetch("/api/nutrition/photo", { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` }, cache: "no-store" }),
      )
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { remaining?: number; limit?: number } | null) => {
        if (!cancelled && json && typeof json.remaining === "number" && typeof json.limit === "number") {
          setQuota({ remaining: json.remaining, limit: json.limit });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Leegmaken, zodat dezelfde foto nog een keer kiezen ook werkt.
    e.target.value = "";
    if (!file) return;
    setError(null);
    setResult(null);
    setEditing(null);
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
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Schatten mislukt. Probeer het opnieuw.");
      const parsed = json as { description: string; notes: string; items: Item[]; remaining?: number };
      if (typeof parsed.remaining === "number") setQuota((q) => (q ? { ...q, remaining: parsed.remaining! } : q));
      setResult({
        description: parsed.description,
        notes: parsed.notes,
        items: parsed.items.map((it) => ({ ...it, grams: String(Math.round(it.grams)), key: nextKey++ })),
      });
    } catch (err) {
      setError(
        err instanceof TypeError ? "Geen verbinding. Check je internet en probeer het opnieuw." : err instanceof Error ? err.message : "Schatten mislukt.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function addAll() {
    if (!result || editing) return;
    setBusy(true);
    setError(null);
    try {
      // Eén insert voor alle onderdelen: bij een fout komt er niets half in je dagboek.
      const added = await addLogs(
        result.items.filter((it) => gramsOf(it) > 0).map((it) => ({ food: toFood(it), grams: gramsOf(it), meal, date, portionLabel: null })),
      );
      onDone(added);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const update = (key: number, patch: Partial<EditItem>) =>
    setResult((r) => (r ? { ...r, items: r.items.map((x) => (x.key === key ? { ...x, ...patch } : x)) } : r));

  function startEdit(it: EditItem) {
    setEditing({
      key: it.key,
      draft: { name: it.name, kcal: str(it.kcal_per_100g), protein: str(it.protein_per_100g), carbs: str(it.carbs_per_100g), fat: str(it.fat_per_100g) },
    });
  }

  function commitEdit() {
    if (!editing) return;
    const v = draftValues(editing.draft);
    if (!v) return;
    update(editing.key, {
      name: editing.draft.name.trim().slice(0, 80),
      kcal_per_100g: Math.round(v.kcal),
      protein_per_100g: v.protein,
      carbs_per_100g: v.carbs,
      fat_per_100g: v.fat,
    });
    setEditing(null);
  }

  function cancelEdit() {
    if (!editing) return;
    // Een nieuw onderdeel dat nooit is ingevuld, weer weghalen.
    setResult((r) => (r ? { ...r, items: r.items.filter((x) => !(x.key === editing.key && x.manual && !x.name)) } : r));
    setEditing(null);
  }

  /** Iets wat Claude miste zelf toevoegen (waarden per 100 g van het etiket of een schatting). */
  function addItem() {
    if (!result) return;
    const it: EditItem = {
      key: nextKey++,
      name: "",
      grams: "100",
      kcal_per_100g: 0,
      protein_per_100g: 0,
      carbs_per_100g: 0,
      fat_per_100g: 0,
      confidence: "hoog",
      manual: true,
    };
    setResult({ ...result, items: [...result.items, it] });
    setEditing({ key: it.key, draft: { name: "", kcal: "", protein: "", carbs: "", fat: "" } });
  }

  const visible = result ? result.items.filter((it) => it.name || it.key === editing?.key) : [];
  const counted = visible.filter((it) => it.name);
  const totals = result ? sumMacros(counted.map((it) => macrosFor(toFood(it).per100, gramsOf(it)))) : null;
  const addable = counted.some((it) => gramsOf(it) > 0);
  const draftOk = editing ? draftValues(editing.draft) !== null : false;

  return (
    <div className="space-y-4">
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />

      {image ? (
        <div className="relative overflow-hidden rounded-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element -- lokale data-URL, geen optimalisatie nodig */}
          <img src={image} alt="Foto van je maaltijd" className="max-h-64 w-full object-cover" />
          {busy && !result && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[1px]" role="status">
              <span className="flex items-center gap-2 text-sm font-semibold text-white">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Claude bekijkt je bord…
              </span>
            </div>
          )}
          {!busy && (
            <button
              className="absolute right-2 top-2 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-black/65 px-3 text-xs font-semibold text-white backdrop-blur transition active:scale-95"
              onClick={() => input.current?.click()}
            >
              <CameraIcon size={14} /> Andere foto
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={() => input.current?.click()}
          className="flex h-44 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line text-muted transition hover:border-accent hover:text-accent"
        >
          <CameraIcon size={32} />
          <span className="text-sm font-medium">Maak of kies een foto van je maaltijd</span>
        </button>
      )}

      {image && !result && (
        <>
          <input
            className="input"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="Optioneel: toelichting, bijv. 'gebakken in olijfolie, 2 eieren'"
            aria-label="Toelichting bij de foto"
            maxLength={300}
          />
          <button className="btn-primary w-full py-3" onClick={estimate} disabled={busy || quota?.remaining === 0}>
            <SparkleIcon /> {busy ? "Bezig met schatten…" : quota?.remaining === 0 ? "Daglimiet bereikt" : "Schat voedingswaarden"}
          </button>
        </>
      )}
      {!result && (
        <p className="text-center text-[11px] text-muted">
          {quota ? (
            <>
              Nog <span className="font-semibold text-ink tabular-nums">{quota.remaining}</span> van {quota.limit} schattingen vandaag.{" "}
            </>
          ) : null}
          Het blijft een schatting: controleer de grammen.
        </p>
      )}

      {error && (
        <p role="alert" className="animate-fade-in rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {result && (
        <div className="animate-fade-up space-y-3">
          <p className="text-sm font-semibold">{result.description}</p>
          {visible.length === 0 ? (
            <p className="text-sm text-muted">{result.notes || "Geen eten herkend."}</p>
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {visible.map((it) => {
                if (editing?.key === it.key) {
                  const d = editing.draft;
                  const setD = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setEditing({ ...editing, draft: { ...d, [k]: e.target.value } });
                  return (
                    <li key={it.key} className="animate-fade-in space-y-3 bg-surface-2/50 p-3">
                      <div>
                        <label className="label" htmlFor={`pe-name-${it.key}`}>
                          Naam
                        </label>
                        <input
                          id={`pe-name-${it.key}`}
                          className="input"
                          value={d.name}
                          onChange={setD("name")}
                          placeholder="bijv. Olijfolie"
                          maxLength={80}
                          autoFocus
                        />
                      </div>
                      <div>
                        <span className="label">Per 100 g</span>
                        <div className="grid grid-cols-4 gap-2">
                          {DRAFT_FIELDS.map(([k, label]) => (
                            <div key={k}>
                              <input
                                className="input px-2 text-center tabular-nums"
                                inputMode="decimal"
                                value={d[k]}
                                onChange={setD(k)}
                                onFocus={(e) => e.target.select()}
                                placeholder="0"
                                aria-label={`${label} per 100 gram`}
                              />
                              <p className="mt-1 text-center text-[10px] uppercase tracking-wide text-muted">{label}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      {!draftOk && d.name.trim() && d.kcal.trim() && (
                        <p className="text-xs text-warn" role="status">
                          Deze waarden kunnen niet per 100 g (max. 950 kcal en 100 g eiwit, koolhydraten en vet samen).
                        </p>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" className="btn-ghost" onClick={cancelEdit}>
                          Annuleren
                        </button>
                        <button type="button" className="btn-primary" onClick={commitEdit} disabled={!draftOk}>
                          <CheckIcon size={14} /> Klaar
                        </button>
                      </div>
                    </li>
                  );
                }
                const m = macrosFor(toFood(it).per100, gramsOf(it));
                return (
                  <li key={it.key} className="flex items-center gap-2 py-1 pl-1 pr-3">
                    <button
                      className="min-h-11 min-w-0 flex-1 rounded-xl px-2 py-1.5 text-left transition hover:bg-surface-2 disabled:opacity-60"
                      onClick={() => startEdit(it)}
                      disabled={editing !== null}
                      aria-label={`${it.name} aanpassen`}
                    >
                      <p className="truncate text-sm font-medium">{it.name}</p>
                      <p className="truncate text-xs text-muted">
                        {nl(m.kcal)} kcal · E {nl(m.protein, 1)} g ·{" "}
                        {it.manual ? "zelf ingevuld" : <span className={it.confidence === "laag" ? "text-warn" : ""}>zekerheid {it.confidence}</span>}
                      </p>
                    </button>
                    <input
                      className="input min-h-11 w-[4.5rem] px-2 py-1.5 text-center tabular-nums"
                      inputMode="decimal"
                      value={it.grams}
                      onChange={(e) => update(it.key, { grams: e.target.value })}
                      onFocus={(e) => e.target.select()}
                      aria-label={`Grammen ${it.name}`}
                    />
                    <span className="text-xs text-muted">g</span>
                    <button
                      className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:text-danger active:scale-90"
                      onClick={() => setResult({ ...result, items: result.items.filter((x) => x.key !== it.key) })}
                      aria-label={`${it.name} verwijderen`}
                    >
                      <CloseIcon size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {!editing && (
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-accent transition hover:bg-surface-2"
              onClick={addItem}
            >
              <PlusIcon size={14} /> Onderdeel toevoegen
            </button>
          )}
          {result.notes && visible.length > 0 && <p className="text-xs text-muted">{result.notes}</p>}
          {visible.length > 0 && !editing && <p className="text-[11px] text-muted">Tik op een onderdeel om de naam of de waarden per 100 g aan te passen.</p>}
          {totals && counted.length > 0 && (
            <button className="btn-primary w-full py-3" onClick={addAll} disabled={busy || !addable || editing !== null}>
              {busy
                ? planned
                  ? "Plannen…"
                  : "Toevoegen…"
                : `${planned ? "Alles plannen" : "Alles toevoegen"} · ${nl(totals.kcal)} kcal · ${nl(totals.protein, 0)} g eiwit`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CameraIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
