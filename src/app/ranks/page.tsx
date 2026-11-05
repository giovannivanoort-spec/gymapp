"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useDeferredValue, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { ChevronRightIcon, CloseIcon } from "@/components/Icons";
import { LoadError } from "@/components/platform/LoadError";
import { CompareStrip } from "@/components/progress/CompareStrip";
import { NextTierCard } from "@/components/progress/NextTierCard";
import { OverallPromotion } from "@/components/progress/OverallPromotion";
import { OverallTrend } from "@/components/progress/OverallTrend";
import { RankTimeline } from "@/components/progress/RankTimeline";
import { RankBadge, TierProgress } from "@/components/RankBadge";
import { ExerciseRankRow } from "@/components/RankRow";
import { ageFrom } from "@/lib/dates";
import type { MuscleGroupId } from "@/lib/muscles";
import { rankReplay } from "@/lib/progress/rankHistory";
import { boardFor, useComparePeople, useGroupBoard } from "@/lib/progress/groupBoard";
import { exerciseName } from "@/lib/progress/records";
import { useSafeCached } from "@/lib/progress/safeCache";
import {
  closestToNextTier,
  compareGroups,
  groupName,
  MAJOR_GROUPS,
  MIN_OVERALL_GROUPS,
  rankableExercisesFor,
  tierProgress,
  TIERS,
  type ExerciseRank,
  type GroupRank,
  type OverallRank,
} from "@/lib/ranks";
import { fetchPublicProfile } from "@/lib/supabase";
import type { Profile } from "@/lib/types";
import { useRanksState } from "@/lib/useRanks";

export default function RanksPage() {
  return (
    <Suspense
      fallback={
        <AppShell title="Ranks" back>
          <RanksSkeleton />
        </AppShell>
      }
    >
      <Ranks />
    </Suspense>
  );
}

function RanksSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Ranks laden">
      <div className="skeleton h-56" />
      <div className="grid grid-cols-2 gap-2">
        <div className="skeleton h-16" />
        <div className="skeleton h-16" />
      </div>
      <div className="skeleton h-24" />
      <div className="skeleton h-24" />
    </div>
  );
}

/** Andermans profiel: alleen de publieke kolommen (voedingsdoelen blijven privé). */
function fetchProfile(id: string): Promise<Profile | null> {
  return fetchPublicProfile(id);
}

type SortMode = "rank" | "diff";

/** Ranks van jezelf, of met ?user=<id> van een groepslid of vriend (met jouw rang ernaast). */
function Ranks() {
  const params = useSearchParams();
  const me = useUserId();
  const { profile: myProfile } = useAuth();
  const userId = params.get("user") ?? me;
  const isMe = userId === me;
  const [groupFilter, setGroupFilter] = useState<{ user: string; group: MuscleGroupId } | null>(null);
  const [sort, setSort] = useState<SortMode>("rank");

  // Profiel van iemand anders per id onthouden: bij wisselen tussen personen nooit het vorige profiel gebruiken.
  const other = useSafeCached(isMe ? null : `ranks:profile:${userId}`, () => fetchProfile(userId), { persist: true, maxAge: 60_000 });
  const profile = isMe ? myProfile : (other.data ?? null);
  const profileLoading = !isMe && other.data === undefined;

  const state = useRanksState(userId, profile?.bodyweight_kg ?? null, profile?.sex ?? null, ageFrom(profile?.birth_date));
  const data = state.data;
  // Jouw eigen ranks om naast die van een ander te zetten.
  const mineState = useRanksState(
    isMe ? null : me,
    myProfile?.bodyweight_kg ?? null,
    myProfile?.sex ?? null,
    ageFrom(myProfile?.birth_date),
  );
  const mine = mineState.data;
  const myBySlug = useMemo(() => new Map((mine?.ranks ?? []).map((r) => [r.slug, r])), [mine]);
  const myByGroup = useMemo(() => new Map((mine?.groups ?? []).map((g) => [g.group, g])), [mine]);
  const canCompare = !isMe && !!mine && !!myProfile?.bodyweight_kg && !!myProfile.sex;
  // Op je eigen ranks: per oefening een kleine ranglijst van je vrienden en groepsgenoten.
  const { people } = useComparePeople(isMe ? me : null);
  const board = useGroupBoard(isMe ? me : null, people);

  const filter = groupFilter?.user === userId ? groupFilter.group : null;
  const sortMode: SortMode = canCompare ? sort : "rank";
  const shownRanks: ExerciseRank[] = useMemo(() => {
    if (!data) return [];
    const list = filter ? (data.groups.find((g) => g.group === filter)?.exercises ?? []) : data.ranks;
    if (sortMode !== "diff") return list;
    // Grootste verschil eerst; oefeningen waar jij (nog) geen rang hebt achteraan.
    const delta = (r: ExerciseRank) => {
      const m = myBySlug.get(r.slug);
      return m ? Math.abs(m.score - r.score) : -1;
    };
    return [...list].sort((a, b) => delta(b) - delta(a));
  }, [data, filter, sortMode, myBySlug]);

  const closest = useMemo(() => (data ? closestToNextTier(data.ranks, 3) : []), [data]);
  // De tijdlijn en het verloop worden teruggerekend uit de hele geschiedenis: met een uitgestelde
  // waarde staat de rest van de pagina eerst op het scherm (en het resultaat wordt onthouden).
  const deferredData = useDeferredValue(data);
  const replay = useMemo(
    () =>
      deferredData
        ? rankReplay(deferredData.history, profile?.bodyweight_kg ?? null, profile?.sex ?? null, ageFrom(profile?.birth_date))
        : null,
    [deferredData, profile?.bodyweight_kg, profile?.sex, profile?.birth_date],
  );
  const untrained = useMemo(() => {
    if (!data) return [];
    const trained = new Set(data.groups.map((g) => g.group));
    return MAJOR_GROUPS.filter((g) => !trained.has(g));
  }, [data]);

  const firstName = profile?.display_name?.split(" ")[0] ?? "";
  const title = isMe ? "Mijn ranks" : profile ? `Ranks van ${firstName}` : "Ranks";
  const missingProfile = isMe ? !profile?.bodyweight_kg || !profile?.sex : !!profile && (!profile.bodyweight_kg || !profile.sex);

  return (
    <AppShell title={title} back>
      {!isMe && other.error && other.data === undefined ? (
        <LoadError error={other.error} onRetry={other.retry} title="Kon profiel niet laden" />
      ) : !isMe && other.data === null ? (
        <div className="card space-y-2 text-sm">
          <p className="font-semibold">Profiel niet gevonden</p>
          <p className="text-muted">
            Dit profiel bestaat niet of je kunt het niet bekijken. Je ziet alleen de ranks van vrienden en groepsleden.
          </p>
          <Link href="/ranks" className="btn-ghost w-full">
            Naar mijn ranks
          </Link>
        </div>
      ) : profileLoading ? (
        <RanksSkeleton />
      ) : state.status === "error" ? (
        <LoadError
          error={state.error}
          onRetry={state.retry}
          retrying={state.refreshing}
          title={isMe ? "Kon je trainingen niet laden" : `Kon de trainingen van ${firstName || "dit lid"} niet laden`}
        />
      ) : !data ? (
        <RanksSkeleton />
      ) : missingProfile ? (
        <div className="card space-y-3 text-sm">
          <p className="font-semibold">{isMe ? "Vul eerst je profiel aan" : "Nog geen ranks"}</p>
          <p className="text-muted">
            Ranks vergelijken je kracht met anderen van hetzelfde geslacht en lichaamsgewicht.
            {isMe
              ? " Daarvoor hebben we je lichaamsgewicht en geslacht nodig."
              : ` ${firstName || "Dit lid"} heeft het profiel nog niet aangevuld.`}
          </p>
          {isMe && (
            <Link href="/profile" className="btn-primary w-full">
              Profiel aanvullen
            </Link>
          )}
        </div>
      ) : data.ranks.length === 0 ? (
        <div className="space-y-7">
          <div className="card space-y-3 text-sm text-muted">
            <p className="font-semibold text-ink">Nog geen ranks</p>
            <p>
              {isMe
                ? "Log sets met gewicht en reps (maximaal 12 reps) bij oefeningen zoals bench press, squat of curls, dan verschijnt hier je rang."
                : `${firstName || "Dit lid"} heeft nog geen sets gelogd bij oefeningen met een rang.`}
            </p>
            {isMe && (
              <Link href="/exercises/bench-press" className="btn-ghost w-full">
                Bekijk wat je nodig hebt voor een rang
              </Link>
            )}
          </div>
          {isMe && <CompareStrip me={me} mine={null} />}
        </div>
      ) : (
        <div className="space-y-7">
          {state.error != null && (
            <LoadError compact error={state.error} onRetry={state.retry} retrying={state.refreshing} updatedAt={state.updatedAt} />
          )}

          {data.overall && (
            <OverallCard
              overall={data.overall}
              groups={data.groups}
              mine={canCompare ? (mine?.overall ?? null) : undefined}
              myGroups={mine?.groups ?? []}
              isMe={isMe}
            />
          )}
          {!isMe && mineState.status === "error" && (
            <LoadError
              compact
              error={mineState.error}
              onRetry={mineState.retry}
              retrying={mineState.refreshing}
              updatedAt={mineState.updatedAt}
              title="Jouw ranks konden niet laden"
            />
          )}

          {isMe && <OverallPromotion key={me} userId={me} overall={data.overall} />}
          {isMe && <CompareStrip me={me} mine={data.overall} />}

          <NextTierCard ranks={closest} title={isMe ? "Dichtst bij de volgende tier" : `Volgende doelen van ${firstName || "dit lid"}`} />

          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Per spiergroep</h2>
              <span className="text-xs text-muted">tik om te filteren</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {data.groups.map((g, i) => {
                const active = filter === g.group;
                const myGroup = canCompare ? myByGroup.get(g.group) : undefined;
                return (
                  <button
                    type="button"
                    key={g.group}
                    onClick={() => setGroupFilter(active ? null : { user: userId, group: g.group })}
                    aria-pressed={active}
                    className={`card animate-fade-up flex items-center gap-3 p-3 text-left transition active:scale-[0.98] ${
                      active ? "border-accent/70 bg-surface-2" : "hover:border-muted"
                    }`}
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    <RankBadge tierIndex={TIERS.indexOf(g.tier)} size={36} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{groupName(g.group)}</span>
                      <span className="block text-xs" style={{ color: g.tier.to }}>
                        {g.tier.name}
                      </span>
                      {canCompare && (
                        <span className="block truncate text-[11px] text-muted">
                          Jij: {myGroup ? <span style={{ color: myGroup.tier.to }}>{myGroup.tier.name}</span> : "geen rang"}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
              {untrained.map((g, i) => (
                <UntrainedGroupCard key={g} group={g} isMe={isMe} index={data.groups.length + i} />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="min-w-0 truncate text-sm font-semibold uppercase tracking-wide text-muted">
                Per oefening{filter ? ` · ${groupName(filter)}` : ""}
              </h2>
              {filter && (
                <button
                  type="button"
                  onClick={() => setGroupFilter(null)}
                  className="animate-fade-in inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-semibold text-muted hover:text-ink"
                >
                  Alles tonen <CloseIcon size={12} />
                </button>
              )}
            </div>
            {canCompare && (
              <div
                className="flex rounded-xl border border-line bg-surface-2 p-0.5 text-xs font-semibold"
                role="group"
                aria-label="Sorteren"
              >
                {(
                  [
                    ["rank", "Op rang"],
                    ["diff", "Grootste verschil"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSort(id)}
                    aria-pressed={sortMode === id}
                    className={`min-w-0 flex-1 truncate rounded-[10px] px-2 py-1.5 transition ${
                      sortMode === id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <ul key={`${filter ?? "all"}:${sortMode}`} className="space-y-2">
              {shownRanks.map((r, i) => (
                <ExerciseRankRow
                  key={r.slug}
                  rank={r}
                  index={i}
                  compare={canCompare ? (myBySlug.get(r.slug) ?? null) : undefined}
                  board={isMe ? boardFor(r.slug, board, { id: me, rank: r }) : undefined}
                />
              ))}
            </ul>
          </section>

          {replay ? (
            <>
              <OverallTrend points={replay.overall} isMe={isMe} />
              <RankTimeline events={replay.events} isMe={isMe} />
            </>
          ) : (
            <div className="skeleton h-40" aria-busy="true" aria-label="Rangverloop berekenen" />
          )}

          {isMe && (
            <Link href="/progress?tab=oefeningen" className="card flex items-center justify-between gap-3 p-4 text-sm hover:border-muted">
              <span className="min-w-0">
                <span className="block font-semibold">Progressie per oefening</span>
                <span className="block text-xs text-muted">Grafieken, records en je trainingen over tijd</span>
              </span>
              <ChevronRightIcon className="shrink-0 text-muted" />
            </Link>
          )}

          <p className="text-center text-xs text-muted">
            Rang op basis van de geschatte 1RM ten opzichte van krachtstandaarden per oefening, geslacht, leeftijd en lichaamsgewicht (bron:
            StrengthLevel.com). Bij dumbbells telt het gewicht per dumbbell.
          </p>
        </div>
      )}
    </AppShell>
  );
}

/** Grote spiergroep zonder rang: gedimd, met een oefening waarmee je er wel een haalt. */
function UntrainedGroupCard({ group, isMe, index }: { group: MuscleGroupId; isMe: boolean; index: number }) {
  const suggestion = rankableExercisesFor(group, 1)[0];
  const inner = (
    <>
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-line text-[10px] font-bold text-muted"
        aria-hidden
      >
        –
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-muted">{groupName(group)}</span>
        <span className="block truncate text-xs text-muted">Nog geen rang</span>
        {isMe && suggestion && <span className="block truncate text-[11px] text-muted">bijv. {exerciseName(suggestion)}</span>}
      </span>
    </>
  );
  const cls = "card animate-fade-up flex items-center gap-3 border-dashed bg-transparent p-3 text-left opacity-80";
  const style = { "--i": index } as React.CSSProperties;
  return isMe && suggestion ? (
    <Link
      href={`/exercises/${suggestion}`}
      className={`${cls} transition hover:border-muted hover:opacity-100 active:scale-[0.98]`}
      style={style}
      aria-label={`${groupName(group)}: nog geen rang. Bekijk ${exerciseName(suggestion)}`}
    >
      {inner}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {inner}
    </div>
  );
}

function OverallCard({
  overall,
  groups,
  mine,
  myGroups,
  isMe,
}: {
  overall: OverallRank;
  groups: GroupRank[];
  mine: OverallRank | null | undefined;
  myGroups: GroupRank[];
  isMe: boolean;
}) {
  const tierIndex = TIERS.indexOf(overall.tier);
  const top = tierIndex >= TIERS.length - 1;
  const progress = tierProgress(overall.score);
  const coverage = overall.coverage;
  const provisional = !!overall.provisional;
  // Eerlijk vergelijken: alleen over spiergroepen die jullie allebei getraind hebben.
  const cmp = mine ? compareGroups(myGroups, groups) : null;
  const sameCoverage = !!cmp && cmp.shared === groups.length && cmp.shared === myGroups.length;
  return (
    <section className="card animate-scale-in relative overflow-hidden text-center">
      <div
        className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-48 rounded-full opacity-30 blur-3xl"
        style={{ background: overall.tier.from }}
      />
      <RankBadge
        tierIndex={tierIndex}
        size={112}
        glow={!provisional}
        className={`animate-badge-reveal relative mx-auto ${provisional ? "opacity-70 saturate-50" : ""}`}
      />
      <p className="mt-3 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted">
        Totaalrang
        {provisional && (
          <span className="rounded-md border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] tracking-wide text-warn">Voorlopig</span>
        )}
      </p>
      <h2 className="text-3xl font-black tracking-tight" style={{ color: overall.tier.to }}>
        {overall.tier.name}
      </h2>
      <div className="mx-auto mt-4 max-w-xs space-y-1.5">
        <TierProgress tierIndex={tierIndex} progress={progress} />
        <p className="text-xs text-muted">
          {top ? "Hoogste rang behaald" : `${Math.round(progress * 100)}% naar ${TIERS[tierIndex + 1].name}`}
        </p>
      </div>
      {coverage && (
        <p className="relative mx-auto mt-3 max-w-xs text-xs text-muted">
          Op basis van {coverage.groups} van {coverage.of} grote spiergroepen.
          {provisional
            ? isMe
              ? ` Vanaf ${MIN_OVERALL_GROUPS} spiergroepen is je totaalrang definitief.`
              : ` Voorlopig tot ${MIN_OVERALL_GROUPS} spiergroepen een rang hebben.`
            : coverage.groups < coverage.of && isMe
              ? " Train de andere groepen voor een compleet beeld."
              : ""}
        </p>
      )}
      {mine !== undefined && (
        <div className="relative mt-4 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex items-center justify-center gap-2">
            <span className="text-muted">Jij:</span>
            {mine ? (
              <>
                <RankBadge tierIndex={TIERS.indexOf(mine.tier)} size={22} />
                <span className="font-bold" style={{ color: mine.tier.to }}>
                  {mine.tier.name}
                </span>
                {mine.provisional && <span className="text-xs text-warn">voorlopig</span>}
              </>
            ) : (
              <span className="text-muted">nog geen rang</span>
            )}
          </div>
          {mine && (
            <p className="text-xs text-muted">
              {!cmp
                ? "Nog geen gedeelde spiergroepen om te vergelijken."
                : `${Math.abs(cmp.diff) < 0.05 ? "Gelijk op" : cmp.diff > 0 ? "Jij staat voor" : "Jij staat achter"}${
                    sameCoverage ? "" : ` op ${cmp.shared} gedeelde ${cmp.shared === 1 ? "spiergroep" : "spiergroepen"}`
                  }.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
