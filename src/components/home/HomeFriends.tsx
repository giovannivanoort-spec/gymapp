"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Avatar } from "@/components/Avatar";
import { ChevronRightIcon, UserPlusIcon, UsersIcon } from "@/components/Icons";
import { useCachedError } from "@/lib/cache";
import { relativeDay, timeAgo, toISODate } from "@/lib/dates";
import type { FriendsState } from "@/lib/friends";
import { addDays, parseISODate, startOfWeek, weekRange } from "@/lib/week";
import { fetchFriendsRecent, kg, shortHash } from "./data";
import { strict, useLive } from "./live";

const RING = 64;
const RING_STROKE = 3;
const RING_R = (RING - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;
const AVATAR = 52;

/** Avatar met een ring die maar één ding betekent: hoe ver iemand is met zijn weekdoel. */
function GoalRing({
  id,
  name,
  src,
  ratio,
  loading,
}: {
  id: string;
  name: string;
  src?: string | null;
  ratio: number;
  loading: boolean;
}) {
  const p = Math.min(1, Math.max(0, ratio));
  return (
    <span className="relative block shrink-0" style={{ width: RING, height: RING }}>
      <svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={RING / 2} cy={RING / 2} r={RING_R} fill="none" stroke="var(--color-surface-2)" strokeWidth={RING_STROKE} />
        {!loading && (
          <circle
            cx={RING / 2}
            cy={RING / 2}
            r={RING_R}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - p)}
            style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.2, 0.8, 0.2, 1)", opacity: p > 0 ? 1 : 0 }}
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">
        <Avatar id={id} name={name} src={src} size={AVATAR} />
      </span>
    </span>
  );
}

/**
 * Vrienden op Home: wie haalt zijn weekdoel (ring = voortgang naar het doel) en wat is er recent
 * getraind. Alles uit één lichte query over de sets van de afgelopen twee weken, gedeeld met
 * WeekRecap via dezelfde cachesleutel.
 */
export function HomeFriends({
  userId,
  friends,
  failed,
  today,
}: {
  userId: string;
  friends: FriendsState | undefined;
  /** De vriendenlijst kon (nog) niet geladen worden. */
  failed: boolean;
  today: string;
}) {
  const list = friends?.friends;
  const ids = useMemo(() => (list ?? []).map((f) => f.id).sort(), [list]);
  const monday = startOfWeek(parseISODate(today));
  const since = addDays(monday, -7).toISOString();
  // Zelfde sleutel, fetcher en periode als WeekRecap: één verzoek voor beide.
  const recentKey = ids.length ? `home:friends-week:${userId}:${shortHash(ids.join())}` : null;
  const recent = useLive(recentKey, strict("friends-week", () => fetchFriendsRecent(ids, since)), { persist: true, maxAge: 30_000 });
  const recentFailed = !!useCachedError(recentKey) && recent === undefined;

  const week = weekRange(0, parseISODate(today));
  const board = useMemo(
    () =>
      (list ?? [])
        .map((f) => {
          const days = recent?.days[f.id] ?? [];
          const count = days.filter((d) => d >= week.from && d <= week.to).length;
          const goal = Math.min(7, Math.max(1, f.weekly_goal ?? 3));
          return { f, count, goal, ratio: count / goal };
        })
        .sort((a, b) => b.ratio - a.ratio || b.count - a.count || a.f.display_name.localeCompare(b.f.display_name, "nl")),
    [list, recent, week.from, week.to],
  );
  const byId = useMemo(() => new Map((list ?? []).map((f) => [f.id, f])), [list]);
  const weekAgo = toISODate(addDays(parseISODate(today), -6));
  const feed = (recent?.sessions ?? []).filter((s) => s.date >= weekAgo && s.date <= today && byId.has(s.userId)).slice(0, 4);
  const metCount = board.filter((b) => b.count >= b.goal).length;

  return (
    <section className="space-y-3" aria-labelledby="home-friends">
      <div className="flex items-center justify-between gap-2">
        <h2 id="home-friends" className="text-sm font-semibold uppercase tracking-wide text-muted">
          Vrienden deze week
        </h2>
        <span className="flex items-center gap-3">
          {recent && board.length > 0 && (
            <span className="text-xs tabular-nums text-muted">
              {metCount} van {board.length} op doel
            </span>
          )}
          <Link href="/friends" className="-my-3 flex min-h-11 items-center px-1 text-xs font-semibold text-muted hover:text-ink">
            Alles
          </Link>
        </span>
      </div>

      {!friends ? (
        failed ? (
          <p className="card flex items-center gap-3 text-sm text-muted">
            <UsersIcon size={18} className="shrink-0" />
            Nog niet geladen. Je vrienden verschijnen zodra je verbinding hebt.
          </p>
        ) : (
          <div className="flex gap-1" aria-label="Vrienden laden">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="flex w-[76px] flex-col items-center gap-1.5">
                <span className="skeleton block h-16 w-16 rounded-full" />
                <span className="skeleton block h-3 w-12" />
              </span>
            ))}
          </div>
        )
      ) : list!.length === 0 ? (
        <Link href="/friends" className="card animate-fade-up flex items-center gap-3 hover:border-muted">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-accent">
            <UserPlusIcon size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Voeg je trainingsmaten toe</span>
            <span className="block text-xs text-muted">Zie wie zijn weekdoel haalt en wat ze trainen.</span>
          </span>
          <ChevronRightIcon className="text-muted" />
        </Link>
      ) : (
        <>
          <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {board.map(({ f, count, goal, ratio }, i) => {
              const met = count >= goal;
              return (
                <li key={f.id} className="shrink-0">
                  <Link
                    href={`/friends/${f.id}`}
                    className="animate-fade-up flex w-[76px] flex-col items-center gap-1 text-center transition-transform active:scale-95"
                    style={{ "--i": i } as React.CSSProperties}
                    aria-label={`${f.display_name}: ${
                      recent ? `${count} van ${goal} ${goal === 1 ? "training" : "trainingen"} deze week${met ? ", doel gehaald" : ""}` : "laden"
                    }`}
                  >
                    <GoalRing id={f.id} name={f.display_name} src={f.avatar_url} ratio={ratio} loading={!recent} />
                    <span className="w-full truncate text-xs font-semibold">{f.display_name.split(" ")[0]}</span>
                    {recent ? (
                      <span className={`-mt-0.5 text-[11px] tabular-nums ${met ? "font-semibold text-accent" : "text-muted"}`}>
                        {count}/{goal}
                      </span>
                    ) : (
                      <span className="skeleton mt-0.5 h-2.5 w-8" />
                    )}
                  </Link>
                </li>
              );
            })}
            <li className="shrink-0">
              <Link href="/friends" className="flex w-[76px] flex-col items-center gap-1 text-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-line text-muted transition hover:border-muted hover:text-ink">
                  <UserPlusIcon size={22} />
                </span>
                <span className="text-xs font-semibold text-muted">Toevoegen</span>
              </Link>
            </li>
          </ul>

          {recent === undefined ? (
            recentFailed ? (
              <p className="px-1 text-xs text-muted">Recente trainingen nog niet geladen.</p>
            ) : (
              <div className="skeleton h-[124px]" />
            )
          ) : feed.length === 0 ? (
            <p className="px-1 text-xs text-muted">Je vrienden hebben de afgelopen week nog niet getraind.</p>
          ) : (
            <ul className="card divide-y divide-line overflow-hidden p-0" aria-label="Recent getraind">
              {feed.map((s, i) => {
                const f = byId.get(s.userId)!;
                return (
                  <li key={`${s.userId}-${s.workoutId}`} className="animate-fade-up" style={{ "--i": i } as React.CSSProperties}>
                    <Link
                      href={`/friends/${f.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/50"
                    >
                      <Avatar id={f.id} name={f.display_name} src={f.avatar_url} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          <span className="font-semibold">{f.display_name.split(" ")[0]}</span>
                          <span className="text-muted"> trainde </span>
                          <span className="font-medium">{s.title}</span>
                        </p>
                        <p className="truncate text-xs text-muted">
                          {s.date === today ? timeAgo(s.lastAt) : relativeDay(s.date).toLowerCase()} · {s.exercises}{" "}
                          {s.exercises === 1 ? "oefening" : "oefeningen"}
                          {s.volume > 0 && <> · {kg(s.volume)}</>}
                        </p>
                      </div>
                      <ChevronRightIcon className="shrink-0 text-muted" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
