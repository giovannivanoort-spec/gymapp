"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckIcon, ChevronRightIcon, CloseIcon } from "@/components/Icons";

const HIDE_KEY = "spotter:onboarding-hidden:v1";

function readHidden() {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

type Step = { done: boolean; title: string; hint: string } & ({ href: string } | { onClick: () => void });

/**
 * Checklist voor nieuwe gebruikers. Verdwijnt zodra alles gedaan is. `null` voor een stap betekent
 * dat de data nog laadt: dan tonen we niets (geen flikkerende checklist voor bestaande gebruikers).
 */
export function Onboarding({
  profileDone,
  hasGroup,
  hasFriend,
  hasTrained,
  trainHref,
  onGroup,
}: {
  profileDone: boolean;
  hasGroup: boolean | null;
  hasFriend: boolean | null;
  hasTrained: boolean | null;
  /** Waar je je eerste training kunt loggen (eerstvolgende training of je groep). */
  trainHref: string | null;
  onGroup: () => void;
}) {
  const [hidden, setHidden] = useState(readHidden);
  if (hidden) return null;
  if (hasGroup === null || hasFriend === null || hasTrained === null) return null;
  const steps: Step[] = [
    { done: profileDone, title: "Vul je profiel aan", hint: "Gewicht en geslacht, nodig voor je rang", href: "/profile" },
    { done: hasGroup, title: "Maak of join een groep", hint: "In een groep plant de trainer de trainingen", onClick: onGroup },
    { done: hasFriend, title: "Voeg een vriend toe", hint: "Zie elkaars trainingen en weekdoelen", href: "/friends" },
    trainHref
      ? { done: hasTrained, title: "Log je eerste training", hint: "Vul je sets in bij een training van je groep", href: trainHref }
      : { done: hasTrained, title: "Log je eerste training", hint: "Zodra je trainer een training plant, zie je die hier", onClick: onGroup },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;

  return (
    <section className="card animate-fade-up space-y-3" aria-labelledby="home-onboarding">
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-onboarding" className="font-bold">
          Aan de slag
        </h2>
        <div className="flex items-center gap-1">
          <span className="text-xs tabular-nums text-muted">
            {done} van {steps.length}
          </span>
          <button
            type="button"
            aria-label="Checklist verbergen"
            className="-my-2 -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-muted hover:text-ink"
            onClick={() => {
              setHidden(true);
              try {
                localStorage.setItem(HIDE_KEY, "1");
              } catch {
                // geen opslag: alleen voor nu verborgen
              }
            }}
          >
            <CloseIcon size={16} />
          </button>
        </div>
      </div>
      <div className="flex gap-1" aria-hidden>
        {steps.map((s, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${s.done ? "bg-accent" : "bg-surface-2"}`} />
        ))}
      </div>
      <ul className="-mx-2">
        {steps.map((s) => {
          const inner = (
            <>
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  s.done ? "bg-accent text-accent-ink" : "border border-line text-transparent"
                }`}
              >
                <CheckIcon size={14} strokeWidth={3} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-semibold ${s.done ? "text-muted line-through decoration-muted/60" : ""}`}>{s.title}</span>
                {!s.done && <span className="block truncate text-xs text-muted">{s.hint}</span>}
              </span>
              {!s.done && <ChevronRightIcon className="shrink-0 text-muted" />}
            </>
          );
          const cls = "flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-surface-2/60";
          return (
            <li key={s.title}>
              {s.done ? (
                <div className={cls.replace(" hover:bg-surface-2/60", "")}>
                  {inner}
                  <span className="sr-only">gedaan</span>
                </div>
              ) : "href" in s ? (
                <Link href={s.href} className={cls}>
                  {inner}
                </Link>
              ) : (
                <button type="button" onClick={s.onClick} className={cls}>
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
