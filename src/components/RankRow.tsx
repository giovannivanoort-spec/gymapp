import Link from "next/link";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import type { BoardEntry } from "@/lib/progress/groupBoard";
import { formatRankAmount, formatRankBest, nextTierTarget, TIERS, type ExerciseRank } from "@/lib/ranks";
import { ChevronRightIcon } from "./Icons";
import { RankBadge, TierProgress } from "./RankBadge";

export function ExerciseRankRow({
  rank,
  index = 0,
  compare,
  compareLabel = "Jij",
  board,
}: {
  rank: ExerciseRank;
  index?: number;
  /** Rang van de kijker voor dezelfde oefening (bij het bekijken van iemand anders); null = nog geen rang. */
  compare?: ExerciseRank | null;
  compareLabel?: string;
  /** Groepsranglijst voor deze oefening (inclusief jezelf, beste eerst); alleen getoond met minstens twee mensen. */
  board?: (BoardEntry & { self: boolean })[];
}) {
  const ex = EXERCISE_BY_SLUG[rank.slug];
  const name = ex?.name ?? rank.slug;
  const showBoard = !!board && board.length > 1;
  const myPlace = showBoard ? board.findIndex((e) => e.self) + 1 : 0;
  const boardText = showBoard
    ? `. In je groep: ${myPlace > 0 ? `plek ${myPlace} van ${board.length}` : `${board.length} mensen`}, ${board
        .slice(0, 3)
        .map((e, i) => `${i + 1}. ${e.name} ${formatBoardValue(e)}`)
        .join(", ")}`
    : "";
  return (
    <li className="animate-fade-up" style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
      <Link
        href={`/exercises/${rank.slug}`}
        className="card flex items-center gap-3 p-3 hover:border-muted"
        aria-label={`${name}: ${rank.tier.name}. ${describeRank(rank)}${compare !== undefined ? `. ${compareText(compare, compareLabel)}` : ""}${boardText}`}
      >
        <RankBadge tierIndex={rank.tierIndex} size={40} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold">{name}</p>
            <span className="shrink-0 text-xs font-semibold" style={{ color: rank.tier.to }}>
              {rank.tier.name}
            </span>
          </div>
          <TierProgress tierIndex={rank.tierIndex} progress={rank.progress} />
          <p className="text-xs text-muted">{describeRank(rank)}</p>
          {compare !== undefined && <CompareLine theirs={rank} mine={compare} label={compareLabel} />}
          {showBoard && <BoardLine entries={board} />}
        </div>
        <ChevronRightIcon className="shrink-0 text-muted" />
      </Link>
    </li>
  );
}

function compareText(mine: ExerciseRank | null, label: string) {
  return mine ? `${label}: ${mine.tier.name}` : `${label}: nog geen rang`;
}

/** "Jij: Goud · 12 kg meer" naast de rang van een vriend. */
function CompareLine({ theirs, mine, label }: { theirs: ExerciseRank; mine: ExerciseRank | null; label: string }) {
  if (!mine) {
    return (
      <p className="flex items-center gap-1.5 border-t border-line pt-1.5 text-xs text-muted" aria-hidden>
        <span className="font-semibold">{label}:</span> nog geen rang
      </p>
    );
  }
  const sameUnit = mine.unit === theirs.unit && !!mine.viaAdded === !!theirs.viaAdded;
  const diff = sameUnit ? Math.round((mine.value - theirs.value) * 10) / 10 : null;
  const ahead = mine.score > theirs.score;
  const equal = Math.abs(mine.score - theirs.score) < 0.005;
  return (
    <p className="flex items-center gap-1.5 border-t border-line pt-1.5 text-xs" aria-hidden>
      <span className="font-semibold text-muted">{label}:</span>
      <RankBadge tierIndex={mine.tierIndex} size={16} />
      <span className="font-semibold" style={{ color: mine.tier.to }}>
        {mine.tier.name}
      </span>
      {diff != null && diff !== 0 && (
        <span className={`ml-auto tabular-nums ${ahead ? "text-accent" : "text-muted"}`}>
          {diff > 0 ? "+" : "−"}
          {nl(Math.abs(diff))} {mine.unit === "reps" ? "reps" : mine.unit === "seconds" ? "s" : "kg"}
        </span>
      )}
      {(diff === 0 || (diff == null && equal)) && <span className="ml-auto text-muted">gelijk</span>}
    </p>
  );
}

/** "112 kg", "+20 kg" (extra gewicht), "15 reps" of "45 s". */
function formatBoardValue(e: BoardEntry): string {
  return formatRankAmount(e);
}

/** "Groep 1. Sven 112 kg  2. Jij 105 kg  3. Tom 90 kg": top 3, en jij erbij als je daar buiten valt. */
function BoardLine({ entries }: { entries: (BoardEntry & { self: boolean })[] }) {
  const top = entries.slice(0, 3);
  const selfIndex = entries.findIndex((e) => e.self);
  const shown =
    selfIndex >= 3
      ? [...top.slice(0, 2).map((e, i) => ({ e, place: i + 1 })), { e: entries[selfIndex], place: selfIndex + 1 }]
      : top.map((e, i) => ({ e, place: i + 1 }));
  return (
    <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 border-t border-line pt-1.5 text-xs" aria-hidden>
      <span className="font-semibold text-muted">Groep</span>
      {shown.map(({ e, place }) => (
        <span key={e.id} className="whitespace-nowrap">
          <span className="tabular-nums text-muted">{place}.</span>{" "}
          <span className={e.self ? "font-bold text-accent" : "font-medium"}>{e.self ? "Jij" : e.name.split(" ")[0] || e.name}</span>{" "}
          <span className="tabular-nums text-muted">{formatBoardValue(e)}</span>
        </span>
      ))}
    </p>
  );
}

const nl = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

export function describeRank(r: ExerciseRank): string {
  const best = formatRankBest(r);
  const target = nextTierTarget(r);
  if (!target) return `${best} · hoogste rang`;
  const next = TIERS[r.tierIndex + 1].name;
  // Bij een 1RM (ook met ondersteuning) helpt een voorbeeldset; bij reps, seconden en gewicht zegt de grens genoeg.
  const example = r.unit === "kg" && !r.viaAdded && !r.viaLoad ? ` (bijv. ${target.example})` : "";
  return `${best} · ${target.at} voor ${next}${example}`;
}
