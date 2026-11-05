"use client";

import Link from "next/link";
import { ChevronRightIcon } from "@/components/Icons";
import { RankBadge, TierProgress } from "@/components/RankBadge";
import { exerciseName } from "@/lib/progress/records";
import { exampleSetFor, TIERS, type ExerciseRank } from "@/lib/ranks";

const nl = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

/** Wat er nog nodig is voor de volgende tier, als concreet doel ("nog 4 kg · bijv. 85 kg × 5"). */
export function nextTierGoal(r: ExerciseRank): { gap: string; example: string | null } | null {
  if (r.nextAt == null) return null;
  if (r.unit === "reps") {
    const gap = Math.max(1, Math.ceil(r.nextAt - r.value));
    return { gap: `nog ${gap} ${gap === 1 ? "rep" : "reps"}`, example: `${r.nextAt} reps in één set` };
  }
  const gap = Math.max(0.5, Math.ceil((r.nextAt - r.value) * 2) / 2);
  if (r.viaAdded) return { gap: `nog ${nl(gap)} kg`, example: `1RM met +${Math.ceil(r.nextAt)} kg extra` };
  return { gap: `nog ${nl(gap)} kg 1RM`, example: exampleSetFor(r.nextAt).replace(".", ",") };
}

/**
 * De oefeningen die het dichtst bij hun volgende tier zitten, met de set die daarvoor nodig is.
 * Handig voor de trainer: dit zijn de liften om in de volgende groepstraining op te pushen.
 */
export function NextTierCard({ ranks, title = "Dichtst bij de volgende tier" }: { ranks: ExerciseRank[]; title?: string }) {
  if (!ranks.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <ul className="card divide-y divide-line overflow-hidden p-0">
        {ranks.map((r, i) => {
          const goal = nextTierGoal(r);
          const next = TIERS[r.tierIndex + 1];
          return (
            <li key={r.slug} className="animate-fade-up" style={{ "--i": i } as React.CSSProperties}>
              <Link
                href={`/exercises/${r.slug}`}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-2 active:bg-surface-2"
                aria-label={`${exerciseName(r.slug)}: ${Math.round(r.progress * 100)}% naar ${next.name}${goal ? `, ${goal.gap}` : ""}${goal?.example ? `, bijvoorbeeld ${goal.example}` : ""}`}
              >
                <RankBadge tierIndex={r.tierIndex} size={34} className="shrink-0" />
                <span className="min-w-0 flex-1 space-y-1.5" aria-hidden>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{exerciseName(r.slug)}</span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums">
                      <span style={{ color: r.tier.to }}>{r.tier.name}</span>
                      <span className="text-muted"> → </span>
                      <span style={{ color: next.to }}>{next.name}</span>
                    </span>
                  </span>
                  <TierProgress tierIndex={r.tierIndex} progress={r.progress} />
                  {goal && (
                    <span className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="font-semibold text-ink">{goal.gap}</span>
                      {goal.example && <span className="truncate text-muted">bijv. {goal.example}</span>}
                    </span>
                  )}
                </span>
                <ChevronRightIcon size={14} className="shrink-0 text-muted" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
