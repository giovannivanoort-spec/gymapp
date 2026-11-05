/**
 * Eenmalige melding voor de volgende pagina (bijv. "Schema opgeslagen" na opslaan en
 * terug naar de lijst). Leeft alleen in het geheugen.
 */
let pending: { text: string; at: number } | null = null;

export function setFlash(text: string) {
  pending = { text, at: Date.now() };
}

/** Bekijkt de melding zonder hem te wissen (als die vers is: minder dan 10 seconden oud). */
export function peekFlash(): string | null {
  return pending && Date.now() - pending.at < 10_000 ? pending.text : null;
}

/** Haalt de melding op als die vers is en wist hem. */
export function takeFlash(): string | null {
  const text = peekFlash();
  pending = null;
  return text;
}
