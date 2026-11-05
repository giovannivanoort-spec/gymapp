"use client";

import Link from "next/link";
import { useState } from "react";
import { RankBadge } from "@/components/RankBadge";
import { formatDate } from "@/lib/dates";
import { exerciseName } from "@/lib/progress/records";
import type { RankEvent } from "@/lib/progress/rankHistory";

const PAGE = 5;

/** Tijdlijn van rangstijgingen ("Bench press: Goud → Platina, 12 okt"), nieuwste eerst. */
export function RankTimeline({ events, isMe = true }: { events: RankEvent[]; isMe?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  if (!events.length) return null;
  const shown = showAll ? events : events.slice(0, PAGE);
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Rangstijgingen</h2>
        <span className="text-xs tabular-nums text-muted">{events.length}× omhoog</span>
      </div>
      <div className="card p-0">
        <ol className="relative px-4 py-1">
          {/* Verticale lijn achter de badges. */}
          <span className="absolute bottom-5 left-[31px] top-5 w-px bg-line" aria-hidden />
          {shown.map((e, i) => {
            const name = e.slug ? exerciseName(e.slug) : "Totaalrang";
            const label = `${name}: ${e.from ? `${e.from.name} naar ` : "eerste rang "}${e.to.name}, ${formatDate(e.date, { weekday: undefined })}`;
            const body = (
              <>
                <RankBadge tierIndex={e.toIndex} size={32} className="relative shrink-0" />
                <span className="min-w-0 flex-1" aria-hidden>
                  <span className={`block truncate text-sm ${e.slug ? "font-semibold" : "font-extrabold"}`}>{name}</span>
                  <span className="block truncate text-xs text-muted">
                    {e.from ? (
                      <>
                        <span style={{ color: e.from.to }}>{e.from.name}</span> → <span style={{ color: e.to.to }}>{e.to.name}</span>
                      </>
                    ) : (
                      <>
                        {e.slug ? "Eerste rang: " : "Behaald: "}
                        <span style={{ color: e.to.to }}>{e.to.name}</span>
                      </>
                    )}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted" aria-hidden>
                  {formatDate(e.date, { weekday: undefined, month: "short" })}
                </span>
              </>
            );
            return (
              <li key={`${e.date}:${e.slug ?? "overall"}:${e.toIndex}`} className="animate-fade-up" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
                {e.slug ? (
                  <Link href={`/exercises/${e.slug}`} aria-label={label} className="flex items-center gap-3 py-2.5 transition hover:text-accent">
                    {body}
                  </Link>
                ) : (
                  <div role="group" aria-label={label} className="flex items-center gap-3 py-2.5">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {events.length > PAGE && (
          <div className="border-t border-line px-4 py-2">
            <button type="button" onClick={() => setShowAll((v) => !v)} className="btn-ghost w-full text-sm" aria-expanded={showAll}>
              {showAll ? "Minder tonen" : `Alle ${events.length} stijgingen tonen`}
            </button>
          </div>
        )}
      </div>
      <p className="text-xs text-muted">
        Teruggerekend uit {isMe ? "je" : "de"} trainingsgeschiedenis met {isMe ? "je" : "het"} huidige lichaamsgewicht.
      </p>
    </section>
  );
}
