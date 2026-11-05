/** Lokale datum als YYYY-MM-DD (geen UTC-verschuiving). */
export function toISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD als lokale datum (middernacht), zonder UTC-verschuiving. */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * Datum in het Nederlands, standaard "maandag 3 november". Ligt de datum in een ander jaar,
 * dan komt het jaar erbij (tenzij `year` expliciet is meegegeven), zodat een training van vorig
 * jaar niet als dit jaar leest.
 */
export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = {}): string {
  const date = parseISODate(iso);
  const options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", ...opts };
  if (!("year" in opts) && options.month && date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
  return date.toLocaleDateString("nl-NL", options);
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

/** Aantal kalenderdagen tussen twee momenten (lokale tijd), los van het tijdstip op de dag. */
function calendarDaysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** "zojuist", "5 min geleden", "3 uur geleden", "gisteren", "4 dagen geleden", "12 okt" of "12 okt 2024". */
export function timeAgo(ts: string): string {
  const then = new Date(ts);
  if (Number.isNaN(then.getTime())) return "";
  const now = new Date();
  const diff = (now.getTime() - then.getTime()) / 1000;
  if (diff < 60) return "zojuist";
  if (diff < 3600) return `${Math.floor(diff / 60)} min geleden`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} uur geleden`;
  const days = calendarDaysBetween(then, now);
  if (days <= 1) return "gisteren";
  if (days < 7) return `${days} dagen geleden`;
  return then.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    ...(then.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
  });
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

/**
 * Hoe vers getoonde data is: "bijgewerkt om 18:42", "bijgewerkt gisteren om 18:42" of
 * "bijgewerkt op 3 nov". Null als het tijdstip (ms) onbekend is.
 */
export function updatedLabel(updatedAt: number | null | undefined, now = Date.now()): string | null {
  if (!updatedAt || updatedAt <= 0) return null;
  const d = new Date(updatedAt);
  const time = d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  const day = toISODate(d);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === toISODate(today)) return `bijgewerkt om ${time}`;
  if (day === toISODate(yesterday)) return `bijgewerkt gisteren om ${time}`;
  return `bijgewerkt op ${d.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" as const } : {}),
  })}`;
}
