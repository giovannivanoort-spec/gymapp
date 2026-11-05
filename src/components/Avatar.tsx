"use client";

import Link from "next/link";
import { useState } from "react";

/** Kleur per persoon (stabiel op basis van het id), zodat vrienden herkenbaar zijn. */
const HUES = [205, 160, 280, 25, 330, 55, 190, 250];

export function avatarHue(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

/** Eerste "teken" zoals een mens het ziet (ook bij accenten in losse tekens of tekens buiten de BMP). */
let segmenter: Intl.Segmenter | null | undefined;

function firstGrapheme(word: string): string {
  const w = word.normalize("NFC");
  if (segmenter === undefined) {
    segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("nl", { granularity: "grapheme" }) : null;
  }
  if (segmenter) {
    const first = segmenter.segment(w)[Symbol.iterator]().next();
    if (!first.done) return first.value.segment;
  }
  return Array.from(w)[0] ?? "";
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (firstGrapheme(parts[0]) + (parts.length > 1 ? firstGrapheme(parts[parts.length - 1]) : "")).toLocaleUpperCase("nl");
}

/**
 * Alleen foto's uit de eigen Supabase-bucket "avatars" tonen (zelfde regel als de check in
 * upgrade-avatars.sql), zodat een toestel nooit een afbeelding van een andere server laadt.
 */
const AVATAR_PREFIX = (() => {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  return base.startsWith("https://") ? `${base}/storage/v1/object/public/avatars/` : null;
})();
const AVATAR_PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i;

function safeSrc(src: string | null | undefined): string | null {
  if (!AVATAR_PREFIX || typeof src !== "string" || !src.startsWith(AVATAR_PREFIX)) return null;
  return AVATAR_PATH.test(src.slice(AVATAR_PREFIX.length)) ? src : null;
}

/**
 * Ronde avatar: de profielfoto als die er is, anders initialen. Optioneel een gekleurde ring
 * (bijv. de kleur van iemands rang). Laadt de foto niet (offline, verwijderd), dan valt hij
 * terug op de initialen.
 */
export function Avatar({
  id,
  name,
  src,
  size = 40,
  ring,
  className = "",
}: {
  id: string;
  name: string;
  /** Publieke URL van de profielfoto (profiles.avatar_url). */
  src?: string | null;
  size?: number;
  ring?: string;
  className?: string;
}) {
  const url = safeSrc(src);
  // Onthoud welke URL mislukte; een nieuwe foto krijgt zo vanzelf een nieuwe kans.
  const [failed, setFailed] = useState<string | null>(null);
  const hue = avatarHue(id || name);
  const style: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: size * 0.38,
    background: `linear-gradient(140deg, hsl(${hue} 55% 34%), hsl(${hue} 60% 20%))`,
    color: `hsl(${hue} 90% 88%)`,
    boxShadow: ring ? `0 0 0 2px var(--color-bg), 0 0 0 ${size > 44 ? 4 : 3.5}px ${ring}` : undefined,
  };

  if (url && failed !== url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- kleine, al verkleinde foto uit Supabase Storage
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(url)}
        className={`inline-block shrink-0 select-none rounded-full object-cover ${className}`}
        style={style}
        aria-hidden
      />
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold ${className}`}
      style={style}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/**
 * Profielknop rechtsboven. Raakvlak van 44px (vingervriendelijk) rond een avatar van 34px;
 * de negatieve marge houdt de avatar visueel op dezelfde plek tegen de rand.
 * `badge`: aantal openstaande dingen (bijv. vriendschapsverzoeken), als teller op de avatar.
 */
export function ProfileButton({
  id,
  name,
  src,
  size = 34,
  badge = 0,
  className = "",
}: {
  id: string;
  name: string;
  /** Eigen profielfoto (profiles.avatar_url). */
  src?: string | null;
  size?: number;
  badge?: number;
  className?: string;
}) {
  const base = name ? `Profiel van ${name}` : "Profiel";
  const label = badge > 0 ? `${base}, ${badge} ${badge === 1 ? "vriendschapsverzoek" : "vriendschapsverzoeken"}` : base;
  return (
    <Link
      href="/profile"
      aria-label={label}
      className={`group -my-1.5 -mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${className}`}
    >
      <span className="relative rounded-full transition-transform duration-200 group-hover:scale-105 group-active:scale-95">
        <Avatar id={id} name={name} src={src} size={size} />
        {badge > 0 && <CountBadge count={badge} className="absolute -right-1.5 -top-1" />}
      </span>
    </Link>
  );
}

/** Kleine teller (bijv. op een avatar of icoon). Boven 9 wordt het "9+", zodat hij rond blijft. */
export function CountBadge({ count, className = "" }: { count: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`animate-badge-in flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none tabular-nums text-accent-ink ring-2 ring-bg ${className}`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
