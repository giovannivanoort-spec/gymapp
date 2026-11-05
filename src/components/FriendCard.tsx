"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ageFrom, relativeDay, toISODate, updatedLabel } from "@/lib/dates";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { daysAgo, personalRecords, type FriendProfile } from "@/lib/friends";
import { formatSet, useHistory, useHistoryState } from "@/lib/history";
import { TIERS } from "@/lib/ranks";
import { useRanks } from "@/lib/useRanks";
import { trainedDaysPerWeek, weekRange, weekStreak } from "@/lib/week";
import { Avatar } from "./Avatar";
import { ChevronRightIcon, TrophyIcon } from "./Icons";
import { RankBadge } from "./RankBadge";

/** Hoe lang een record als "recent" telt (dagen). */
const RECENT_PR_DAYS = 7;

/** Rang, trainingen deze week, reeks, laatste training en records van één persoon (gedeelde cache). */
export function usePersonSummary(p: FriendProfile | null) {
  const history = useHistory(p?.id ?? null);
  const ranks = useRanks(p?.id ?? null, p?.bodyweight_kg ?? null, p?.sex ?? null, ageFrom(p?.birth_date));
  const prs = useMemo(() => (history ? personalRecords(history) : null), [history]);
  return useMemo(() => {
    if (!history || !p) return null;
    const done = history.filter((s) => (s.reps ?? 0) > 0);
    const days = new Set(done.map((s) => s.date));
    const week = weekRange(0).days.filter((d) => days.has(d)).length;
    const goal = p.weekly_goal ?? 3;
    const last = [...days].sort().at(-1) ?? null;
    const latestPR = prs?.[0] && daysAgo(prs[0].date) <= RECENT_PR_DAYS ? prs[0] : null;
    return {
      days,
      week,
      goal,
      streak: weekStreak(trainedDaysPerWeek(days), goal),
      last,
      overall: ranks?.overall ?? null,
      tierIndex: ranks?.overall ? TIERS.indexOf(ranks.overall.tier) : null,
      ranks,
      history,
      /** Aantal trainingen (met minstens één gedane set). */
      sessions: new Set(done.map((s) => s.workoutId)).size,
      /** Aantal gedane sets. */
      sets: done.length,
      /** Alle persoonlijke records, nieuwste eerst. */
      prs: prs ?? [],
      /** Record van de afgelopen week, als die er is. */
      latestPR,
    };
  }, [history, ranks, prs, p]);
}

export type PersonSummary = NonNullable<ReturnType<typeof usePersonSummary>>;

/**
 * Samenvattingen van een (kleine) lijst mensen, voor sorteren en ranglijsten. Hooks mogen niet in
 * een lus, dus elk niveau haalt er één op en geeft de rest door. `null` = nog aan het laden.
 */
export function WithSummaries({
  people,
  children,
  index = 0,
  acc = [],
}: {
  people: FriendProfile[];
  children: (summaries: (PersonSummary | null)[]) => React.ReactNode;
  index?: number;
  acc?: (PersonSummary | null)[];
}) {
  const s = usePersonSummary(index < people.length ? people[index] : null);
  if (index >= people.length) return <>{children(acc)}</>;
  return (
    <WithSummaries people={people} index={index + 1} acc={[...acc, s]}>
      {children}
    </WithSummaries>
  );
}

/** Korte omschrijving van een record, bijv. "Bankdrukken 100 kg × 5". */
export function prLabel(pr: { slug: string; set: { weight: number | null; reps: number | null } }) {
  return `${EXERCISE_BY_SLUG[pr.slug]?.name ?? pr.slug} ${formatSet(pr.set)}`;
}

/** Rij in de vriendenlijst. Geef `summary` mee als die al berekend is (anders haalt de rij hem zelf op). */
export function FriendRow({
  friend,
  index = 0,
  summary,
}: {
  friend: FriendProfile;
  index?: number;
  summary?: PersonSummary | null;
}) {
  const own = usePersonSummary(summary === undefined ? friend : null);
  const s = summary === undefined ? own : summary;
  const today = s?.last === toISODate();
  // Verversen mislukt (bijv. offline): eerlijk laten zien hoe oud de stand is.
  const st = useHistoryState(friend.id);
  const staleLabel = st.data !== undefined && st.stale && !st.refreshing ? updatedLabel(st.updatedAt) : null;
  return (
    <Link
      href={`/friends/${friend.id}`}
      className="card animate-fade-up flex items-center gap-3 p-3 hover:border-muted active:scale-[0.99]"
      style={{ "--i": index } as React.CSSProperties}
    >
      <span className="relative shrink-0">
        <Avatar id={friend.id} name={friend.display_name} size={44} ring={s?.overall?.tier.from} />
        {today && (
          <span className="animate-scale-in absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-accent ring-[3px] ring-surface" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {friend.display_name}
          {today && <span className="sr-only">, heeft vandaag getraind</span>}
        </p>
        {s ? (
          <>
            <p className="truncate text-xs text-muted">
              <span className={`tabular-nums ${s.week >= s.goal ? "font-semibold text-accent" : "text-ink"}`}>
                {s.week}/{s.goal}
              </span>{" "}
              deze week
              {s.streak > 0 && <> · {s.streak} {s.streak === 1 ? "week" : "weken"} reeks</>}
              {s.last && <> · {relativeDay(s.last).toLowerCase()}</>}
            </p>
            {staleLabel && (
              <p className="mt-0.5 truncate text-[11px] text-warn">
                {st.offline ? "Offline, " : "Niet ververst, "}
                {staleLabel}
              </p>
            )}
            {s.latestPR && (
              <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-warn">
                <TrophyIcon size={12} className="shrink-0" />
                <span className="truncate">
                  PR {prLabel(s.latestPR)} · {relativeDay(s.latestPR.date).toLowerCase()}
                </span>
              </p>
            )}
          </>
        ) : (
          <span className="skeleton mt-1 block h-3 w-32" />
        )}
      </div>
      {s?.tierIndex != null && (
        <div className="flex shrink-0 flex-col items-center">
          <RankBadge tierIndex={s.tierIndex} size={30} />
          <span className="text-[10px] font-semibold" style={{ color: s.overall!.tier.to }}>
            {s.overall!.tier.name}
          </span>
        </div>
      )}
      <ChevronRightIcon className="shrink-0 text-muted" />
    </Link>
  );
}
