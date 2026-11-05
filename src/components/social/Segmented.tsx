"use client";

import { useRef } from "react";

export type SegmentedOption<T extends string | number> = {
  value: T;
  label: React.ReactNode;
  /** Toegankelijke naam als het label alleen een getal of icoon is. */
  ariaLabel?: string;
};

/**
 * Keuzerij volgens het ARIA-radiogroup-patroon: één tabstop (de gekozen optie), pijltjes, Home en
 * End verplaatsen en kiezen meteen.
 */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  labelledBy,
  className = "",
  itemClassName = "",
}: {
  value: T | "" | null | undefined;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  labelledBy: string;
  className?: string;
  itemClassName?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const checked = options.findIndex((o) => o.value === value);
  const tabStop = checked >= 0 ? checked : 0;

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const n = options.length;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % n;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={`rounded-xl border border-line bg-surface-2 p-1 ${className}`}>
      {options.map((o, i) => {
        const on = i === checked;
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.ariaLabel}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`rounded-lg py-1.5 text-sm transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
              on ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
            } ${itemClassName}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
