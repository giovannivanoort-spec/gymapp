let seq = 0;

/**
 * Uniek onderwerp voor een realtime-kanaal. `removeChannel` vertrekt asynchroon en tot dat klaar is,
 * geeft `supabase.channel()` met hetzelfde onderwerp het vertrekkende kanaal terug (waarop
 * `subscribe` niets doet). Een kanaal dat opnieuw wordt opgezet (StrictMode, ander filter) krijgt
 * daarom elke keer een eigen onderwerp.
 */
export function liveTopic(name: string): string {
  return `${name}-${++seq}`;
}
