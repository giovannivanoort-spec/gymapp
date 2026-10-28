"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { BodyMap } from "@/components/BodyMap";
import { RankBadge } from "@/components/RankBadge";
import { useRanks } from "@/lib/useRanks";
import { ExerciseFilter } from "@/components/ExerciseFilter";
import { MuscleChips } from "@/components/MuscleChips";
import { EQUIPMENT_LABEL } from "@/lib/exercise-types";
import { EXERCISES } from "@/lib/exercises";
import { ageFrom } from "@/lib/dates";

export default function ExercisesPage() {
  const userId = useUserId();
  const { profile } = useAuth();
  const data = useRanks(userId, profile?.bodyweight_kg ?? null, profile?.sex ?? null, ageFrom(profile?.birth_date));
  const rankBySlug = new Map((data?.ranks ?? []).map((r) => [r.slug, r]));

  return (
    <AppShell title={`Oefeningen (${EXERCISES.length})`}>
      <ExerciseFilter>
        {(list) => (
          <ul className="space-y-2">
            {list.map((e, i) => (
              <li key={e.slug} className="animate-fade-up" style={{ "--i": Math.min(i, 10) } as React.CSSProperties}>
                <Link href={`/exercises/${e.slug}`} className="card flex items-center gap-3 p-3 hover:border-muted">
                  <BodyMap primary={e.primary} secondary={e.secondary} labels={false} className="w-20 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold leading-tight">{e.name}</p>
                      {rankBySlug.get(e.slug) && (
                        <RankBadge tierIndex={rankBySlug.get(e.slug)!.tierIndex} size={24} className="shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted">{EQUIPMENT_LABEL[e.equipment]}</p>
                    <MuscleChips primary={e.primary} secondary={e.secondary} limit={4} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </ExerciseFilter>
    </AppShell>
  );
}
