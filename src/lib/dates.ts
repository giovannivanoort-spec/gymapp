/** Lokale datum als YYYY-MM-DD (geen UTC-verschuiving). */
export function toISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = {}): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...opts,
  });
}

export function relativeDay(iso: string): string {
  const today = toISODate();
  if (iso === today) return "Vandaag";
  const t = new Date();
  t.setDate(t.getDate() + 1);
  if (iso === toISODate(t)) return "Morgen";
  t.setDate(t.getDate() - 2);
  if (iso === toISODate(t)) return "Gisteren";
  return formatDate(iso, { weekday: "short", month: "short" });
}

export function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return "zojuist";
  if (diff < 3600) return `${Math.floor(diff / 60)} min geleden`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} uur geleden`;
  return new Date(ts).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

/** Leeftijd in jaren uit een geboortedatum (YYYY-MM-DD). */
export function ageFrom(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age >= 0 && age < 130 ? age : null;
}
