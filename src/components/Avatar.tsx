import Link from "next/link";

/** Kleur per persoon (stabiel op basis van het id), zodat vrienden herkenbaar zijn. */
const HUES = [205, 160, 280, 25, 330, 55, 190, 250];

export function avatarHue(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Ronde avatar met initialen. Optioneel een gekleurde ring (bijv. de kleur van iemands rang). */
export function Avatar({
  id,
  name,
  size = 40,
  ring,
  className = "",
}: {
  id: string;
  name: string;
  size?: number;
  ring?: string;
  className?: string;
}) {
  const hue = avatarHue(id || name);
  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(140deg, hsl(${hue} 55% 34%), hsl(${hue} 60% 20%))`,
        color: `hsl(${hue} 90% 88%)`,
        boxShadow: ring ? `0 0 0 2px var(--color-bg), 0 0 0 ${size > 44 ? 4 : 3.5}px ${ring}` : undefined,
      }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** Profielknop rechtsboven. */
export function ProfileButton({ id, name }: { id: string; name: string }) {
  return (
    <Link
      href="/profile"
      aria-label="Profiel"
      className="rounded-full transition-transform duration-200 hover:scale-105 active:scale-95"
    >
      <Avatar id={id} name={name} size={34} />
    </Link>
  );
}
