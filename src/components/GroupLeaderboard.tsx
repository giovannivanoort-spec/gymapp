"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { aggregateRanks, TIERS, type ExerciseRank, type LogLike } from "@/lib/ranks";
import type { GroupMember } from "@/lib/types";
import { fetchLogsBySlug, rankAll } from "@/lib/useRanks";
import { RankBadge } from "./RankBadge";
import { ageFrom } from "@/lib/dates";

type MemberRanks = { member: GroupMember; ranks: ExerciseRank[] | null; overall: number | null };

/** Ranglijst van een groep: totaal of per oefening. */
export function GroupLeaderboard({ members, userId }: { members: GroupMember[]; userId: string }) {
  const [logs, setLogs] = useState<Map<string, Map<string, LogLike[]>> | null>(null);
  const [selected, setSelected] = useState<string>("overall");
  const memberKey = members.map((m) => m.user_id).join();

  useEffect(() => {
    if (!memberKey) return;
    const ids = memberKey.split(",");
    Promise.all(ids.map((id) => fetchLogsBySlug(id))).then((all) => setLogs(new Map(ids.map((id, i) => [id, all[i]]))));
  }, [memberKey]);

  const data: MemberRanks[] = useMemo(
    () =>
      members.map((m) => {
        const p = m.profiles;
        if (!logs || !p?.bodyweight_kg || !p.sex) return { member: m, ranks: null, overall: null };
        const ranks = rankAll(logs.get(m.user_id) ?? new Map(), p.bodyweight_kg, p.sex, ageFrom(p.birth_date));
        return { member: m, ranks, overall: aggregateRanks(ranks).overall?.score ?? null };
      }),
    [members, logs],
  );

  // Oefeningen waar de meeste leden een rang voor hebben.
  const exercises = useMemo(() => {
    const count = new Map<string, number>();
    for (const d of data) for (const r of d.ranks ?? []) count.set(r.slug, (count.get(r.slug) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([slug]) => slug);
  }, [data]);

  if (!logs) return <div className="skeleton h-40" />;

  const rows = data
    .map((d) => {
      if (selected === "overall") return { ...d, score: d.overall, rank: null as ExerciseRank | null };
      const rank = d.ranks?.find((r) => r.slug === selected) ?? null;
      return { ...d, score: rank?.score ?? null, rank };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  return (
    <div className="space-y-3">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {["overall", ...exercises].map((s) => (
          <button
            key={s}
            onClick={() => setSelected(s)}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              selected === s ? "border-accent bg-accent text-accent-ink" : "border-line text-muted hover:text-ink"
            }`}
          >
            {s === "overall" ? "Totaal" : (EXERCISE_BY_SLUG[s]?.name ?? s)}
          </button>
        ))}
      </div>

      <ol className="card divide-y divide-line p-0">
        {rows.map((r, i) => {
          const name = r.member.profiles?.display_name ?? "Onbekend";
          const tierIndex = r.score != null ? Math.min(TIERS.length - 1, Math.floor(r.score)) : null;
          const bw = r.member.profiles?.bodyweight_kg;
          return (
            <li key={r.member.user_id} className="animate-fade-up" style={{ "--i": i } as React.CSSProperties}>
              <Link href={`/ranks?user=${r.member.user_id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-2">
                <span className={`w-5 text-center text-sm font-bold tabular-nums ${i === 0 && r.score != null ? "text-accent" : "text-muted"}`}>
                  {r.score != null ? i + 1 : "–"}
                </span>
                {tierIndex != null ? (
                  <RankBadge tierIndex={tierIndex} size={34} />
                ) : (
                  <RankBadge tierIndex={0} size={34} className="opacity-25 grayscale" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {name}
                    {r.member.user_id === userId && <span className="font-normal text-muted"> (jij)</span>}
                  </p>
                  <p className="text-xs text-muted">
                    {!r.member.profiles?.bodyweight_kg || !r.member.profiles?.sex
                      ? "Profiel niet aangevuld"
                      : tierIndex == null
                        ? "Nog geen rang"
                        : r.rank
                          ? r.rank.unit === "reps"
                            ? `${r.rank.value} reps`
                            : r.rank.viaAdded
                              ? `+${r.rank.value.toLocaleString("nl-NL")} kg extra`
                              : `1RM ≈ ${r.rank.value.toLocaleString("nl-NL")} kg${bw ? ` · ${(r.rank.value / bw).toFixed(2).replace(".", ",")}× lichaamsgewicht` : ""}`
                          : `${r.ranks?.length ?? 0} oefeningen`}
                  </p>
                </div>
                {tierIndex != null && (
                  <span className="text-xs font-semibold" style={{ color: TIERS[tierIndex].to }}>
                    {TIERS[tierIndex].name}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
