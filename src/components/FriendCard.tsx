"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ageFrom, relativeDay } from "@/lib/dates";
import type { FriendProfile } from "@/lib/friends";
import { useHistory } from "@/lib/history";
import { TIERS } from "@/lib/ranks";
import { useRanks } from "@/lib/useRanks";
import { trainedDaysPerWeek, weekRange, weekStreak } from "@/lib/week";
import { Avatar } from "./Avatar";
import { ChevronRightIcon } from "./Icons";
import { RankBadge } from "./RankBadge";

/** Rang, trainingen deze week, reeks en laatste training van één persoon (gedeelde cache). */
export function usePersonSummary(p: FriendProfile | null) {
  const history = useHistory(p?.id ?? null);
  const ranks = useRanks(p?.id ?? null, p?.bodyweight_kg ?? null, p?.sex ?? null, ageFrom(p?.birth_date));
  return useMemo(() => {
    if (!history || !p) return null;
    const days = new Set(history.filter((s) => (s.reps ?? 0) > 0).map((s) => s.date));
    const week = weekRange(0).days.filter((d) => days.has(d)).length;
    const goal = p.weekly_goal ?? 3;
    const last = [...days].sort().at(-1) ?? null;
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
    };
  }, [history, ranks, p]);
}

/** Rij in de vriendenlijst. */
export function FriendRow({ friend, index = 0 }: { friend: FriendProfile; index?: number }) {
  const s = usePersonSummary(friend);
  return (
    <Link
      href={`/friends/${friend.id}`}
      className="card animate-fade-up flex items-center gap-3 p-3 hover:border-muted"
      style={{ "--i": index } as React.CSSProperties}
    >
      <Avatar id={friend.id} name={friend.display_name} size={44} ring={s?.overall?.tier.from} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{friend.display_name}</p>
        {s ? (
          <p className="truncate text-xs text-muted">
            <span className={s.week >= s.goal ? "font-semibold text-accent" : "text-ink"}>
              {s.week}/{s.goal}
            </span>{" "}
            deze week
            {s.streak > 0 && <> · {s.streak} {s.streak === 1 ? "week" : "weken"} reeks</>}
            {s.last && <> · {relativeDay(s.last).toLowerCase()}</>}
          </p>
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

/** Compacte kaart voor de vriendenstrip op Home. */
export function FriendChip({ friend, index = 0 }: { friend: FriendProfile; index?: number }) {
  const s = usePersonSummary(friend);
  const firstName = friend.display_name.split(" ")[0];
  return (
    <Link
      href={`/friends/${friend.id}`}
      className="animate-fade-up flex w-[76px] shrink-0 flex-col items-center gap-1.5 text-center"
      style={{ "--i": index } as React.CSSProperties}
    >
      <span className="relative">
        <Avatar id={friend.id} name={friend.display_name} size={56} ring={s?.overall?.tier.from ?? "var(--color-line)"} />
        {s?.tierIndex != null && (
          <span className="absolute -bottom-1 -right-1">
            <RankBadge tierIndex={s.tierIndex} size={22} />
          </span>
        )}
      </span>
      <span className="w-full truncate text-xs font-semibold">{firstName}</span>
      <span className="-mt-1 text-[10px] tabular-nums text-muted">
        {s ? (
          <>
            <span className={s.week >= s.goal ? "text-accent" : ""}>
              {s.week}/{s.goal}
            </span>{" "}
            week
          </>
        ) : (
          "…"
        )}
      </span>
    </Link>
  );
}
