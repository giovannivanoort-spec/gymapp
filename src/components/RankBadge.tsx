import { useId } from "react";
import { TIERS } from "@/lib/ranks";

/** Zeshoekige rang-badge met kleurverloop en een symbool per tier. */
export function RankBadge({
  tierIndex,
  size = 40,
  glow = false,
  className = "",
}: {
  tierIndex: number;
  size?: number;
  glow?: boolean;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const index = Math.max(0, Math.min(TIERS.length - 1, tierIndex));
  const tier = TIERS[index];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={tier.name}
      style={glow ? { filter: `drop-shadow(0 0 ${size / 6}px ${tier.from}aa)` } : undefined}
    >
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={tier.to} />
          <stop offset="1" stopColor={tier.from} />
        </linearGradient>
        <linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points="32,2 58,17 58,47 32,62 6,47 6,17" fill={`url(#g${id})`} />
      <polygon points="32,8 53,20 53,44 32,56 11,44 11,20" fill="#0b0d10" opacity="0.55" />
      <polygon points="32,8 53,20 53,32 11,32 11,20" fill={`url(#s${id})`} />
      <g fill="none" stroke={tier.to} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <Glyph index={index} color={tier.to} />
      </g>
    </svg>
  );
}

function Glyph({ index, color }: { index: number; color: string }) {
  const chevron = (y: number) => <polyline key={y} points={`22,${y + 6} 32,${y} 42,${y + 6}`} />;
  switch (index) {
    case 0:
      return chevron(30);
    case 1:
      return <>{[26, 34].map(chevron)}</>;
    case 2:
      return <>{[22, 30, 38].map(chevron)}</>;
    case 3:
      return <polygon points="32,20 42,30 32,44 22,30" />;
    case 4:
      return (
        <>
          <polygon points="32,19 43,29 32,45 21,29" fill={color} fillOpacity="0.25" />
          <polyline points="21,29 43,29" />
          <polyline points="27,29 32,45 37,29" />
        </>
      );
    case 5:
      return <polygon points="20,40 22,24 28,31 32,22 36,31 42,24 44,40" fill={color} fillOpacity="0.2" />;
    default:
      return (
        <path
          d="M32 18c5 6 10 10 10 17a10 10 0 0 1-20 0c0-4 2-7 4-9 0 3 2 5 4 5 0-5-1-9 2-13z"
          fill={color}
          fillOpacity="0.25"
        />
      );
  }
}

/** Badge met naam en optioneel een voortgangsbalk naar de volgende tier. */
export function RankPill({ tierIndex, label }: { tierIndex: number; label?: string }) {
  const tier = TIERS[tierIndex];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-0.5 pl-0.5 pr-2.5 text-xs font-semibold">
      <RankBadge tierIndex={tierIndex} size={20} />
      <span style={{ color: tier.to }}>{label ?? tier.name}</span>
    </span>
  );
}

export function TierProgress({ tierIndex, progress }: { tierIndex: number; progress: number }) {
  const tier = TIERS[tierIndex];
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-2">
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${Math.round(progress * 100)}%`, background: `linear-gradient(90deg, ${tier.from}, ${tier.to})` }}
      />
    </div>
  );
}
