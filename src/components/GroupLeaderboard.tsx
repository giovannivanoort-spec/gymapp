"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { fetchCached, useCached } from "@/lib/cache";
import { ageFrom, toISODate } from "@/lib/dates";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { aggregateRanks, TIERS, type ExerciseRank, type LogLike } from "@/lib/ranks";
import { supabase } from "@/lib/supabase";
import type { GroupMember } from "@/lib/types";
import { fetchLogsBySlug, rankAll } from "@/lib/useRanks";
import { addDays, trainedDaysPerWeek, weekStreak } from "@/lib/week";
import { Avatar } from "./Avatar";
import { RankBadge } from "./RankBadge";

type LogsByUser = Record<string, Record<string, LogLike[]>>;
type MemberRanks = { member: GroupMember; ranks: ExerciseRank[] | null; overall: number | null };
type BestRow = { user_id: string; exercise_slug: string; weight: number | string | null; reps: number; reps12: number | null };

const OVERALL = "overall";
const ATTENDANCE = "attendance";
const ATTENDANCE_DAYS = 28;

/**
 * Beste sets per lid en oefening. Bij voorkeur via de RPC group_best_sets (een fractie van de data);
 * zonder die functie alle sets per lid (oude manier).
 */
async function fetchGroupLogs(groupId: string | undefined, ids: string[]): Promise<LogsByUser> {
  if (groupId) {
    const { data, error } = await supabase.rpc("group_best_sets", { gid: groupId });
    if (!error && data) {
      const out: LogsByUser = {};
      for (const r of data as BestRow[]) {
        const bySlug = (out[r.user_id] ??= {});
        const list = (bySlug[r.exercise_slug] ??= []);
        const weight = Number(r.weight) || null;
        list.push({ weight, reps: r.reps });
        if (r.reps12 != null && r.reps12 !== r.reps) list.push({ weight, reps: r.reps12 });
      }
      return out;
    }
    const missing = error && (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message));
    if (error && !missing) throw error;
  }
  const all = await Promise.all(ids.map((id) => fetchLogsBySlug(id)));
  return Object.fromEntries(ids.map((id, i) => [id, Object.fromEntries(all[i])]));
}

/** Gelijke scores krijgen dezelfde plek (1, 1, 3). */
function positions<T>(rows: T[], same: (a: T, b: T) => boolean): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => out.push(i > 0 && same(rows[i - 1], r) ? out[i - 1] : i + 1));
  return out;
}

/**
 * Ranglijst van een groep: totaal, per oefening, of op aanwezigheid (wie het vaakst bij de
 * groepstrainingen was), zodat niet alleen de sterkste bovenaan kan staan.
 */
export function GroupLeaderboard({
  members,
  userId,
  groupId,
  attendance,
}: {
  members: GroupMember[];
  userId: string;
  /** Met groupId wordt de lichte RPC gebruikt. */
  groupId?: string;
  /**
   * Per lid de datum van elke groepstraining waarin diegene sets logde (één item per training, uit
   * een vast venster van weken). Toont het tabblad "Aanwezig".
   */
  attendance?: Record<string, string[]>;
}) {
  const [selected, setSelected] = useState<string>(OVERALL);
  const [failed, setFailed] = useState(false);
  const memberKey = members
    .map((m) => m.user_id)
    .sort()
    .join();
  const key = memberKey ? `leaderboard:${memberKey}` : null;

  const fetcher = useCallback(
    () =>
      fetchGroupLogs(groupId, memberKey.split(",")).then(
        (d) => {
          setFailed(false);
          return d;
        },
        (e: unknown) => {
          setFailed(true);
          throw e;
        },
      ),
    [groupId, memberKey],
  );
  // Onthouden (ook na herstart), zodat de ranglijst direct zichtbaar is; ververst op de achtergrond.
  const logs = useCached(key, fetcher, { maxAge: 30_000, persist: true });

  const data: MemberRanks[] = useMemo(
    () =>
      members.map((m) => {
        const p = m.profiles;
        if (!logs || !p?.bodyweight_kg || !p.sex) return { member: m, ranks: null, overall: null };
        const ranks = rankAll(new Map(Object.entries(logs[m.user_id] ?? {})), p.bodyweight_kg, p.sex, ageFrom(p.birth_date));
        return { member: m, ranks, overall: aggregateRanks(ranks).overall?.score ?? null };
      }),
    [members, logs],
  );

  // Oefeningen waar de meeste leden een rang voor hebben.
  const exercises = useMemo(() => {
    const count = new Map<string, number>();
    for (const d of data) for (const r of d.ranks ?? []) count.set(r.slug, (count.get(r.slug) ?? 0) + 1);
    return [...count]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([slug]) => slug);
  }, [data]);

  const attendanceRows = useMemo(() => {
    if (!attendance) return [];
    const since = toISODate(addDays(new Date(), -(ATTENDANCE_DAYS - 1)));
    return members
      .map((m) => {
        // Eén datum per bijgewoonde training: twee groepstrainingen op één dag tellen als twee.
        const dates = attendance[m.user_id] ?? [];
        return {
          member: m,
          recent: dates.filter((d) => d >= since).length,
          streak: weekStreak(trainedDaysPerWeek(dates), 1),
        };
      })
      .sort((a, b) => b.recent - a.recent || b.streak - a.streak);
  }, [attendance, members]);

  const tabs = [OVERALL, ...(attendance ? [ATTENDANCE] : []), ...exercises];
  const active = tabs.includes(selected) ? selected : OVERALL;

  const chips = (
    <div
      className="-mx-1 -my-1 flex gap-1.5 overflow-x-auto px-1 pr-6 [scrollbar-width:none]"
      style={{
        maskImage: "linear-gradient(to right, #000 calc(100% - 28px), transparent)",
        WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 28px), transparent)",
      }}
      role="group"
      aria-label="Ranglijst kiezen"
    >
      {tabs.map((s) => (
        // Knop van 44px hoog (raakvlak), met een compacte pil erin.
        <button
          key={s}
          onClick={() => setSelected(s)}
          aria-pressed={active === s}
          className="group flex min-h-11 shrink-0 items-center transition active:scale-95"
        >
          <span
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              active === s ? "border-accent bg-accent text-accent-ink" : "border-line text-muted group-hover:text-ink"
            }`}
          >
            {s === OVERALL ? "Totaal" : s === ATTENDANCE ? "Aanwezig" : (EXERCISE_BY_SLUG[s]?.name ?? s)}
          </span>
        </button>
      ))}
    </div>
  );

  // ─────────────── Aanwezigheid (heeft geen sets-data nodig) ───────────────
  if (active === ATTENDANCE) {
    const pos = positions(attendanceRows, (a, b) => a.recent === b.recent && a.streak === b.streak);
    return (
      <div className="space-y-3">
        {chips}
        <p className="px-1 text-xs text-muted">Groepstrainingen waarin iemand sets logde, de laatste 4 weken.</p>
        <ol className="card divide-y divide-line p-0">
          {attendanceRows.map((r, i) => {
            const name = r.member.profiles?.display_name ?? "Onbekend";
            return (
              <li key={r.member.user_id} className="animate-fade-up" style={{ "--i": i } as React.CSSProperties}>
                <Link href={`/ranks?user=${r.member.user_id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-2">
                  <span
                    className={`w-5 text-center text-sm font-bold tabular-nums ${pos[i] === 1 && r.recent > 0 ? "text-accent" : "text-muted"}`}
                  >
                    {r.recent > 0 ? pos[i] : "–"}
                  </span>
                  <Avatar id={r.member.user_id} name={name} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {name}
                      {r.member.user_id === userId && <span className="font-normal text-muted"> (jij)</span>}
                    </p>
                    <p className="text-xs text-muted">
                      {r.streak > 0 ? `${r.streak} ${r.streak === 1 ? "week" : "weken"} op rij` : r.recent > 0 ? "Deze week nog niet" : "Nog niet bij een groepstraining"}
                    </p>
                  </div>
                  <span className="text-right">
                    <span className="block text-lg font-bold leading-none tabular-nums">{r.recent}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted">{r.recent === 1 ? "training" : "trainingen"}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  if (!logs) {
    if (failed) {
      return (
        <div className="card space-y-3 text-center text-sm">
          <p className="text-muted">Kan de ranglijst niet laden.</p>
          <button className="btn-ghost min-h-11 w-full" onClick={() => key && fetchCached(key, fetcher, true).catch(() => {})}>
            Opnieuw proberen
          </button>
        </div>
      );
    }
    return (
      <div className="space-y-3" aria-busy aria-label="Ranglijst laden">
        <div className="flex gap-1.5">
          {[64, 80, 96].map((w) => (
            <div key={w} className="skeleton h-[30px] rounded-full" style={{ width: w }} />
          ))}
        </div>
        <div className="card divide-y divide-line p-0">
          {members.slice(0, 4).map((m) => (
            <div key={m.user_id} className="flex items-center gap-3 px-4 py-3">
              <div className="skeleton h-4 w-5" />
              <div className="skeleton h-[34px] w-[34px] rounded-full" />
              <div className="flex-1 space-y-1.5">
                <div className="skeleton h-3.5 w-1/2" />
                <div className="skeleton h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const rows = data
    .map((d) => {
      if (active === OVERALL) return { ...d, score: d.overall, rank: null as ExerciseRank | null };
      const rank = d.ranks?.find((r) => r.slug === active) ?? null;
      return { ...d, score: rank?.score ?? null, rank };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const pos = positions(rows, (a, b) => a.score != null && b.score != null && Math.abs(a.score - b.score) < 1e-9);

  return (
    <div className="space-y-3">
      {chips}

      <ol className="card divide-y divide-line p-0">
        {rows.map((r, i) => {
          const name = r.member.profiles?.display_name ?? "Onbekend";
          const tierIndex = r.score != null ? Math.min(TIERS.length - 1, Math.floor(r.score)) : null;
          const bw = r.member.profiles?.bodyweight_kg;
          const self = r.member.user_id === userId;
          const incomplete = !r.member.profiles?.bodyweight_kg || !r.member.profiles?.sex;
          return (
            <li key={r.member.user_id} className="animate-fade-up flex items-center" style={{ "--i": i } as React.CSSProperties}>
              <Link href={`/ranks?user=${r.member.user_id}`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 transition hover:bg-surface-2">
                <span className={`w-5 text-center text-sm font-bold tabular-nums ${pos[i] === 1 && r.score != null ? "text-accent" : "text-muted"}`}>
                  {r.score != null ? pos[i] : "–"}
                </span>
                {tierIndex != null ? (
                  <RankBadge tierIndex={tierIndex} size={34} />
                ) : (
                  <RankBadge tierIndex={0} size={34} className="opacity-25 grayscale" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {name}
                    {self && <span className="font-normal text-muted"> (jij)</span>}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {incomplete
                      ? self
                        ? "Vul je gewicht en geslacht in voor een rang"
                        : "Profiel niet aangevuld"
                      : tierIndex == null
                        ? "Nog geen rang"
                        : r.rank
                          ? r.rank.unit === "reps"
                            ? `${r.rank.value} reps`
                            : r.rank.viaAdded
                              ? `+${r.rank.value.toLocaleString("nl-NL")} kg extra`
                              : `1RM ≈ ${r.rank.value.toLocaleString("nl-NL")} kg${bw ? ` · ${(r.rank.value / bw).toFixed(2).replace(".", ",")}× lichaamsgewicht` : ""}`
                          : `${r.ranks?.length ?? 0} ${r.ranks?.length === 1 ? "oefening" : "oefeningen"}`}
                  </p>
                </div>
                {tierIndex != null && (
                  <span className="shrink-0 text-xs font-semibold" style={{ color: TIERS[tierIndex].to }}>
                    {TIERS[tierIndex].name}
                  </span>
                )}
              </Link>
              {self && incomplete && (
                <Link
                  href="/profile"
                  className="mr-3 flex min-h-11 shrink-0 items-center rounded-xl px-2 text-xs font-semibold text-accent underline-offset-2 hover:underline"
                >
                  Aanvullen
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
