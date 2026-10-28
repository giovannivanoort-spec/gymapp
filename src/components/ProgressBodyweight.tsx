"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth, useUserId } from "./AuthProvider";
import { CheckIcon } from "./Icons";
import { LineChart } from "./LineChart";
import { formatDate, toISODate } from "@/lib/dates";
import { nl } from "@/lib/history";
import { errorMessage, supabase } from "@/lib/supabase";

type Entry = { date: string; weight: number };

const MIN_KG = 30;
const MAX_KG = 300;

/** Lichaamsgewicht invullen (één meting per dag) en het verloop over tijd. */
export function ProgressBodyweight() {
  const userId = useUserId();
  const { refreshProfile } = useAuth();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabase
      .from("bodyweight_logs")
      .select("date, weight_kg")
      .eq("user_id", userId)
      .order("date")
      .then(({ data }) => setEntries((data ?? []).map((r) => ({ date: r.date, weight: Number(r.weight_kg) }))));
  }, [userId]);

  const today = toISODate();
  const todays = entries?.find((e) => e.date === today) ?? null;
  const first = entries?.[0] ?? null;
  const latest = entries?.at(-1) ?? null;
  const change = first && latest && entries!.length > 1 ? latest.weight - first.weight : null;
  const points = useMemo(() => (entries ?? []).map((e) => ({ date: e.date, value: e.weight })), [entries]);
  const recent = useMemo(() => (entries ?? []).slice(-11).reverse(), [entries]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const kg = Number(value.trim().replace(",", "."));
    if (!value.trim() || !Number.isFinite(kg) || kg < MIN_KG || kg > MAX_KG) {
      return setError(`Vul een gewicht in tussen ${MIN_KG} en ${MAX_KG} kg.`);
    }
    const weight = Math.round(kg * 10) / 10;
    setBusy(true);
    const { error: logError } = await supabase
      .from("bodyweight_logs")
      .upsert({ user_id: userId, date: today, weight_kg: weight }, { onConflict: "user_id,date" });
    if (logError) {
      setBusy(false);
      return setError(errorMessage(logError));
    }
    // Het profielgewicht volgt de laatste meting, zodat de ranks met je huidige gewicht rekenen.
    const { error: profileError } = await supabase.from("profiles").update({ bodyweight_kg: weight }).eq("id", userId);
    await refreshProfile();
    setBusy(false);
    setEntries((list) =>
      [...(list ?? []).filter((x) => x.date !== today), { date: today, weight }].sort((a, b) => a.date.localeCompare(b.date)),
    );
    setValue("");
    if (profileError) return setError(errorMessage(profileError));
    setSaved(true);
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Lichaamsgewicht</h2>
      <div className="card space-y-4">
        <form onSubmit={save} noValidate>
          <label className="label" htmlFor="bw-today">
            Gewicht vandaag (kg)
          </label>
          <div className="flex gap-2">
            <input
              id="bw-today"
              className="input min-w-0 flex-1 tabular-nums"
              inputMode="decimal"
              autoComplete="off"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
                setSaved(false);
              }}
              placeholder={todays ? nl(todays.weight) : latest ? nl(latest.weight) : "Bijv. 78,5"}
              aria-invalid={error ? true : undefined}
              aria-describedby="bw-status"
            />
            <button className="btn-primary shrink-0" disabled={busy || !value.trim()}>
              {busy ? "Opslaan…" : todays ? "Bijwerken" : "Opslaan"}
            </button>
          </div>
          <p id="bw-status" className="mt-1.5 min-h-4 text-xs" aria-live="polite">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : saved ? (
              <span className="inline-flex items-center gap-1 text-accent">
                <CheckIcon size={12} strokeWidth={2.5} /> Opgeslagen, je ranks rekenen nu met dit gewicht.
              </span>
            ) : todays ? (
              <span className="text-muted">Vandaag al gemeten: {nl(todays.weight)} kg. Opnieuw opslaan overschrijft dit.</span>
            ) : null}
          </p>
        </form>

        {entries === null ? (
          <div className="space-y-3">
            <div className="skeleton h-12 w-40" />
            <div className="skeleton h-[200px]" />
          </div>
        ) : entries.length === 0 ? (
          <p className="border-t border-line pt-4 text-sm text-muted">
            Nog geen metingen. Weeg jezelf bij voorkeur op een vast moment, bijvoorbeeld &apos;s ochtends voor het ontbijt.
          </p>
        ) : (
          <div className="space-y-4 border-t border-line pt-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs text-muted">Laatste meting · {formatDate(latest!.date, { weekday: undefined, month: "short" })}</p>
                <p className="text-2xl font-extrabold tabular-nums">
                  {nl(latest!.weight)} <span className="text-sm font-semibold text-muted">kg</span>
                </p>
              </div>
              {change != null && (
                <span className="rounded-lg bg-surface-2 px-2 py-1 text-right text-sm font-semibold tabular-nums">
                  {change > 0 ? "+" : change < 0 ? "−" : "±"}
                  {nl(Math.abs(change))} kg
                  <span className="block text-[10px] font-medium text-muted">
                    sinds {formatDate(first!.date, { weekday: undefined, month: "short", year: "2-digit" })}
                  </span>
                </span>
              )}
            </div>

            {points.length > 1 ? (
              <LineChart points={points} unit="kg" />
            ) : (
              <p className="text-sm text-muted">Na een tweede meting verschijnt hier een grafiek.</p>
            )}

            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="py-1.5 font-medium">Datum</th>
                  <th className="py-1.5 text-right font-medium">Gewicht</th>
                  <th className="py-1.5 text-right font-medium">Verschil</th>
                </tr>
              </thead>
              <tbody>
                {recent.slice(0, 10).map((e, i) => {
                  const prev = recent[i + 1];
                  const diff = prev ? Math.round((e.weight - prev.weight) * 10) / 10 : null;
                  return (
                    <tr key={e.date} className="border-t border-line">
                      <td className="py-2">{formatDate(e.date, { weekday: "short", month: "short" })}</td>
                      <td className="py-2 text-right font-semibold">{nl(e.weight)} kg</td>
                      <td className={`py-2 text-right ${diff ? "text-ink" : "text-muted"}`}>
                        {diff == null ? "–" : diff === 0 ? "0" : `${diff > 0 ? "+" : "−"}${nl(Math.abs(diff))}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
