"use client";

import { useState, useSyncExternalStore } from "react";
import { ChevronRightIcon, PlusIcon, CloseIcon } from "@/components/Icons";
import { ActivityEntrySheet } from "@/components/activity/ActivityEntrySheet";
import { ConsentSheet } from "@/components/activity/ConsentSheet";
import { StepsIcon } from "@/components/activity/icons";
import { effectiveSteps, sourceLine, useActivitySettings, useRecentActivity, type DailyActivity } from "@/lib/activity";
import { timeAgo, toISODate } from "@/lib/dates";
import { addDays, parseISODate } from "@/lib/week";

const fmt = (n: number) => Math.round(n).toLocaleString("nl-NL");
const BAR = "width 0.8s cubic-bezier(0.2,0.8,0.2,1)";

// "Niet nu" voor de uitnodiging op Home, per gebruiker op dit toestel. Daarna blijft het te vinden
// via Profiel → Koppelingen en de stappenranglijst.
const DISMISS_KEY = (uid: string) => `spotter:activity-cta-dismissed:${uid}`;
const dismissListeners = new Set<() => void>();
const hiddenThisSession = new Set<string>();
function subscribeDismiss(cb: () => void) {
  dismissListeners.add(cb);
  return () => {
    dismissListeners.delete(cb);
  };
}
function readDismissed(uid: string | null): boolean {
  if (!uid) return true;
  try {
    return window.localStorage.getItem(DISMISS_KEY(uid)) === "1";
  } catch {
    return false;
  }
}
function dismissCta(uid: string) {
  try {
    window.localStorage.setItem(DISMISS_KEY(uid), "1");
  } catch {
    // privévenster of geblokkeerde opslag: alleen voor nu verbergen
    hiddenThisSession.add(uid);
  }
  dismissListeners.forEach((cb) => cb());
}

/**
 * Stappen van vandaag op Home (alleen zichtbaar voor jou). Zonder toestemming één rustige regel
 * die naar de toestemming leidt (weg te tikken met "Niet nu"); zonder database-upgrade niets.
 * Tikken op de kaart opent handmatig invoeren.
 */
export function ActivityCard({ userId, today }: { userId: string; today: string }) {
  const uid = userId || null;
  const settingsS = useActivitySettings(uid);
  // Alleen ophalen met toestemming (en als het schema er is).
  const recent = useRecentActivity(settingsS.data?.consented ? uid : null, 7);
  const [consentOpen, setConsentOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const dismissed = useSyncExternalStore(
    subscribeDismiss,
    () => readDismissed(uid) || (!!uid && hiddenThisSession.has(uid)),
    () => true,
  );

  const settings = settingsS.data;
  let body: React.ReactNode;

  if (!settings) {
    // Nog onbekend of het aan staat: niets tonen (de meeste mensen houden geen stappen bij).
    body = null;
  } else if (!settings.available) {
    // Nog niet ingeschakeld: alleen in Profiel → Koppelingen een melding, niet op Home.
    body = null;
  } else if (!settings.consented) {
    body = dismissed ? null : (
      <CompactRow
        title="Stappen bijhouden"
        text="Dagelijkse stappen en je stappendoel, alleen voor jou"
        onClick={() => setConsentOpen(true)}
        onDismiss={uid ? () => dismissCta(uid) : undefined}
      />
    );
  } else if (settings.needsReconsent) {
    body = <CompactRow title="Toestemming bijwerken" text="De uitleg over je activiteitsgegevens is gewijzigd" onClick={() => setConsentOpen(true)} />;
  } else {
    body = (
      <StepsToday
        days={recent.data}
        failed={!recent.data && !!recent.error}
        from={recent.from}
        today={today}
        goal={settings.step_goal}
        onOpen={() => setEntryOpen(true)}
      />
    );
  }

  return (
    <>
      {body}
      {uid && (
        <>
          <ConsentSheet
            open={consentOpen}
            onClose={() => setConsentOpen(false)}
            userId={uid}
            reconsent={!!settings?.needsReconsent}
            onConsented={() => {
              setConsentOpen(false);
              if (!settings?.needsReconsent) setEntryOpen(true);
            }}
          />
          <ActivityEntrySheet open={entryOpen} onClose={() => setEntryOpen(false)} userId={uid} />
        </>
      )}
    </>
  );
}

function StepsToday({
  days,
  failed,
  from,
  today,
  goal,
  onOpen,
}: {
  days: DailyActivity[] | undefined;
  failed: boolean;
  from: string;
  today: string;
  goal: number;
  onOpen: () => void;
}) {
  const byDate = new Map((days ?? []).map((d) => [d.date, d]));
  const day = byDate.get(today) ?? null;
  const steps = effectiveSteps(day);
  const done = steps != null && steps >= goal;
  const pct = steps != null && goal > 0 ? Math.min(100, (steps / goal) * 100) : 0;

  // Zeven dagen t/m vandaag (van links oud naar rechts nieuw).
  const week = Array.from({ length: 7 }, (_, i) => toISODate(addDays(parseISODate(from), i)));
  const weekSteps = week.map((d) => effectiveSteps(byDate.get(d)));
  const max = Math.max(goal, ...weekSteps.map((s) => s ?? 0));
  const met = weekSteps.filter((s) => s != null && s >= goal).length;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="card animate-fade-up block w-full space-y-3 text-left hover:border-muted"
      aria-haspopup="dialog"
    >
      <span className="flex items-center justify-between">
        <span className="text-sm font-semibold uppercase tracking-wide text-muted">Stappen vandaag</span>
        <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-ink">
          <PlusIcon size={12} /> Invoeren
        </span>
      </span>

      {!days ? (
        failed ? (
          <span className="block text-sm text-muted">Nog niet geladen. Dit verschijnt zodra je verbinding hebt.</span>
        ) : (
          <span className="skeleton block h-8 w-2/3" />
        )
      ) : (
        <>
          <span className="flex items-baseline gap-1.5">
            {steps != null ? (
              <>
                <span className="text-2xl font-extrabold tabular-nums">{fmt(steps)}</span>
                <span className="text-sm text-muted">/ {fmt(goal)}</span>
                <span className={`ml-auto text-xs tabular-nums ${done ? "font-semibold text-accent" : "text-muted"}`}>
                  {done ? "Doel gehaald" : `nog ${fmt(goal - steps)}`}
                </span>
              </>
            ) : day ? (
              <span className="text-base font-semibold text-muted">Geen data vandaag</span>
            ) : (
              <span className="text-base font-semibold text-muted">Nog geen stappen vandaag</span>
            )}
          </span>
          <span className="block h-2 overflow-hidden rounded-full bg-surface-2">
            <span className={`block h-full rounded-full ${done ? "bg-accent" : "bg-accent/70"}`} style={{ width: `${pct}%`, transition: BAR }} />
          </span>
          {day && (
            <span className="block space-y-0.5 text-xs text-muted">
              {day.active_kcal != null && day.active_kcal > 0 && (
                <span className="block">~{fmt(day.active_kcal)} kcal actief (schatting)</span>
              )}
              <span className="block truncate">
                {sourceLine(day)}
                {day.source !== "manual" && day.synced_at ? ` · ${timeAgo(day.synced_at)}` : ""}
              </span>
            </span>
          )}
        </>
      )}

      <span className="block pt-1">
        <span className="flex h-10 items-end gap-1.5" aria-hidden>
          {week.map((d, i) => {
            const s = weekSteps[i];
            const h = s != null && max > 0 ? Math.max(6, (s / max) * 100) : 0;
            const hit = s != null && s >= goal;
            return (
              <span key={d} className="flex h-full flex-1 items-end">
                {s != null ? (
                  <span
                    className={`block w-full rounded-sm ${hit ? "bg-accent" : "bg-accent/35"}`}
                    style={{ height: `${h}%`, transition: "height 0.6s cubic-bezier(0.2,0.8,0.2,1)" }}
                  />
                ) : (
                  <span className="block h-1 w-full rounded-sm bg-line" />
                )}
              </span>
            );
          })}
        </span>
        <span className="mt-1 flex gap-1.5" aria-hidden>
          {week.map((d) => (
            <span key={d} className={`flex-1 text-center text-[10px] ${d === today ? "font-bold text-ink" : "text-muted"}`}>
              {parseISODate(d).toLocaleDateString("nl-NL", { weekday: "narrow" }).toUpperCase()}
            </span>
          ))}
        </span>
        <span className="sr-only">
          {met === 0 ? "De afgelopen 7 dagen nog geen dag op je stappendoel." : `${met} van de afgelopen 7 dagen op je stappendoel.`}
        </span>
      </span>
    </button>
  );
}

function CompactRow({ title, text, onClick, onDismiss }: { title: string; text: string; onClick?: () => void; onDismiss?: () => void }) {
  const inner = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
        <StepsIcon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted">{text}</span>
      </span>
      {onClick && <ChevronRightIcon className="shrink-0 text-muted" />}
    </>
  );
  if (!onClick) return <div className="card animate-fade-in flex min-h-[62px] items-center gap-3 py-3">{inner}</div>;
  const button = (
    <button
      type="button"
      onClick={onClick}
      className={`card animate-fade-in flex min-h-[62px] w-full items-center gap-3 py-3 text-left hover:border-muted ${onDismiss ? "pr-14" : ""}`}
    >
      {inner}
    </button>
  );
  if (!onDismiss) return button;
  return (
    <div className="relative">
      {button}
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink"
        aria-label="Niet nu, verbergen op Home"
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}
