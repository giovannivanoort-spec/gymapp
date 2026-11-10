"use client";

import { useEffect, useId, useRef } from "react";
import { ESTIMATE_TEXT_MAX as TEXT_MAX, ESTIMATE_TEXT_MIN as TEXT_MIN } from "@/lib/nutrition/estimate";
import { SparkleIcon } from "../Icons";

/**
 * Beschrijven wat je at, zonder foto: tekstveld met teller en de knop Schatten. Houdt het hele blok
 * (veld, knop, voortgang) boven het toetsenbord in beeld.
 */
export function DescribeInput({
  value,
  onChange,
  onSubmit,
  busy,
  limitReached,
  autoFocus,
  footer,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  /** Vandaag geen beschrijvingen meer: knop dicht. */
  limitReached: boolean;
  autoFocus?: boolean;
  /** Onder de knop, binnen het blok dat boven het toetsenbord in beeld blijft (bijv. Annuleren). */
  footer?: React.ReactNode;
}) {
  const uid = useId();
  const block = useRef<HTMLDivElement>(null);
  /** Opruimen van het animatieframe en de viewport-luisteraar (bij blur, versturen of unmount). */
  const stopKeepVisible = useRef<(() => void) | null>(null);
  const tooShort = value.trim().length < TEXT_MIN;

  useEffect(() => () => stopKeepVisible.current?.(), []);

  /**
   * Het paneel (Sheet) schuift zelf boven het toetsenbord en scrolt bij elke wijziging van het
   * zichtbare deel (visualViewport) het actieve veld in beeld, maar niet de knop eronder. Wij schuiven
   * daarna het hele blok in beeld, in hetzelfde animatieframe en zonder animatie: de Sheet vraagt zijn
   * frame eerder aan (zijn luisteraar staat er eerder), dus beide scrolls landen samen in één stap in
   * plaats van twee zichtbare sprongen. "nearest" scrolt alleen als er iets buiten beeld valt.
   */
  function keepVisible() {
    stopKeepVisible.current?.();
    const vv = window.visualViewport;
    let frame = 0;
    const reveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => block.current?.scrollIntoView({ block: "nearest" }));
    };
    // Direct ook een keer: staat het toetsenbord al open (focus vanaf een ander veld), dan komt er geen resize.
    reveal();
    vv?.addEventListener("resize", reveal);
    stopKeepVisible.current = () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", reveal);
      stopKeepVisible.current = null;
    };
  }

  function submit() {
    if (busy || limitReached || tooShort) return;
    // Het veld gaat dicht (een uitgeschakeld veld krijgt niet altijd een blur): luisteraar opruimen.
    stopKeepVisible.current?.();
    onSubmit();
  }

  return (
    <div ref={block} className="space-y-2 scroll-mb-4">
      <div>
        <label className="label" htmlFor={`${uid}-text`}>
          Wat at je?
        </label>
        <textarea
          id={`${uid}-text`}
          className="input min-h-24 resize-none leading-snug"
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={keepVisible}
          onBlur={() => stopKeepVisible.current?.()}
          autoFocus={autoFocus}
          placeholder="bijv. 2 volkoren boterhammen met pindakaas en een banaan"
          maxLength={TEXT_MAX}
          aria-describedby={`${uid}-count`}
          disabled={busy}
        />
        <p id={`${uid}-count`} className="mt-1 text-right text-[11px] text-muted tabular-nums">
          {value.length}/{TEXT_MAX}
        </p>
      </div>
      <button type="button" className="btn-primary w-full py-3" onClick={submit} disabled={busy || limitReached || tooShort}>
        <SparkleIcon /> {busy ? "Bezig met schatten…" : limitReached ? "Daglimiet bereikt" : "Schatten"}
      </button>
      {busy && (
        <p role="status" className="animate-fade-in flex items-center justify-center gap-2 text-xs text-muted">
          <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Claude leest je beschrijving…
        </p>
      )}
      {footer}
    </div>
  );
}
