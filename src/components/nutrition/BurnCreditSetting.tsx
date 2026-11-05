"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Segmented } from "@/components/social/Segmented";
import { toast } from "@/components/ui/Toast";
import { activityErrorMessage, expectedActiveKcal, saveActivitySettings, useActivitySettings } from "@/lib/activity";
import { fmt } from "@/lib/nutrition/format";
import type { Targets } from "@/lib/nutrition/targets";

/** Standaard als je het aanzet: halverwege, omdat horloges calorieën vaak overschatten. */
const DEFAULT_ON_PCT = 50;
const PCT_OPTIONS = [25, 50, 75, 100] as const;
/** Pijltjes of snel tikken door de opties: pas opslaan als de keuze zo lang stilstaat. */
const SAVE_DELAY = 500;

/**
 * "Calorieën terugverdienen": welk deel van je beweging bóven je gekozen activiteitsniveau bij je
 * dagdoel komt. Staat standaard uit. Kan alleen aan met toestemming voor activiteit (Koppelingen) en
 * als rust- en dagverbruik bekend zijn. Slaat direct op (los van de knop "Voedingsdoelen opslaan").
 * Toont niets zolang upgrade-activity.sql nog niet is gedraaid.
 */
export function BurnCreditSetting({ targets }: { targets: Targets | null }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const st = useActivitySettings(userId);
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const labelId = useId();
  const descId = useId();
  const pctId = useId();
  /** Laatst gekozen, nog niet opgeslagen waarde. Een nieuwe keuze vervangt hem (nooit weggooien). */
  const queued = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);
  /** Wat de server nu heeft (voor "niets veranderd, niet opslaan"). */
  const savedRef = useRef<number | null>(null);
  const savedNow = st.data?.burn_credit_pct ?? null;
  useEffect(() => {
    savedRef.current = savedNow;
  }, [savedNow]);

  async function flush() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // Loopt er al een opslag, dan pakt die na afloop de nieuwste keuze op.
    if (inflight.current || !userId) return;
    const value = queued.current;
    queued.current = null;
    if (value == null) return;
    if (value === savedRef.current) {
      setPending(null);
      return;
    }
    inflight.current = true;
    setBusy(true);
    try {
      const next = await saveActivitySettings(userId, { burnCreditPct: value });
      savedRef.current = next.burn_credit_pct;
    } catch (err) {
      toast.error(activityErrorMessage(err));
    } finally {
      inflight.current = false;
      if (queued.current != null) {
        void flush();
      } else {
        setPending(null);
        setBusy(false);
      }
    }
  }

  function choose(next: number, delay: number) {
    queued.current = next;
    setPending(next);
    if (timer.current) clearTimeout(timer.current);
    if (delay <= 0) void flush();
    else timer.current = setTimeout(() => void flush(), delay);
  }

  // Weg van de pagina met een keuze die nog wacht: alsnog opslaan.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(
    () => () => {
      if (timer.current) void flushRef.current();
    },
    [],
  );

  const s = st.data;
  if (!userId || (s && !s.available)) return null;
  if (!s) {
    return <div className="skeleton h-20 rounded-xl" aria-hidden />;
  }

  const saved = s.burn_credit_pct;
  const pct = pending ?? saved;
  const on = pct > 0;
  const expected = expectedActiveKcal(targets);
  const blocked = !s.consented ? "consent" : expected == null ? "profile" : null;
  // Uitzetten kan altijd; aanzetten alleen als het kan.
  const canToggle = on || !blocked;

  return (
    <div id="calorieen-terugverdienen" className="scroll-mt-20 space-y-3 rounded-xl border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id={labelId} className="text-sm font-semibold">
            Calorieën terugverdienen
          </p>
          <p id={descId} className="text-xs text-muted">
            Beweeg je op een dag meer dan je gekozen activiteitsniveau, dan komt een deel daarvan bij je dagdoel (als koolhydraten).
            Alleen beweging bóven je gekozen activiteitsniveau telt mee; horloges schatten calorieën vaak 25–30% verkeerd.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          aria-describedby={descId}
          aria-busy={busy}
          disabled={!canToggle}
          onClick={() => choose(on ? 0 : DEFAULT_ON_PCT, 0)}
          className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 ${
            on ? "bg-accent" : "bg-surface-2 ring-1 ring-line"
          }`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full shadow transition-all duration-200 motion-reduce:transition-none ${
              on ? "left-6 bg-accent-ink" : "left-1 bg-muted"
            } ${busy ? "animate-pulse" : ""}`}
          />
        </button>
      </div>

      {on && (
        <div className="animate-fade-up space-y-1">
          <span className="label" id={pctId}>
            Deel van je extra beweging
          </span>
          <Segmented
            labelledBy={pctId}
            value={pct}
            onChange={(v) => choose(v, SAVE_DELAY)}
            options={PCT_OPTIONS.map((v) => ({ value: v, label: `${v}%` }))}
            className="grid grid-cols-4 gap-1"
            itemClassName="min-h-11 font-semibold tabular-nums"
          />
        </div>
      )}

      {blocked === "consent" ? (
        <p className="text-xs text-muted">
          Zet eerst{" "}
          <a href="#koppelingen" className="font-semibold text-accent">
            Activiteit bijhouden
          </a>{" "}
          aan bij Koppelingen.
        </p>
      ) : blocked === "profile" ? (
        <p className="text-xs text-muted">Vul je gewicht, lengte, geboortedatum en geslacht in om dit te gebruiken.</p>
      ) : (
        expected != null && (
          <p className="text-xs text-muted">
            Je dagdoel rekent al met ongeveer <span className="font-semibold text-ink tabular-nums">{fmt(expected)} kcal</span> beweging per
            dag. {on ? `Daarboven telt ${pct}% mee, met een maximum van 1.000 kcal per dag.` : "Staat uit: je doel verandert niet."}
          </p>
        )
      )}
    </div>
  );
}
