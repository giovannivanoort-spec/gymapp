"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { RankBadge, TierProgress } from "@/components/RankBadge";
import { ExerciseRankRow } from "@/components/RankRow";
import { groupName, TIERS } from "@/lib/ranks";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";
import { useRanks } from "@/lib/useRanks";
import { ageFrom } from "@/lib/dates";

export default function RanksPage() {
  return (
    <Suspense>
      <Ranks />
    </Suspense>
  );
}

/** Ranks van jezelf, of met ?user=<id> van een groepslid. */
function Ranks() {
  const params = useSearchParams();
  const me = useUserId();
  const { profile: myProfile } = useAuth();
  const userId = params.get("user") ?? me;
  const isMe = userId === me;
  const [other, setOther] = useState<Profile | null>(null);

  useEffect(() => {
    if (isMe) return;
    supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single()
      .then(({ data }) => setOther(data));
  }, [isMe, userId]);

  const profile = isMe ? myProfile : other;
  const data = useRanks(userId, profile?.bodyweight_kg ?? null, profile?.sex ?? null, ageFrom(profile?.birth_date));
  const missingProfile = profile && (!profile.bodyweight_kg || !profile.sex);

  return (
    <AppShell title={isMe ? "Mijn ranks" : `Ranks van ${profile?.display_name ?? "…"}`} back>
      {missingProfile ? (
        <div className="card space-y-3 text-sm">
          <p className="font-semibold">{isMe ? "Vul eerst je profiel aan" : "Nog geen ranks"}</p>
          <p className="text-muted">
            Ranks vergelijken je kracht met anderen van hetzelfde geslacht en lichaamsgewicht.
            {isMe ? " Daarvoor hebben we je lichaamsgewicht en geslacht nodig." : " Dit lid heeft zijn of haar profiel nog niet aangevuld."}
          </p>
          {isMe && (
            <Link href="/profile" className="btn-primary w-full">
              Profiel aanvullen
            </Link>
          )}
        </div>
      ) : !data ? (
        <div className="space-y-3">
          <div className="skeleton h-48" />
          <div className="skeleton h-24" />
          <div className="skeleton h-24" />
        </div>
      ) : data.ranks.length === 0 ? (
        <div className="card space-y-2 text-sm text-muted">
          <p className="font-semibold text-ink">Nog geen ranks</p>
          <p>Log sets met gewicht en reps (maximaal 12 reps) bij oefeningen zoals bench press, squat of curls, dan verschijnt hier je rang.</p>
        </div>
      ) : (
        <div className="space-y-7">
          {data.overall && (
            <section className="card animate-scale-in relative overflow-hidden text-center">
              <div
                className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-48 rounded-full opacity-30 blur-3xl"
                style={{ background: data.overall.tier.from }}
              />
              <RankBadge tierIndex={TIERS.indexOf(data.overall.tier)} size={112} glow className="animate-badge-reveal relative mx-auto" />
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted">Totaalrang</p>
              <h2 className="text-3xl font-black tracking-tight" style={{ color: data.overall.tier.to }}>
                {data.overall.tier.name}
              </h2>
              <div className="mx-auto mt-4 max-w-xs space-y-1.5">
                <TierProgress tierIndex={TIERS.indexOf(data.overall.tier)} progress={data.overall.score % 1} />
                <p className="text-xs text-muted">
                  {data.overall.score >= TIERS.length - 1
                    ? "Hoogste rang behaald"
                    : `${Math.round((data.overall.score % 1) * 100)}% naar ${TIERS[Math.floor(data.overall.score) + 1].name}`}
                </p>
              </div>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Per spiergroep</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {data.groups.map((g, i) => (
                <div key={g.group} className="card animate-fade-up flex items-center gap-3 p-3" style={{ "--i": i } as React.CSSProperties}>
                  <RankBadge tierIndex={TIERS.indexOf(g.tier)} size={36} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{groupName(g.group)}</p>
                    <p className="text-xs" style={{ color: g.tier.to }}>
                      {g.tier.name}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Per oefening</h2>
            <ul className="space-y-2">
              {data.ranks.map((r, i) => (
                <ExerciseRankRow key={r.slug} rank={r} index={i} />
              ))}
            </ul>
          </section>

          <p className="text-center text-xs text-muted">
            Rang op basis van je geschatte 1RM ten opzichte van krachtstandaarden per oefening, geslacht en lichaamsgewicht
            (bron: StrengthLevel.com). Bij dumbbells telt het gewicht per dumbbell.
          </p>
        </div>
      )}
    </AppShell>
  );
}
