"use client";

import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import { toast } from "@/components/ui/Toast";
import { useCachedState } from "@/lib/cache";
import { formatDate, parseISODate, timeAgo } from "@/lib/dates";
import {
  clearManualSleep,
  formatClockTime,
  formatSleepDuration,
  isSleepReconsentError,
  manualSleepDates,
  manualSleepFromTimes,
  saveManualSleep,
  sleepErrorMessage,
  sleepSourceLine,
  validateManualSleep,
  type SleepSource,
} from "@/lib/sleep";
import { isMissingSchemaError, supabase } from "@/lib/supabase";

/** Ruwe nacht per bron (niet de effectieve view): nodig om je handmatige invoer naast die van een toestel te tonen. */
type RawNight = {
  date: string;
  source: SleepSource;
  asleep_minutes: number;
  in_bed_minutes: number | null;
  bedtime: string | null;
  wake_time: string | null;
  source_apps: string[];
  synced_at: string;
};

async function fetchRawNights(userId: string, from: string, to: string): Promise<RawNight[]> {
  const { data, error } = await supabase
    .from("daily_sleep")
    .select("date, source, asleep_minutes, in_bed_minutes, bedtime, wake_time, source_apps, synced_at")
    .eq("user_id", userId)
    .gte("date", from)
    .lte("date", to);
  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
  return ((data ?? []) as RawNight[]).map((r) => ({
    ...r,
    asleep_minutes: Number(r.asleep_minutes) || 0,
    in_bed_minutes: r.in_bed_minutes == null ? null : Number(r.in_bed_minutes),
    source_apps: Array.isArray(r.source_apps) ? r.source_apps : [],
  }));
}

const DEFAULT_BED = "23:00";
const DEFAULT_WAKE = "07:00";
const clock = (iso: string | null | undefined, fallback: string) => {
  const t = formatClockTime(iso);
  return t === "–" ? fallback : t;
};

function dayLabel(iso: string, dates: string[]): string {
  if (iso === dates[0]) return "Vandaag";
  if (iso === dates[1]) return "Gisteren";
  return formatDate(iso);
}

/** "30", "1:15" of "1u15" → minuten. Leeg → 0. Ongeldig → NaN. */
function parseMinutes(v: string): number {
  const s = v.trim();
  if (!s) return 0;
  const hm = /^(\d{1,2})\s*[:u]\s*(\d{1,2})$/i.exec(s);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  return /^\d{1,3}$/.test(s) ? Number(s) : NaN;
}

/**
 * Slaap handmatig invullen voor een van de afgelopen 7 nachten. De datum is de dag waarop je wakker
 * werd; ligt de bedtijd later op de klok dan de wektijd, dan was dat de avond ervoor. Heeft die nacht al
 * gegevens van een telefoon of horloge, dan staan die erbij: die gaan voor handmatige invoer.
 * Vereist toestemming (v2) om activiteit en slaap op te slaan; weigert de server omdat de toestemming van
 * vóór slaap is, dan verschijnt een knop naar `onReconsent`.
 */
export function SleepEntrySheet({
  open,
  onClose,
  userId,
  date: initialDate,
  onReconsent,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  /** Voorgeselecteerde wakkerworddatum (YYYY-MM-DD); standaard vandaag. */
  date?: string;
  /** Toon het toestemmingsscherm (opnieuw toestemming geven). */
  onReconsent?: () => void;
}) {
  const dates = manualSleepDates();
  const from = dates[dates.length - 1];
  const to = dates[0];
  // Begint met "sleep:days:<uid>:" zodat invalidateSleep en forgetSleepData deze kopie ook raken.
  const raw = useCachedState(open && userId ? `sleep:days:${userId}:raw:${from}:${to}` : null, () => fetchRawNights(userId, from, to), {
    maxAge: 30_000,
  });

  const [date, setDate] = useState(initialDate && dates.includes(initialDate) ? initialDate : to);
  const [bed, setBed] = useState(DEFAULT_BED);
  const [wake, setWake] = useState(DEFAULT_WAKE);
  const [awake, setAwake] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<{ text: string; reconsent: boolean } | null>(null);
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);

  const rows = raw.data ?? [];
  const forDay = rows.filter((r) => r.date === date);
  const manual = forDay.find((r) => r.source === "manual") ?? null;
  const device = forDay.filter((r) => r.source !== "manual").sort((a, b) => b.synced_at.localeCompare(a.synced_at))[0] ?? null;

  // Bij openen, een andere datum of zodra de bestaande invoer binnen is: velden vullen met wat er al
  // handmatig stond. Niet over iets heen schrijven dat je net zelf typte.
  const loaded = raw.data !== undefined;
  const [seen, setSeen] = useState({ open: false, date: "", loaded: false });
  if (open !== seen.open || date !== seen.date || loaded !== seen.loaded) {
    setSeen({ open, date, loaded });
    const fill = () => {
      setBed(clock(manual?.bedtime, DEFAULT_BED));
      setWake(clock(manual?.wake_time, DEFAULT_WAKE));
      const lay = manual?.in_bed_minutes != null ? manual.in_bed_minutes - manual.asleep_minutes : 0;
      setAwake(lay > 0 ? String(lay) : "");
      setDirty(false);
      setError(null);
    };
    if (open && !seen.open) {
      const target = initialDate && dates.includes(initialDate) ? initialDate : to;
      if (target !== date) setDate(target);
      else fill();
    } else if (open && (date !== seen.date || !dirty)) {
      fill();
    }
  }

  const hasData = new Set(rows.map((r) => r.date));

  // Live uitrekenen wat er wordt opgeslagen.
  const awakeMin = parseMinutes(awake);
  const base = manualSleepFromTimes(date, bed, wake);
  const inBed = base?.in_bed_minutes ?? null;
  const asleep = inBed != null && Number.isFinite(awakeMin) ? inBed - awakeMin : null;

  function close() {
    if (busy) return;
    setError(null);
    onClose();
  }

  function edit<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setDirty(true);
      if (error) setError(null);
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!base) {
      setError({ text: "Vul een geldige bedtijd en wektijd in.", reconsent: false });
      return;
    }
    if (!Number.isFinite(awakeMin) || awakeMin < 0) {
      setError({ text: "Vul bij wakker gelegen een aantal minuten in, bijv. 20.", reconsent: false });
      return;
    }
    const entry = manualSleepFromTimes(date, bed, wake, asleep);
    const msg = entry ? validateManualSleep(entry) : "Vul een geldige bedtijd en wektijd in.";
    if (!entry || msg) {
      setError({ text: msg ?? "Controleer je invoer.", reconsent: false });
      return;
    }
    if (entry.asleep_minutes != null && entry.asleep_minutes <= 0) {
      setError({ text: "Je hebt langer wakker gelegen dan je in bed lag.", reconsent: false });
      return;
    }
    setBusy("save");
    setError(null);
    try {
      await saveManualSleep(userId, entry);
      toast.success(date === to ? "Slaap van afgelopen nacht opgeslagen" : `Slaap van ${dayLabel(date, dates).toLowerCase()} opgeslagen`);
      setDirty(false);
      onClose();
    } catch (err) {
      setError({ text: sleepErrorMessage(err), reconsent: isSleepReconsentError(err) });
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    setError(null);
    try {
      await clearManualSleep(userId, date);
      toast("Handmatige invoer gewist");
      setDirty(false);
      onClose();
    } catch (err) {
      setError({ text: sleepErrorMessage(err), reconsent: isSleepReconsentError(err) });
    } finally {
      setBusy(null);
    }
  }

  const chips = [...dates].reverse();

  return (
    <Sheet open={open} onClose={close} title="Slaap invoeren">
      <form className="space-y-5" onSubmit={save} noValidate>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="label mb-0" id="sleep-day-label">
              Wakker geworden op
            </span>
            <span className="text-sm font-semibold first-letter:uppercase">{dayLabel(date, dates)}</span>
          </div>
          <div role="radiogroup" aria-labelledby="sleep-day-label" className="grid grid-cols-7 gap-1">
            {chips.map((d) => {
              const on = d === date;
              const dt = parseISODate(d);
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${dayLabel(d, dates)}${hasData.has(d) ? ", heeft gegevens" : ""}`}
                  onClick={() => setDate(d)}
                  className={`relative flex min-h-14 flex-col items-center justify-center rounded-xl border text-xs transition active:scale-95 ${
                    on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface-2 text-muted hover:border-muted hover:text-ink"
                  }`}
                >
                  <span className="capitalize">{dt.toLocaleDateString("nl-NL", { weekday: "short" }).replace(".", "")}</span>
                  <span className={`text-base font-bold tabular-nums ${on ? "" : "text-ink"}`}>{dt.getDate()}</span>
                  {hasData.has(d) && <span className={`absolute bottom-1 h-1 w-1 rounded-full ${on ? "bg-accent-ink" : "bg-accent"}`} aria-hidden />}
                </button>
              );
            })}
          </div>
        </div>

        {device && (
          <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-muted">{sleepSourceLine(device)}</span>
              <span className="shrink-0 text-xs text-muted">{timeAgo(device.synced_at)}</span>
            </div>
            <p className="mt-1 font-semibold tabular-nums">
              {formatSleepDuration(device.asleep_minutes)} geslapen
              {device.bedtime && device.wake_time && (
                <span className="font-normal text-muted">
                  {" "}
                  · {formatClockTime(device.bedtime)}–{formatClockTime(device.wake_time)}
                </span>
              )}
            </p>
            <p className="mt-1 text-xs text-muted">
              Gegevens van je telefoon of horloge gaan voor handmatige invoer. Wat je hier invult, telt alleen als die er voor deze
              nacht niet meer zijn.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="sleep-bed" className="label">
              Naar bed
            </label>
            <input
              id="sleep-bed"
              type="time"
              className="input tabular-nums"
              value={bed}
              required
              aria-invalid={!!error || undefined}
              onChange={(e) => edit(setBed)(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="sleep-wake" className="label">
              Wakker
            </label>
            <input
              id="sleep-wake"
              type="time"
              className="input tabular-nums"
              value={wake}
              required
              aria-invalid={!!error || undefined}
              onChange={(e) => edit(setWake)(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label htmlFor="sleep-awake" className="label">
            Wakker gelegen <span className="normal-case tracking-normal">(minuten, optioneel)</span>
          </label>
          <input
            id="sleep-awake"
            className="input tabular-nums"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            placeholder="bijv. 20"
            maxLength={5}
            value={awake}
            onChange={(e) => edit(setAwake)(e.target.value)}
          />
        </div>

        <dl className="grid grid-cols-2 gap-2 text-sm" aria-live="polite">
          <div className="rounded-xl bg-surface-2 px-3 py-2">
            <dt className="text-xs text-muted">In bed</dt>
            <dd className="font-semibold tabular-nums">{formatSleepDuration(inBed)}</dd>
          </div>
          <div className="rounded-xl bg-surface-2 px-3 py-2">
            <dt className="text-xs text-muted">Geslapen</dt>
            <dd className="font-semibold tabular-nums text-accent">{asleep != null && asleep > 0 ? formatSleepDuration(asleep) : "–"}</dd>
          </div>
        </dl>
        <p className="-mt-3 text-xs text-muted">
          Ligt je bedtijd later op de klok dan je wektijd, dan rekenen we die tot de avond ervoor. Dutjes overdag tellen niet mee.
        </p>

        {raw.error && !raw.data ? <p className="text-xs text-warn">Kon de bestaande invoer niet laden. Opslaan werkt wel.</p> : null}

        {error && (
          <div role="alert" className="space-y-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            <p>{error.text}</p>
            {error.reconsent && onReconsent && (
              <button type="button" className="btn-primary min-h-11 w-full text-xs" onClick={onReconsent}>
                Toestemming bijwerken
              </button>
            )}
          </div>
        )}

        <div className={`grid gap-2 ${manual ? "grid-cols-2" : "grid-cols-1"}`}>
          {manual && (
            <button type="button" className="btn-ghost" onClick={clear} disabled={!!busy} aria-busy={busy === "clear"}>
              {busy === "clear" ? "Bezig…" : "Wissen"}
            </button>
          )}
          <button type="submit" className="btn-primary" disabled={!!busy} aria-busy={busy === "save"}>
            {busy === "save" ? "Opslaan…" : "Opslaan"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
