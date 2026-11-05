"use client";

import { useId, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { getCached, setCached, useCachedState } from "@/lib/cache";
import { errorMessage, supabase } from "@/lib/supabase";
import type { NotificationKind, NotificationPrefs } from "@/lib/types";
import { LoadError } from "./LoadError";

type Prefs = Pick<NotificationPrefs, NotificationKind>;
type Loaded = { available: boolean; prefs: Prefs };

const DEFAULTS: Prefs = { plan: true, reminder: true, weekly: true, activity: true };

const OPTIONS: { kind: NotificationKind; label: string; description: string }[] = [
  {
    kind: "plan",
    label: "Geplande trainingen",
    description: "'s Ochtends de training van vandaag, 's avonds wat er morgen gepland staat.",
  },
  {
    kind: "reminder",
    label: "Nog niet gelogd",
    description: "'s Avonds een seintje als je de training van vandaag nog niet hebt ingevuld.",
  },
  {
    kind: "weekly",
    label: "Weekoverzicht",
    description: "Zondagavond: je trainingen tegenover je weekdoel en je nieuwe records.",
  },
  {
    kind: "activity",
    label: "Records van je groep",
    description: "Als iemand uit je groep een record zet of een rang omhoog gaat.",
  },
];

const prefsKey = (userId: string) => `notify-prefs:${userId}`;

/** Tabel bestaat nog niet (supabase/upgrade-platform.sql niet gedraaid). */
function isMissingTable(error: { code?: string; message?: string }): boolean {
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "") || /does not exist|schema cache/i.test(error.message ?? "");
}

async function fetchPrefs(userId: string): Promise<Loaded> {
  const { data, error } = await supabase
    .from("notification_prefs")
    .select("plan, reminder, weekly, activity")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { available: false, prefs: DEFAULTS };
    throw error;
  }
  return { available: true, prefs: { ...DEFAULTS, ...((data as Partial<Prefs> | null) ?? {}) } };
}

/**
 * Per soort meldingen aan- of uitzetten (geldt voor al je apparaten). Hoort onder de PushToggle
 * in Profiel. Toont niets zolang de database er nog niet klaar voor is (upgrade-platform.sql).
 */
export function NotificationSettings({ className = "" }: { className?: string }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const key = userId ? prefsKey(userId) : null;
  const st = useCachedState<Loaded>(key, () => fetchPrefs(userId!), { persist: true, maxAge: 60_000 });
  const [busy, setBusy] = useState<NotificationKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();
  const baseId = useId();

  if (!userId || !key) return null;
  if (st.data && !st.data.available) return null;

  async function toggle(kind: NotificationKind) {
    if (!userId || !key || busy) return;
    const current = getCached<Loaded>(key);
    if (!current) return;
    const next: Loaded = { ...current, prefs: { ...current.prefs, [kind]: !current.prefs[kind] } };
    setBusy(kind);
    setError(null);
    // Direct omzetten; bij een fout terug naar de vorige stand.
    setCached(key, next, true);
    const { error: saveError } = await supabase
      .from("notification_prefs")
      .upsert({ user_id: userId, ...next.prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (saveError) {
      setCached(key, current, true);
      setError(`Niet opgeslagen: ${errorMessage(saveError)}`);
    }
    setBusy(null);
  }

  return (
    <div className={`card space-y-1 ${className}`} role="group" aria-labelledby={headingId}>
      <div className="pb-1">
        <p id={headingId} className="font-semibold">
          Welke meldingen
        </p>
        <p className="text-xs text-muted">Geldt voor al je apparaten. Je krijgt per avond hooguit één melding.</p>
      </div>

      {st.data === undefined && st.error ? (
        <LoadError error={st.error} onRetry={st.retry} retrying={st.refreshing} compact />
      ) : (
        <ul className="divide-y divide-line">
          {OPTIONS.map((o, i) => {
            const labelId = `${baseId}-l${i}`;
            const descId = `${baseId}-d${i}`;
            const on = st.data?.prefs[o.kind] ?? true;
            const pending = busy === o.kind;
            return (
              <li key={o.kind} className="flex items-center justify-between gap-3 py-3 first:pt-2 last:pb-1">
                <div className="min-w-0">
                  <p id={labelId} className="text-sm font-medium">
                    {o.label}
                  </p>
                  <p id={descId} className="text-xs text-muted">
                    {o.description}
                  </p>
                </div>
                {st.data === undefined ? (
                  <span className="skeleton h-7 w-12 shrink-0 rounded-full" aria-hidden />
                ) : (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-labelledby={labelId}
                    aria-describedby={descId}
                    aria-busy={pending}
                    disabled={!!busy}
                    onClick={() => toggle(o.kind)}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 ${on ? "bg-accent" : "bg-surface-2 ring-1 ring-line"}`}
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full shadow transition-all duration-200 motion-reduce:transition-none ${
                        on ? "left-6 bg-accent-ink" : "left-1 bg-muted"
                      } ${pending ? "animate-pulse" : ""}`}
                    />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p role="alert" className="animate-fade-in pt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
