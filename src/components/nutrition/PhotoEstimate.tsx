"use client";

import { useEffect, useId, useRef, useState } from "react";
import { toISODate } from "@/lib/dates";
import { basisMatch, type Basis } from "@/lib/nutrition/basisMatch";
import { ESTIMATE_TEXT_MIN as TEXT_MIN } from "@/lib/nutrition/estimate";
import { fmt, parseAmount } from "@/lib/nutrition/format";
import { addLogs, resizeImage, type FoodLog } from "@/lib/nutrition/log";
import { macrosFor, sumMacros, type Food, type Meal } from "@/lib/nutrition/types";
import { errorMessage, supabase } from "@/lib/supabase";
import { CheckIcon, CloseIcon, PencilIcon, PlusIcon, SparkleIcon } from "../Icons";
import { Segmented } from "../social/Segmented";
import { BASIS_ROW_PADDING, BasisSwitch } from "./BasisSwitch";
import { DescribeInput } from "./DescribeInput";

/** Schatten vanaf een foto, of vanaf een beschrijving als er geen foto is (achteraf loggen). */
type Mode = "photo" | "text";
const MODE_KEY = "spotter:ai-estimate-mode";

type Quota = { remaining: number; limit: number };

function readMode(): Mode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "text" ? "text" : "photo";
  } catch {
    return "photo";
  }
}

function saveMode(mode: Mode) {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Geen opslag (privévenster): dan begint het de volgende keer gewoon bij Foto.
  }
}

/** Stand van de daglimiet uit een antwoord van de server (GET, een geslaagde schatting of de 429 bij de limiet). */
function quotaFrom(v: unknown): Quota | null {
  const q = v as Partial<Quota> | null | undefined;
  return q && typeof q.remaining === "number" && typeof q.limit === "number" ? { remaining: q.remaining, limit: q.limit } : null;
}

const MODE_OPTIONS = [
  {
    value: "photo" as const,
    label: (
      <>
        <CameraIcon size={15} /> Foto
      </>
    ),
  },
  {
    value: "text" as const,
    label: (
      <>
        <PencilIcon size={15} strokeWidth={1.8} /> Beschrijf
      </>
    ),
  },
];

type Item = {
  name: string;
  grams: number;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  confidence: "hoog" | "middel" | "laag";
};

type Values = Pick<Item, "kcal_per_100g" | "protein_per_100g" | "carbs_per_100g" | "fat_per_100g">;

/** In het formulier blijven de grammen tekst, zodat je "12,5" kunt typen of het veld even leeg kunt maken. */
type EditItem = Omit<Item, "grams"> & {
  grams: string;
  key: number;
  manual?: boolean;
  basis?: Basis;
  /** Gezet zolang de basiswaarden aan staan: de eigen waarden, om bij uitzetten terug te zetten. */
  own?: Values;
};

const valuesOf = (it: Values): Values => ({
  kcal_per_100g: it.kcal_per_100g,
  protein_per_100g: it.protein_per_100g,
  carbs_per_100g: it.carbs_per_100g,
  fat_per_100g: it.fat_per_100g,
});

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

/**
 * Foto van je maaltijd, of een beschrijving als je geen foto hebt → schatting per onderdeel
 * (aanpasbaar) → toevoegen aan het dagboek. Dit onderdeel regelt de soort (foto of beschrijving), de
 * uitkomst en het opnieuw schatten; het tekstveld zit in DescribeInput en de schakelaar voor
 * basiswaarden in BasisSwitch.
 */
export function PhotoEstimate({ meal, date, onDone }: { meal: Meal; date: string; onDone: (added?: FoodLog[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>(readMode);
  const [image, setImage] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * `kind`: waar deze uitkomst vandaan kwam, om na Annuleren daarheen terug te gaan. `asked`: bij een
   * beschrijving de tekst waar deze uitkomst bij hoort (het tekstveld kan daarna nog veranderen).
   */
  const [result, setResult] = useState<{ kind: Mode; description: string; notes: string; items: EditItem[]; asked?: string } | null>(null);
  const [editing, setEditing] = useState<{ key: number; draft: Draft } | null>(null);
  /**
   * Opnieuw aan het schatten vanaf een uitkomst (andere beschrijving, of toch beschrijven na een foto).
   * Die uitkomst blijft bewaard: pas een geslaagde nieuwe schatting vervangt hem, Annuleren gaat terug.
   * "Andere foto" bij een foto-uitkomst gaat niet via deze stand: die begint meteen opnieuw, zoals altijd.
   */
  const [revising, setRevising] = useState(false);
  /** Schattingen die vandaag nog over zijn, per soort (null = onbekend). */
  const [quotas, setQuotas] = useState<Record<Mode, Quota | null>>({ photo: null, text: null });
  /**
   * Beschrijvingen: de aparte daglimiet voor beschrijvingen zonder uitkomst (geen eten, geweigerd) is
   * op. Dan kan er vandaag niets meer, ook al staat de gewone teller nog niet op 0.
   */
  const [textBlocked, setTextBlocked] = useState(false);
  const quota = quotas[mode];
  /** Vandaag kan deze soort niet meer: knop dicht. */
  const limitReached = quota?.remaining === 0 || (mode === "text" && textBlocked);
  const planned = date > toISODate();
  const modeLabelId = `${useId()}-mode`;

  // Hoeveel schattingen er vandaag nog over zijn; mislukt dat (per soort), dan tonen we die gewoon niet.
  useEffect(() => {
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) =>
        fetch("/api/nutrition/photo", { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` }, cache: "no-store" }),
      )
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { photo?: unknown; text?: { blocked?: unknown } | null } | null) => {
        if (cancelled || !json) return;
        setQuotas({ photo: quotaFrom(json.photo), text: quotaFrom(json.text) });
        setTextBlocked(json.text?.blocked === true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function switchMode(next: Mode) {
    if (next === mode || busy) return;
    setMode(next);
    saveMode(next);
    setError(null);
  }

  /**
   * Vanaf een uitkomst opnieuw schatten, met deze soort. Een onderdeel dat je aan het bewerken was,
   * vervalt (een leeg nieuw onderdeel verdwijnt).
   */
  function startRevise(next: Mode) {
    cancelEdit();
    setError(null);
    setRevising(true);
    switchMode(next);
  }

  /** Terug naar de vorige uitkomst, met alles wat je daar al had aangepast, en naar de soort waar die vandaan kwam. */
  function cancelRevise() {
    setRevising(false);
    setError(null);
    if (!result) return;
    if (result.asked != null) setText(result.asked);
    if (result.kind !== mode) {
      setMode(result.kind);
      saveMode(result.kind);
    }
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Leegmaken, zodat dezelfde foto nog een keer kiezen ook werkt.
    e.target.value = "";
    if (!file) return;
    setError(null);
    // Tijdens opnieuw schatten (vanaf een beschrijving) blijft de vorige uitkomst staan tot de nieuwe
    // schatting slaagt. Anders, zoals altijd: een andere foto begint opnieuw.
    if (!revising) setResult(null);
    setEditing(null);
    try {
      setImage(await resizeImage(file));
    } catch {
      setError("Deze foto kon niet worden gelezen.");
    }
  }

  async function estimate() {
    if (busy) return;
    const kind = mode;
    const description = text.replace(/\s+/g, " ").trim();
    if (kind === "photo" ? !image : description.length < TEXT_MIN) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch("/api/nutrition/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
        body: JSON.stringify(kind === "photo" ? { image, hint } : { text: description }),
      });
      const json = await res.json().catch(() => ({}));
      // Na een schatting, en ook bij de daglimiet (429 met remaining 0), stuurt de server de stand
      // mee: teller bijwerken, zodat de knop bij 0 dichtgaat. Andere fouten laten de teller staan.
      const nextQuota = quotaFrom(json);
      if (nextQuota) setQuotas((q) => ({ ...q, [kind]: nextQuota }));
      // Bij beschrijvingen meldt de server ook of de aparte limiet (zonder uitkomst) nu op is.
      if (kind === "text" && typeof json.blocked === "boolean") setTextBlocked(json.blocked);
      if (!res.ok) throw new Error(json.error ?? "Schatten mislukt. Probeer het opnieuw.");
      const parsed = json as { description: string; notes: string; items: Item[] };
      setEditing(null);
      setRevising(false);
      setResult({
        kind,
        description: parsed.description,
        notes: parsed.notes,
        asked: kind === "text" ? description : undefined,
        items: parsed.items.map((it) => ({ ...it, grams: String(Math.round(it.grams)), key: nextKey++, basis: basisMatch(it.name, it.kcal_per_100g) })),
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
      // Eén insert voor alle onderdelen: bij een fout komt er niets half in je dagboek. Alleen wat
      // een naam en grammen heeft (een nooit ingevuld nieuw onderdeel hoort er niet bij).
      const added = await addLogs(
        result.items.filter((it) => it.name.trim() && gramsOf(it) > 0).map((it) => ({ food: toFood(it), grams: gramsOf(it), meal, date, portionLabel: null })),
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
    const name = editing.draft.name.trim().slice(0, 80);
    // Zelf aangepaste waarden gelden; de basiswaarden staan daarmee uit (en de naam kan veranderd zijn).
    update(editing.key, {
      name,
      kcal_per_100g: Math.round(v.kcal),
      protein_per_100g: v.protein,
      carbs_per_100g: v.carbs,
      fat_per_100g: v.fat,
      basis: basisMatch(name, v.kcal),
      own: undefined,
    });
    setEditing(null);
  }

  /** Waarden van het basisproduct gebruiken, of terug naar de eigen schatting. */
  function toggleBasis(it: EditItem) {
    if (!it.basis) return;
    if (it.own) {
      update(it.key, { ...it.own, own: undefined });
      return;
    }
    const p = it.basis.per100;
    update(it.key, {
      own: valuesOf(it),
      kcal_per_100g: Math.round(p.kcal),
      protein_per_100g: Math.round(p.protein * 10) / 10,
      carbs_per_100g: Math.round(p.carbs * 10) / 10,
      fat_per_100g: Math.round(p.fat * 10) / 10,
    });
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

  const visible = result ? result.items.filter((it) => it.name.trim() || it.key === editing?.key) : [];
  const counted = visible.filter((it) => it.name.trim());
  /** Keuze Foto/Beschrijf en de invoer: zonder uitkomst, of tijdens opnieuw schatten. */
  const asking = !result || revising;
  const totals = result ? sumMacros(counted.map((it) => macrosFor(toFood(it).per100, gramsOf(it)))) : null;
  const addable = counted.some((it) => gramsOf(it) > 0);
  const draftOk = editing ? draftValues(editing.draft) !== null : false;

  /** Tijdens opnieuw schatten, onder de invoer van beide soorten: uitleg en terug naar de vorige uitkomst. */
  const reviseBar = revising && !busy && (
    <div className="flex items-center gap-3">
      <p className="min-w-0 flex-1 text-[11px] text-muted">Een nieuwe schatting vervangt de vorige onderdelen, ook wat je daar al had aangepast.</p>
      <button type="button" className="btn-ghost shrink-0" onClick={cancelRevise}>
        Annuleren
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />

      {asking && (
        // fieldset disabled zet alle keuzeknoppen dicht zolang er een schatting loopt.
        <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
          <span id={modeLabelId} className="sr-only">
            Schatten vanaf
          </span>
          <Segmented
            value={mode}
            options={MODE_OPTIONS}
            onChange={switchMode}
            labelledBy={modeLabelId}
            className="grid grid-cols-2 gap-1"
            itemClassName="inline-flex min-h-11 items-center justify-center gap-1.5 px-2 font-semibold active:scale-95 disabled:opacity-60"
          />
        </fieldset>
      )}

      {mode === "text" ? (
        asking ? (
          <DescribeInput value={text} onChange={setText} onSubmit={estimate} busy={busy} limitReached={limitReached} autoFocus={revising} footer={reviseBar} />
        ) : (
          <div className="flex items-start gap-2 rounded-2xl border border-line bg-surface-2/50 py-1 pl-3 pr-1">
            <p className="min-w-0 flex-1 py-2.5 text-sm text-muted">
              <span className="sr-only">Je beschrijving: </span>
              {result?.asked}
            </p>
            <button
              type="button"
              className="inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-xs font-semibold text-accent transition hover:bg-surface-2 disabled:opacity-60"
              onClick={() => startRevise("text")}
              disabled={busy}
            >
              Beschrijving aanpassen
            </button>
          </div>
        )
      ) : (
        <>
          {image ? (
            <div className="relative overflow-hidden rounded-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element -- lokale data-URL, geen optimalisatie nodig */}
              <img src={image} alt="Foto van je maaltijd" className="max-h-64 w-full object-cover" />
              {busy && asking && (
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

          {asking && image && (
            <>
              <input
                className="input"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="Optioneel: toelichting, bijv. 'gebakken in olijfolie, 2 eieren'"
                aria-label="Toelichting bij de foto"
                maxLength={300}
              />
              <button className="btn-primary w-full py-3" onClick={estimate} disabled={busy || limitReached}>
                <SparkleIcon /> {busy ? "Bezig met schatten…" : limitReached ? "Daglimiet bereikt" : "Schat voedingswaarden"}
              </button>
            </>
          )}
          {reviseBar}

          {!asking && !busy && (
            // Naast "Andere foto" (meteen een nieuwe foto, zoals altijd): toch liever beschrijven. De
            // foto-uitkomst blijft dan bewaard tot de beschrijving slaagt; Annuleren gaat terug.
            <button
              type="button"
              className="-mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-accent transition hover:bg-surface-2"
              onClick={() => startRevise("text")}
            >
              <PencilIcon size={14} strokeWidth={1.8} /> Toch beschrijven
            </button>
          )}
        </>
      )}

      {asking && (
        <p className="text-center text-[11px] text-muted">
          {mode === "text" && limitReached ? (
            <span className="font-semibold text-ink">Je kunt vandaag geen beschrijvingen meer laten schatten. </span>
          ) : quota ? (
            <>
              Nog <span className="font-semibold text-ink tabular-nums">{quota.remaining}</span> van {quota.limit}{" "}
              {mode === "photo" ? "schattingen" : "beschrijvingen"} vandaag.{" "}
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

      {result && !asking && (
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
                const fromBasis = !!it.own;
                return (
                  // Met een basisregel meer ruimte onder: daar valt het tikvlak van de schakelaar in (zie BasisSwitch).
                  <li key={it.key} className={`pl-1 pr-3 ${it.basis ? `${BASIS_ROW_PADDING} pt-1` : "py-1"}`}>
                    <div className="flex items-center gap-2">
                      <button
                        className="min-h-11 min-w-0 flex-1 rounded-xl px-2 py-1.5 text-left transition hover:bg-surface-2 disabled:opacity-60"
                        onClick={() => startEdit(it)}
                        disabled={editing !== null}
                        aria-label={`${it.name} aanpassen`}
                      >
                        <p className="truncate text-sm font-medium">{it.name}</p>
                        <p className="truncate text-xs text-muted">
                          {nl(m.kcal)} kcal · E {nl(m.protein, 1)} g ·{" "}
                          {fromBasis ? (
                            "basisproduct"
                          ) : it.manual ? (
                            "zelf ingevuld"
                          ) : (
                            <span className={it.confidence === "laag" ? "text-warn" : ""}>zekerheid {it.confidence}</span>
                          )}
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
                    </div>
                    {it.basis && (
                      <BasisSwitch
                        basis={it.basis}
                        on={fromBasis}
                        estimatedKcal={(it.own ?? it).kcal_per_100g}
                        disabled={editing !== null}
                        onToggle={() => toggleBasis(it)}
                      />
                    )}
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
