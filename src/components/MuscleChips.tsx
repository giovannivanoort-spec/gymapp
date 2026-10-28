import { MUSCLE_BY_ID, type MuscleId } from "@/lib/muscles";

export function MuscleChips({
  primary,
  secondary = [],
  limit,
}: {
  primary: MuscleId[];
  secondary?: MuscleId[];
  /** Maximaal aantal chips; de rest wordt als "+n" getoond. */
  limit?: number;
}) {
  const all = [...primary.map((m) => ({ m, main: true })), ...secondary.map((m) => ({ m, main: false }))];
  const shown = limit ? all.slice(0, limit) : all;
  const rest = all.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map(({ m, main }) => (
        <span
          key={m}
          title={MUSCLE_BY_ID[m].name}
          className={
            main
              ? "rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent"
              : "rounded-full border border-line px-2 py-0.5 text-xs text-muted"
          }
        >
          {MUSCLE_BY_ID[m].short}
        </span>
      ))}
      {rest > 0 && <span className="px-1 py-0.5 text-xs text-muted">+{rest}</span>}
    </div>
  );
}
