"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { ChevronRightIcon } from "@/components/Icons";
import { RankBadge, TierProgress } from "@/components/RankBadge";
import { ageFrom } from "@/lib/dates";
import { exerciseName } from "@/lib/progress/records";
import { closestToNextTier, tierProgress, TIERS } from "@/lib/ranks";
import { useRanks } from "@/lib/useRanks";
import { nextTierGoal } from "./NextTierCard";

/** Compacte totaalrang op het Overzicht, met het dichtstbijzijnde doel; tikt door naar Ranks. */
export function RankSummaryCard() {
  const userId = useUserId();
  const { profile } = useAuth();
  const data = useRanks(userId, profile?.bodyweight_kg ?? null, profile?.sex ?? null, ageFrom(profile?.birth_date));
  const next = useMemo(() => (data ? (closestToNextTier(data.ranks, 1)[0] ?? null) : null), [data]);

  if (!profile) return null;
  if (!profile.bodyweight_kg || !profile.sex) {
    return (
      <Link href="/profile" className="card flex items-center gap-3 p-4 text-sm hover:border-muted">
        <RankBadge tierIndex={0} size={40} className="shrink-0 opacity-50 grayscale" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Ranks vrijspelen</span>
          <span className="block text-xs text-muted">Vul je lichaamsgewicht en geslacht in om je kracht te vergelijken.</span>
        </span>
        <ChevronRightIcon className="shrink-0 text-muted" />
      </Link>
    );
  }
  const overall = data?.overall;
  if (!overall) return null;
  const tierIndex = TIERS.indexOf(overall.tier);
  const progress = tierProgress(overall.score);
  const top = tierIndex >= TIERS.length - 1;
  const goal = next ? nextTierGoal(next) : null;

  return (
    <Link
      href="/ranks"
      className="card animate-fade-up flex items-center gap-3 p-4 hover:border-muted"
      aria-label={`Totaalrang ${overall.tier.name}${overall.provisional ? " (voorlopig)" : ""}. Naar ranks`}
    >
      <RankBadge tierIndex={tierIndex} size={48} className="shrink-0" />
      <span className="min-w-0 flex-1 space-y-1.5" aria-hidden>
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Totaalrang </span>
            <span className="font-extrabold" style={{ color: overall.tier.to }}>
              {overall.tier.name}
            </span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted">
            {overall.provisional ? "voorlopig" : top ? "hoogste" : `${Math.round(progress * 100)}%`}
          </span>
        </span>
        <TierProgress tierIndex={tierIndex} progress={progress} />
        {next && goal && (
          <span className="block truncate text-xs text-muted">
            Dichtstbij: <span className="font-semibold text-ink">{exerciseName(next.slug)}</span> naar {TIERS[next.tierIndex + 1].name},{" "}
            {goal.gap}
          </span>
        )}
      </span>
      <ChevronRightIcon className="shrink-0 text-muted" />
    </Link>
  );
}
