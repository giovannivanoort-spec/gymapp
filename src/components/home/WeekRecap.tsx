"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { CloseIcon } from "@/components/Icons";
import type { FriendProfile } from "@/lib/friends";
import type { HistorySet } from "@/lib/history";
import { addDays, formatWeekRange, parseISODate, startOfWeek, trainedDaysPerWeek, weekRange, weekStreak } from "@/lib/week";
import { fetchFriendsRecent, findRecords, kg, shortHash } from "./data";
import { strict, useLive } from "./live";

const DISMISS_KEY = "spotter:recap-dismissed:v1";
/** Maandag t/m woensdag tonen (0 = maandag). */
const SHOW_UNTIL_WEEKDAY = 2;

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/**
 * "Vorige week" aan het begin van de week: trainingen tegenover je doel, volume, records en hoe je
 * vrienden het deden. Wegklikbaar tot de volgende week; alleen voor wie al eerder trainde.
 * Vrienden komen uit dezelfde lichte query (en cache) als het vriendenblok op Home.
 */
export function WeekRecap({
  userId,
  history,
  goal,
  today,
  friends,
}: {
  userId: string;
  history: HistorySet[] | undefined;
  goal: number;
  today: string;
  friends: FriendProfile[] | undefined;
}) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const now = parseISODate(today);
  const weekday = (now.getDay() + 6) % 7;
  const last = weekRange(-1, now);
  const show = weekday <= SHOW_UNTIL_WEEKDAY && dismissed !== last.from;

  // Zelfde sleutel en periode als HomeFriends: geen extra verzoek.
  const ids = useMemo(() => (friends ?? []).map((f) => f.id).sort(), [friends]);
  const since = addDays(startOfWeek(now), -7).toISOString();
  const recent = useLive(
    show && ids.length ? `home:friends-week:${userId}:${shortHash(ids.join())}` : null,
    strict("friends-week", () => fetchFriendsRecent(ids, since)),
    { persist: true, maxAge: 30_000 },
  );

  const stats = useMemo(() => {
    if (!show || !history) return null;
    // Alleen voor wie al vóór vorige week trainde: anders is er niets om terug te kijken.
    if (!history.some((s) => s.date < last.from && (s.reps ?? 0) > 0)) return null;
    const sets = history.filter((s) => s.date >= last.from && s.date <= last.to && (s.reps ?? 0) > 0);
    const days = new Set(sets.map((s) => s.date)).size;
    const volume = sets.reduce((v, s) => v + (s.weight ?? 0) * (s.reps ?? 0), 0);
    const records = findRecords(history, (s) => s.date >= last.from && s.date <= last.to).length;
    const allDays = history.filter((s) => (s.reps ?? 0) > 0).map((s) => s.date);
    const streak = weekStreak(trainedDaysPerWeek(allDays), goal, parseISODate(last.from));
    return { days, volume, records, streak, met: days >= goal };
  }, [show, history, last.from, last.to, goal]);

  const crew = useMemo(() => {
    if (!recent || !friends?.length) return null;
    const rows = friends.map((f) => {
      const n = (recent.days[f.id] ?? []).filter((d) => d >= last.from && d <= last.to).length;
      return { f, met: n >= (f.weekly_goal ?? 3), n };
    });
    return { met: rows.filter((r) => r.met).map((r) => r.f), total: rows.length };
  }, [recent, friends, last.from, last.to]);

  if (!stats) return null;

  const dismiss = () => {
    setDismissed(last.from);
    try {
      localStorage.setItem(DISMISS_KEY, last.from);
    } catch {
      // geen opslag: alleen voor nu verborgen
    }
  };

  const headline = stats.met
    ? stats.streak > 1
      ? `Doel gehaald, ${stats.streak} weken op rij`
      : "Doel gehaald"
    : stats.days === 0
      ? "Geen training gelogd"
      : `${stats.days} van ${goal} ${goal === 1 ? "training" : "trainingen"}`;
  const sub = stats.met ? "Sterk bezig. Houd het vast deze week." : stats.days === 0 ? "Deze week een nieuwe start." : "Deze week een nieuwe kans.";

  return (
    <section className="card animate-fade-up space-y-3" aria-labelledby="home-recap">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            <span id="home-recap">Vorige week</span> · {formatWeekRange(last)}
          </p>
          <p className={`mt-1 text-lg font-extrabold leading-tight ${stats.met ? "text-accent" : ""}`}>{headline}</p>
          <p className="text-xs text-muted">{sub}</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Terugblik verbergen tot volgende week"
          className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:text-ink"
        >
          <CloseIcon size={16} />
        </button>
      </div>

      <dl className="grid grid-cols-3 divide-x divide-line rounded-xl bg-surface-2 py-2.5 text-center">
        <div className="px-2">
          <dt className="text-[11px] text-muted">Trainingen</dt>
          <dd className={`text-sm font-bold tabular-nums ${stats.met ? "text-accent" : ""}`}>
            {stats.days}/{goal}
          </dd>
        </div>
        <div className="px-2">
          <dt className="text-[11px] text-muted">Volume</dt>
          <dd className="truncate text-sm font-bold tabular-nums">{stats.volume > 0 ? kg(stats.volume) : "–"}</dd>
        </div>
        <div className="px-2">
          <dt className="text-[11px] text-muted">{stats.records === 1 ? "Record" : "Records"}</dt>
          <dd className={`text-sm font-bold tabular-nums ${stats.records > 0 ? "text-accent" : ""}`}>{stats.records}</dd>
        </div>
      </dl>

      {crew && (
        <Link href="/friends" className="-mx-1 flex min-h-11 items-center gap-3 rounded-xl px-1 transition-colors hover:bg-surface-2/50">
          {crew.met.length > 0 && (
            <span className="flex shrink-0 -space-x-2">
              {crew.met.slice(0, 4).map((f) => (
                <Avatar key={f.id} id={f.id} name={f.display_name} size={26} ring="var(--color-accent)" />
              ))}
            </span>
          )}
          <span className="min-w-0 flex-1 text-xs text-muted">
            {crew.met.length === 0 ? (
              "Geen van je vrienden haalde zijn weekdoel."
            ) : (
              <>
                <span className="font-semibold text-ink">
                  {crew.met.length} van {crew.total}
                </span>{" "}
                {crew.total === 1 ? "vriend" : "vrienden"} {crew.met.length === 1 ? "haalde zijn" : "haalden hun"} weekdoel
              </>
            )}
          </span>
        </Link>
      )}
    </section>
  );
}
