"use client";

import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import { toast } from "@/components/ui/Toast";
import {
  ACTIVITY_LIMITS,
  activityErrorMessage,
  clearManualActivity,
  effectiveSteps,
  invalidateActivity,
  manualEntryDates,
  saveManualActivity,
  sourceLabel,
  sourceLine,
  validateManualEntry,
  type ActivitySource,
} from "@/lib/activity";
import { useCachedState } from "@/lib/cache";
import { formatDate, parseISODate, timeAgo } from "@/lib/dates";
import { isMissingSchemaError, supabase } from "@/lib/supabase";

/** Ruwe rij per bron (niet de effectieve view): nodig om je eigen handmatige invoer te tonen naast die van een toestel. */
type RawDay = {
  date: string;
  source: ActivitySource;
  steps: number | null;
  active_kcal: number | null;
  source_apps: string[];
  synced_at: string;
};

/** Zelfde volgorde als de view daily_activity_effective: welk toestel gaat voor. */
const PRIORITY: Record<ActivitySource, number> = { health_connect: 1, healthkit: 1, garmin: 2, shortcut: 3, manual: 9 };

/** Rij zonder bruikbare stappen (geen stappen, of 0 van Apple Health): komt in de view achteraan. */
const noSteps = (r: Pick<RawDay, "source" | "steps">) => effectiveSteps(r) == null;

/** Sorteert zoals de view: eerst rijen met stappen, dan op bron, dan de nieuwste. */
function byEffectiveOrder(a: RawDay, b: RawDay): number {
  return Number(noSteps(a)) - Number(noSteps(b)) || PRIORITY[a.source] - PRIORITY[b.source] || b.synced_at.localeCompare(a.synced_at);
}

async function fetchRawDays(userId: string, from: string, to: string): Promise<RawDay[]> {
  // Op jezelf filteren: RLS laat ook rijen zien van vrienden die delen.
  const { data, error } = await supabase
    .from("daily_activity")
    .select("date, source, steps, active_kcal, source_apps, synced_at")
    .eq("user_id", userId)
    .gte("date", from)
    .lte("date", to);
  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
  return ((data ?? []) as RawDay[]).map((r) => ({
    ...r,
    steps: r.steps == null ? null : Number(r.steps),
    active_kcal: r.active_kcal == null ? null : Number(r.active_kcal),
    source_apps: Array.isArray(r.source_apps) ? r.source_apps : [],
  }));
}

const fmt = (n: number) => Math.round(n).toLocaleString("nl-NL");

/** "8.500", "8 500" of "8500" → 8500. Leeg → null. Iets anders dan cijfers → NaN (geeft een melding). */
function parseCount(v: string): number | null {
  const s = v.replace(/[\s.]/g, "").replace(",", ".");
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Math.round(Number(s));
}

function dayLabel(iso: string, dates: string[]): string {
  if (iso === dates[0]) return "Vandaag";
  if (iso === dates[1]) return "Gisteren";
  return formatDate(iso);
}

/**
 * Stappen (en eventueel actieve kcal) handmatig invullen voor de afgelopen 7 dagen. Heeft een
 * dag al gegevens van een telefoon of horloge, dan staan die erbij: die gaan voor handmatige
 * invoer, maar invullen mag nog steeds (bijvoorbeeld als je horloge die dag niet om had).
 * Vereist toestemming om activiteit op te slaan; open het paneel alleen als die er is.
 */
export function ActivityEntrySheet({
  open,
  onClose,
  userId,
  date: initialDate,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  /** Voorgeselecteerde dag (YYYY-MM-DD); standaard vandaag. */
  date?: string;
}) {
  const dates = manualEntryDates();
  const from = dates[dates.length - 1];
  const to = dates[0];
  const raw = useCachedState(open && userId ? `activity:days:${userId}:raw:${from}:${to}` : null, () => fetchRawDays(userId, from, to), {
    maxAge: 30_000,
  });

  const [date, setDate] = useState(initialDate && dates.includes(initialDate) ? initialDate : to);
  const [steps, setSteps] = useState("");
  const [kcal, setKcal] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);

  const rows = raw.data ?? [];
  const forDay = rows.filter((r) => r.date === date);
  const manual = forDay.find((r) => r.source === "manual") ?? null;
  const device = forDay.filter((r) => r.source !== "manual").sort(byEffectiveOrder)[0] ?? null;
  const deviceSteps = effectiveSteps(device);
  // Telt je handmatige invoer voor deze dag (zelfde regel als de view)?
  const winner = [...forDay].sort(byEffectiveOrder)[0] ?? null;
  const deviceWins = !!device && winner?.source !== "manual" && deviceSteps != null;

  // Bij openen, een andere dag of zodra de bestaande invoer binnen is: velden vullen met wat er al
  // handmatig stond. Niet over iets heen schrijven dat je net zelf typte.
  const loaded = raw.data !== undefined;
  const [seen, setSeen] = useState({ open: false, date: "", loaded: false });
  if (open !== seen.open || date !== seen.date || loaded !== seen.loaded) {
    setSeen({ open, date, loaded });
    const fill = () => {
      setSteps(manual?.steps != null ? String(manual.steps) : "");
      setKcal(manual?.active_kcal != null ? String(manual.active_kcal) : "");
      setDirty(false);
      setError(null);
    };
    if (open && !seen.open) {
      const target = initialDate && dates.includes(initialDate) ? initialDate : to;
      // Andere dag: de volgende render (nieuwe datum) vult de velden.
      if (target !== date) setDate(target);
      else fill();
    } else if (open && (date !== seen.date || !dirty)) {
      fill();
    }
  }

  const hasData = new Set(rows.filter((r) => r.steps != null || r.active_kcal != null).map((r) => r.date));

  function close() {
    if (busy) return;
    setError(null);
    onClose();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const s = parseCount(steps);
    const k = parseCount(kcal);
    if (Number.isNaN(s) || Number.isNaN(k)) {
      setError("Vul alleen hele getallen in.");
      return;
    }
    const entry = { date, steps: s, active_kcal: k };
    const msg = validateManualEntry(entry);
    if (msg) {
      setError(msg);
      return;
    }
    setBusy("save");
    setError(null);
    try {
      await saveManualActivity(userId, entry);
      invalidateActivity(userId);
      toast.success(date === to ? "Stappen van vandaag opgeslagen" : `Stappen van ${dayLabel(date, dates).toLowerCase()} opgeslagen`);
      setDirty(false);
      onClose();
    } catch (err) {
      setError(activityErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    setError(null);
    try {
      await clearManualActivity(userId, date);
      invalidateActivity(userId);
      toast("Handmatige invoer gewist");
      setSteps("");
      setKcal("");
      setDirty(false);
      onClose();
    } catch (err) {
      setError(activityErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const chips = [...dates].reverse();

  return (
    <Sheet open={open} onClose={close} title="Stappen invoeren">
      <form className="space-y-5" onSubmit={save} noValidate>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="label mb-0" id="activity-day-label">
              Dag
            </span>
            <span className="text-sm font-semibold first-letter:uppercase">{dayLabel(date, dates)}</span>
          </div>
          <div role="radiogroup" aria-labelledby="activity-day-label" className="grid grid-cols-7 gap-1">
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
                  {hasData.has(d) && (
                    <span className={`absolute bottom-1 h-1 w-1 rounded-full ${on ? "bg-accent-ink" : "bg-accent"}`} aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {device && (
          <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-muted">{sourceLine(device)}</span>
              <span className="shrink-0 text-xs text-muted">{timeAgo(device.synced_at)}</span>
            </div>
            <p className="mt-1 font-semibold tabular-nums">
              {deviceSteps != null ? `${fmt(deviceSteps)} stappen` : "Geen stappen gemeten"}
              {device.active_kcal != null && <span className="font-normal text-muted"> · ~{fmt(device.active_kcal)} kcal actief</span>}
            </p>
            <p className="mt-1 text-xs text-muted">
              {deviceWins
                ? `Gegevens van ${sourceLabel(device.source)} gaan voor handmatige invoer. Wat je hier invult, telt alleen als er die dag geen stappen van ${sourceLabel(device.source)} zijn.`
                : `${sourceLabel(device.source)} heeft voor deze dag geen stappen. Wat je hier invult, telt mee.`}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="activity-steps" className="label">
              Stappen
            </label>
            <input
              id="activity-steps"
              className="input tabular-nums"
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="done"
              placeholder="bijv. 8500"
              value={steps}
              maxLength={7}
              aria-invalid={!!error || undefined}
              onChange={(e) => {
                setSteps(e.target.value);
                setDirty(true);
                if (error) setError(null);
              }}
            />
          </div>
          <div>
            <label htmlFor="activity-kcal" className="label">
              Actieve kcal <span className="normal-case tracking-normal">(optioneel)</span>
            </label>
            <input
              id="activity-kcal"
              className="input tabular-nums"
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="done"
              placeholder="bijv. 350"
              value={kcal}
              maxLength={6}
              onChange={(e) => {
                setKcal(e.target.value);
                setDirty(true);
                if (error) setError(null);
              }}
            />
          </div>
        </div>
        <p className="-mt-2 text-xs text-muted">
          Stappen tot {fmt(ACTIVITY_LIMITS.steps.max)}, actieve kcal tot {fmt(ACTIVITY_LIMITS.activeKcal.max)}. Actieve kcal zijn
          alleen de calorieën door beweging, zonder je ruststofwisseling.
        </p>

        {raw.error && !raw.data ? (
          <p className="text-xs text-warn">Kon de bestaande invoer niet laden. Opslaan werkt wel.</p>
        ) : null}

        {error && (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
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

/** Zelfde paneel onder een tweede naam. */
export { ActivityEntrySheet as ManualEntrySheet };
