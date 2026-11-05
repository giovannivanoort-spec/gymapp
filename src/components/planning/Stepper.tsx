"use client";

/** Compacte −/+ teller (geen toetsenbord nodig), knoppen van 44px voor de duim. */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 20,
  label,
  id,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  /** Toegankelijke naam, bijv. "Sets voor Bench press". */
  label: string;
  id?: string;
  /** Klein woord achter het getal, bijv. "sets" (dan is een los label niet nodig). */
  suffix?: string;
}) {
  const btn =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-lg font-semibold text-ink transition hover:bg-surface active:scale-90 disabled:opacity-30";
  return (
    <div id={id} role="group" aria-label={label} className="flex h-[46px] items-center rounded-xl border border-line bg-surface-2 p-0.5">
      <button type="button" className={btn} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Minder">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
          <path d="M5 12h14" strokeLinecap="round" />
        </svg>
      </button>
      <output aria-live="polite" className="min-w-0 flex-1 text-center text-base font-bold tabular-nums">
        {value}
        {suffix && <span className="ml-1 text-xs font-medium text-muted">{suffix}</span>}
      </output>
      <button type="button" className={btn} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Meer">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
