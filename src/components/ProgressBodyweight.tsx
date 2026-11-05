"use client";

import { useMemo, useState } from "react";
import { useAuth, useUserId } from "./AuthProvider";
import { CheckIcon, ChevronRightIcon } from "./Icons";
import { LineChart, type ChartPoint } from "./LineChart";
import { Sheet } from "./Sheet";
import { LoadError } from "./platform/LoadError";
import { forgetPersisted, setCached, useCachedState } from "@/lib/cache";
import { formatDate, toISODate } from "@/lib/dates";
import { nl } from "@/lib/history";
import { errorMessage, supabase } from "@/lib/supabase";

type Entry = { date: string; weight: number };

const MIN_KG = 30;
const MAX_KG = 300;
const DAY = 86_400_000;

const bodyweightKey = (userId: string) => `progress:bodyweight:v2:${userId}`;

async function fetchEntries(userId: string): Promise<Entry[]> {
  // Opruimen: de vorige versie bewaarde de metingen in een andere vorm onder een andere sleutel.
  forgetPersisted(`progress:bodyweight:${userId}`);
  const { data, error } = await supabase.from("bodyweight_logs").select("date, weight_kg").eq("user_id", userId).order("date");
  if (error) throw error;
  return (data ?? []).map((r) => ({ date: r.date as string, weight: Number(r.weight_kg) }));
}

function parseKg(raw: string): number | null {
  const kg = Number(raw.trim().replace(",", "."));
  if (!raw.trim() || !Number.isFinite(kg) || kg < MIN_KG || kg > MAX_KG) return null;
  return Math.round(kg * 10) / 10;
}

const time = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
};

/** 7-daags voortschrijdend gemiddelde: per meting het gemiddelde van de metingen in de 7 dagen ervoor (inclusief). */
function movingAverage(entries: Entry[]): ChartPoint[] {
  const out: ChartPoint[] = [];
  let lo = 0;
  let sum = 0;
  for (let i = 0; i < entries.length; i++) {
    sum += entries[i].weight;
    const t = time(entries[i].date);
    while (time(entries[lo].date) <= t - 7 * DAY) sum -= entries[lo++].weight;
    out.push({ date: entries[i].date, value: Math.round((sum / (i - lo + 1)) * 10) / 10 });
  }
  return out;
}

/** Na zoveel dagen zonder meting zeggen we niets meer over de verandering "per week". */
const FRESH_DAYS = 14;

/** Gemiddelde verandering per week: de laatste 7 dagen tegenover de 7 dagen daarvoor. */
function weeklyChange(entries: Entry[]): number | null {
  if (entries.length < 2) return null;
  const end = time(entries.at(-1)!.date);
  const avg = (from: number, to: number) => {
    const list = entries.filter((e) => time(e.date) > from && time(e.date) <= to);
    return list.length ? list.reduce((s, e) => s + e.weight, 0) / list.length : null;
  };
  const now = avg(end - 7 * DAY, end);
  const before = avg(end - 14 * DAY, end - 7 * DAY);
  return now != null && before != null ? Math.round((now - before) * 10) / 10 : null;
}

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${nl(Math.abs(n))}`;

/** Lichaamsgewicht invullen (één meting per dag, ook voor eerdere dagen), aanpassen en het verloop over tijd. */
export function ProgressBodyweight() {
  const userId = useUserId();
  const { profile, refreshProfile } = useAuth();
  const key = bodyweightKey(userId);
  const load = useCachedState(key, () => fetchEntries(userId), { persist: true, maxAge: 30_000 });
  const entries = load.data;

  const today = toISODate();
  const [value, setValue] = useState("");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  // De meting in het paneel blijft staan tijdens de sluitanimatie; `sheetOpen` regelt open/dicht.
  const [editing, setEditing] = useState<Entry | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Telt het openen: elke keer een vers paneel, maar sluiten behoudt de inhoud (voor de animatie). */
  const [openSeq, setOpenSeq] = useState(0);

  const list = useMemo(() => entries ?? [], [entries]);
  const onDate = list.find((e) => e.date === date) ?? null;
  const first = list[0] ?? null;
  const latest = list.at(-1) ?? null;
  // Hoe lang geleden de laatste meting was (in hele dagen, op kalenderdatum).
  const daysSinceLatest = latest ? Math.max(0, Math.round((time(today) - time(latest.date)) / DAY)) : null;
  const fresh = daysSinceLatest != null && daysSinceLatest <= FRESH_DAYS;
  const weekly = useMemo(() => weeklyChange(list), [list]);
  // Een "per week"-cijfer van maanden geleden is misleidend: dan alleen de verandering sinds de start.
  const perWeek = fresh ? weekly : null;
  const sinceStart = first && latest && list.length > 1 ? Math.round((latest.weight - first.weight) * 10) / 10 : null;
  const points = useMemo(() => list.map((e) => ({ date: e.date, value: e.weight })), [list]);
  const trend = useMemo(() => (list.length >= 4 ? movingAverage(list) : undefined), [list]);
  const recent = useMemo(() => [...list].reverse(), [list]);
  const visible = showAll ? recent : recent.slice(0, 8);

  /** Lokale lijst bijwerken (en bewaren) zonder opnieuw te laden. */
  function commit(next: Entry[]) {
    setCached(key, next, true);
  }

  /**
   * Het profielgewicht volgt de nieuwste meting, zodat de ranks met je huidige gewicht rekenen.
   * Geeft een waarschuwing terug als dat niet lukte (de meting zelf is dan wel opgeslagen).
   */
  async function syncProfile(next: Entry[]): Promise<string | null> {
    const newest = next.at(-1);
    if (!newest || newest.weight === profile?.bodyweight_kg) return null;
    try {
      const { error: profileError } = await supabase.from("profiles").update({ bodyweight_kg: newest.weight }).eq("id", userId);
      if (profileError) throw profileError;
      await refreshProfile();
      return null;
    } catch {
      return profile?.bodyweight_kg
        ? `Profielgewicht niet bijgewerkt, ranks rekenen nog met ${nl(profile.bodyweight_kg)} kg.`
        : "Profielgewicht niet bijgewerkt. Probeer het later opnieuw.";
    }
  }

  /** Meting opslaan. `error`: niet opgeslagen. `warning`: opgeslagen, maar het profiel liep niet mee. */
  async function upsert(day: string, weight: number): Promise<{ error?: string; warning?: string }> {
    const { error: logError } = await supabase
      .from("bodyweight_logs")
      .upsert({ user_id: userId, date: day, weight_kg: weight }, { onConflict: "user_id,date" });
    if (logError) return { error: errorMessage(logError) };
    const next = [...list.filter((x) => x.date !== day), { date: day, weight }].sort((a, b) => a.date.localeCompare(b.date));
    commit(next);
    const warn = await syncProfile(next);
    return warn ? { warning: warn } : {};
  }

  function openEditor(entry: Entry) {
    setEditing(entry);
    setOpenSeq((n) => n + 1);
    setSheetOpen(true);
  }

  /** Waarschuwing na aanpassen in het paneel tonen onder het formulier. */
  function showWarning(w: string | null | undefined) {
    if (!w) return;
    setError(null);
    setSaved("Meting bijgewerkt.");
    setWarning(w);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    setWarning(null);
    const weight = parseKg(value);
    if (weight == null) return setError(`Vul een gewicht in tussen ${MIN_KG} en ${MAX_KG} kg.`);
    if (!date || date > today) return setError("Kies een datum van vandaag of eerder.");
    setBusy(true);
    const res = await upsert(date, weight);
    setBusy(false);
    if (res.error) return setError(res.error);
    setValue("");
    const newest = date >= (latest?.date ?? "");
    setSaved(
      newest && !res.warning
        ? "Opgeslagen, je ranks rekenen nu met dit gewicht."
        : `Opgeslagen voor ${formatDate(date, { weekday: undefined })}.`,
    );
    setWarning(res.warning ?? null);
    setDate(today);
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Lichaamsgewicht</h2>
      <div className="card space-y-4">
        <form onSubmit={save} noValidate>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="label" htmlFor="bw-value">
              Gewicht (kg)
            </label>
            <input
              type="date"
              className="rounded-lg border border-line bg-surface-2 px-2 py-0.5 text-base font-semibold text-ink [color-scheme:dark] focus:border-accent focus:outline-none sm:text-sm"
              value={date}
              max={today}
              onChange={(e) => {
                setDate(e.target.value || today);
                setError(null);
                setSaved(null);
              }}
              aria-label="Datum van de meting"
            />
          </div>
          <div className="flex gap-2">
            <input
              id="bw-value"
              className="input min-w-0 flex-1 tabular-nums"
              inputMode="decimal"
              autoComplete="off"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
                setSaved(null);
              }}
              placeholder={onDate ? nl(onDate.weight) : latest ? nl(latest.weight) : "Bijv. 78,5"}
              aria-invalid={error ? true : undefined}
              aria-describedby="bw-status"
            />
            <button className="btn-primary shrink-0" disabled={busy || !value.trim()}>
              {busy ? "Opslaan…" : onDate ? "Bijwerken" : "Opslaan"}
            </button>
          </div>
          <p id="bw-status" className="mt-1.5 min-h-4 text-xs" aria-live="polite">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : saved ? (
              <span className="animate-fade-in block">
                <span className="inline-flex items-center gap-1 text-accent">
                  <CheckIcon size={12} strokeWidth={2.5} /> {saved}
                </span>
                {warning && <span className="mt-0.5 block text-warn">{warning}</span>}
              </span>
            ) : onDate ? (
              <span className="text-muted">
                {date === today ? "Vandaag" : formatDate(date, { weekday: undefined })} al gemeten: {nl(onDate.weight)} kg. Opnieuw opslaan
                overschrijft dit.
              </span>
            ) : date !== today ? (
              <span className="text-muted">Je vult een meting in voor {formatDate(date, { weekday: undefined })}.</span>
            ) : null}
          </p>
        </form>

        {entries === undefined ? (
          load.error ? (
            <div className="border-t border-line pt-4">
              <LoadError error={load.error} onRetry={load.retry} retrying={load.refreshing} title="Metingen niet geladen" />
            </div>
          ) : (
            <div className="space-y-3 border-t border-line pt-4">
              <div className="skeleton h-12 w-40" />
              <div className="skeleton h-[200px]" />
            </div>
          )
        ) : list.length === 0 ? (
          <div className="space-y-3 border-t border-line pt-4">
            {load.error != null && (
              <LoadError compact error={load.error} onRetry={load.retry} retrying={load.refreshing} updatedAt={load.updatedAt} />
            )}
            <p className="text-sm text-muted">
              Nog geen metingen. Weeg jezelf bij voorkeur op een vast moment, bijvoorbeeld &apos;s ochtends voor het ontbijt.
            </p>
          </div>
        ) : (
          <div className="space-y-4 border-t border-line pt-4">
            {load.error != null && (
              <LoadError compact error={load.error} onRetry={load.retry} retrying={load.refreshing} updatedAt={load.updatedAt} />
            )}
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs text-muted">Laatste meting · {formatDate(latest!.date, { weekday: undefined, month: "short" })}</p>
                <p className="text-2xl font-extrabold tabular-nums">
                  {nl(latest!.weight)} <span className="text-sm font-semibold text-muted">kg</span>
                </p>
                {!fresh && daysSinceLatest != null && (
                  <p className="text-xs text-muted">
                    Laatste meting {daysSinceLatest} {daysSinceLatest === 1 ? "dag" : "dagen"} geleden
                  </p>
                )}
              </div>
              {perWeek != null ? (
                <span className="rounded-lg bg-surface-2 px-2 py-1 text-right text-sm font-semibold tabular-nums">
                  {signed(perWeek)} kg
                  <span className="block text-[10px] font-medium text-muted">per week (gemiddeld)</span>
                </span>
              ) : (
                sinceStart != null && (
                  <span className="rounded-lg bg-surface-2 px-2 py-1 text-right text-sm font-semibold tabular-nums">
                    {signed(sinceStart)} kg
                    <span className="block text-[10px] font-medium text-muted">
                      sinds {formatDate(first!.date, { weekday: undefined, month: "short", year: "2-digit" })}
                    </span>
                  </span>
                )
              )}
            </div>

            {points.length > 1 ? (
              <LineChart points={points} unit="kg" trend={trend} trendLabel="7-daags gemiddelde" ranges label="Lichaamsgewicht" />
            ) : (
              <p className="text-sm text-muted">Na een tweede meting verschijnt hier een grafiek.</p>
            )}

            {sinceStart != null && perWeek != null && (
              <p className="text-xs text-muted">
                {signed(sinceStart)} kg sinds je eerste meting op{" "}
                {formatDate(first!.date, { weekday: undefined, month: "short", year: "numeric" })}.
              </p>
            )}

            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Metingen · tik om aan te passen</p>
              <ul className="divide-y divide-line">
                {visible.map((e, i) => {
                  const prev = recent[i + 1];
                  const diff = prev ? Math.round((e.weight - prev.weight) * 10) / 10 : null;
                  return (
                    <li key={e.date}>
                      <button
                        type="button"
                        onClick={() => openEditor(e)}
                        className="flex w-full items-center gap-3 py-2.5 text-left text-sm tabular-nums transition hover:text-accent active:opacity-70"
                        aria-label={`${formatDate(e.date)}: ${nl(e.weight)} kg. Aanpassen`}
                      >
                        <span className="min-w-0 flex-1">{formatDate(e.date, { weekday: "short", month: "short" })}</span>
                        <span className="w-14 text-right text-xs text-muted">{diff == null ? "" : diff === 0 ? "0" : signed(diff)}</span>
                        <span className="w-16 text-right font-semibold">{nl(e.weight)} kg</span>
                        <ChevronRightIcon size={14} className="shrink-0 text-muted" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {recent.length > 8 && (
                <button type="button" onClick={() => setShowAll((v) => !v)} className="btn-ghost mt-2 w-full text-sm">
                  {showAll ? "Minder tonen" : `Alle ${recent.length} metingen tonen`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {editing && (
        <EditEntrySheet
          key={openSeq}
          entry={editing}
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onSave={async (weight) => {
            const res = await upsert(editing.date, weight);
            if (res.error) return res.error;
            setSheetOpen(false);
            showWarning(res.warning);
            return null;
          }}
          onDelete={async () => {
            const day = editing.date;
            const { error: delError } = await supabase.from("bodyweight_logs").delete().eq("user_id", userId).eq("date", day);
            if (delError) return errorMessage(delError);
            const next = list.filter((x) => x.date !== day);
            commit(next);
            setSheetOpen(false);
            showWarning(await syncProfile(next));
            return null;
          }}
        />
      )}
    </section>
  );
}

/** Eén meting aanpassen of verwijderen (met bevestiging). */
function EditEntrySheet({
  entry,
  open,
  onClose,
  onSave,
  onDelete,
}: {
  entry: Entry;
  open: boolean;
  onClose: () => void;
  onSave: (weight: number) => Promise<string | null>;
  onDelete: () => Promise<string | null>;
}) {
  const [value, setValue] = useState(nl(entry.weight));
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet open={open} onClose={onClose} title={formatDate(entry.date, { year: "numeric" })}>
      <form
        className="space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const weight = parseKg(value);
          if (weight == null) return setError(`Vul een gewicht in tussen ${MIN_KG} en ${MAX_KG} kg.`);
          setBusy("save");
          setError(null);
          const err = await onSave(weight);
          setBusy(null);
          if (err) setError(err);
        }}
      >
        <div>
          <label className="label" htmlFor="bw-edit">
            Gewicht (kg)
          </label>
          <input
            id="bw-edit"
            className="input tabular-nums"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby="bw-edit-status"
          />
          <p id="bw-edit-status" className="mt-1.5 min-h-4 text-xs text-danger" aria-live="polite">
            {error}
          </p>
        </div>
        <button className="btn-primary w-full" disabled={busy != null || !value.trim()}>
          {busy === "save" ? "Opslaan…" : "Opslaan"}
        </button>
        {confirm ? (
          <div className="animate-fade-in space-y-2 rounded-xl border border-danger/30 bg-danger/10 p-3">
            <p className="text-sm">Deze meting van {nl(entry.weight)} kg verwijderen? Dit kan niet ongedaan worden gemaakt.</p>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost flex-1" onClick={() => setConfirm(false)} disabled={busy != null}>
                Annuleren
              </button>
              <button
                type="button"
                className="btn-danger flex-1"
                disabled={busy != null}
                onClick={async () => {
                  setBusy("delete");
                  setError(null);
                  const err = await onDelete();
                  setBusy(null);
                  if (err) {
                    setError(err);
                    setConfirm(false);
                  }
                }}
              >
                {busy === "delete" ? "Verwijderen…" : "Verwijderen"}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn-ghost w-full text-danger" onClick={() => setConfirm(true)} disabled={busy != null}>
            Meting verwijderen
          </button>
        )}
      </form>
    </Sheet>
  );
}
