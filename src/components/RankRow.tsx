import Link from "next/link";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { exampleSetFor, TIERS, type ExerciseRank } from "@/lib/ranks";
import { ChevronRightIcon } from "./Icons";
import { RankBadge, TierProgress } from "./RankBadge";

export function ExerciseRankRow({ rank, index = 0 }: { rank: ExerciseRank; index?: number }) {
  const ex = EXERCISE_BY_SLUG[rank.slug];
  return (
    <li className="animate-fade-up" style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
      <Link href={`/exercises/${rank.slug}`} className="card flex items-center gap-3 p-3 hover:border-muted">
        <RankBadge tierIndex={rank.tierIndex} size={40} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold">{ex?.name ?? rank.slug}</p>
            <span className="shrink-0 text-xs font-semibold" style={{ color: rank.tier.to }}>
              {rank.tier.name}
            </span>
          </div>
          <TierProgress tierIndex={rank.tierIndex} progress={rank.progress} />
          <p className="text-xs text-muted">{describeRank(rank)}</p>
        </div>
        <ChevronRightIcon className="shrink-0 text-muted" />
      </Link>
    </li>
  );
}

const nl = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

export function describeRank(r: ExerciseRank): string {
  const best = r.unit === "reps" ? `${r.value} reps` : r.viaAdded ? `1RM +${nl(r.value)} kg extra` : `1RM ≈ ${nl(r.value)} kg`;
  if (r.nextAt == null) return `${best} · hoogste rang`;
  const next = TIERS[r.tierIndex + 1].name;
  if (r.unit === "reps") return `${best} · ${r.nextAt} reps voor ${next}`;
  if (r.viaAdded) return `${best} · +${Math.ceil(r.nextAt)} kg voor ${next}`;
  return `${best} · ${Math.ceil(r.nextAt)} kg voor ${next} (bijv. ${exampleSetFor(r.nextAt).replace(".", ",")})`;
}
