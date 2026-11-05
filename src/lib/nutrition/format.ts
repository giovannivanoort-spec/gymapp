/** Getal in Nederlandse notatie (1.234,5), standaard afgerond op hele getallen. */
export function fmt(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("nl-NL", { maximumFractionDigits: digits });
}

/** "12,5" of "12.5" → 12.5; leeg of ongeldig → NaN. */
export function parseAmount(s: string): number {
  const t = s.trim();
  return t === "" ? NaN : Number(t.replace(",", "."));
}
