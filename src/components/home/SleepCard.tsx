"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ConsentSheet } from "@/components/activity/ConsentSheet";
import { ChevronRightIcon, CloseIcon, PlusIcon } from "@/components/Icons";
import { goalMet, goalPct, nightLabel } from "@/components/sleep/format";
import { MoonIcon } from "@/components/sleep/icons";
import { useSleepGoal } from "@/components/sleep/settings";
import { SleepEntrySheet } from "@/components/sleep/SleepEntrySheet";
import { SleepWeekChart } from "@/components/sleep/SleepWeekChart";
import { useActivitySettings } from "@/lib/activity";
import { timeAgo, toISODate } from "@/lib/dates";
import {
  formatClockTime,
  formatSleepDuration,
  latestNight,
  sleepAverage,
  sleepSourceLine,
  useRecentSleep,
  useSleepAvailable,
} from "@/lib/sleep";
import { addDays, parseISODate } from "@/lib/week";

const BAR = "width 0.8s cubic-bezier(0.2,0.8,0.2,1)";

// "Niet nu" voor de slaapkaart zolang er geen enkele nacht is, per gebruiker op dit toestel. Komt er een
// nacht binnen (horloge, handmatig), dan staat de kaart er gewoon weer. Slaap blijft te vinden via
// Progressie en Profiel → Koppelingen.
const DISMISS_KEY = (uid: string) => `spotter:sleep-cta-dismissed:${uid}`;
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
  if (hiddenThisSession.has(uid)) return true;
  try {
    return window.localStorage.getItem(DISMISS_KEY(uid)) === "1";
  } catch {
    return false;
  }
}
function dismissEmpty(uid: string) {
  hiddenThisSession.add(uid);
  try {
    window.localStorage.setItem(DISMISS_KEY(uid), "1");
  } catch {
    // privévenster of geblokkeerde opslag: alleen voor nu verbergen
  }
  dismissListeners.forEach((cb) => cb());
}

/**
 * Slaap van afgelopen nacht op Home (alleen zichtbaar voor jou). Alleen met toestemming voor de huidige
 * tekst (die slaap noemt) en als upgrade-sleep.sql is gedraaid; de uitnodiging en "toestemming bijwerken"
 * staan op de stappenkaart (ActivityCard), zodat Home niet twee keer hetzelfde vraagt.
 * Tikken op de kaart opent het slaapoverzicht; "Invoeren" opent handmatig invullen.
 */
export function SleepCard({ userId, today }: { userId: string; today: string }) {
  const uid = userId || null;
  const settingsS = useActivitySettings(uid);
  const s = settingsS.data;
  const ready = !!s && s.available && s.consented && !s.needsReconsent;
  const available = useSleepAvailable();
  const recent = useRecentSleep(ready && available.data !== false ? uid : null, 7);
  const { goal } = useSleepGoal(uid);
  const [entryOpen, setEntryOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const dismissed = useSyncExternalStore(subscribeDismiss, () => readDismissed(uid), () => true);

  if (!uid || !ready || available.data === false) return null;

  const nights = recent.data;
  const night = latestNight(nights, today);
  const days = Array.from({ length: 7 }, (_, i) => toISODate(addDays(parseISODate(recent.from), i)));
  const avg = sleepAverage(nights ?? []);
  const hit = night ? goalMet(night.asleep_minutes, goal) : false;

  const sheets = (
    <>
      <SleepEntrySheet
        open={entryOpen}
        onClose={() => setEntryOpen(false)}
        userId={uid}
        onReconsent={() => {
          setEntryOpen(false);
          setConsentOpen(true);
        }}
      />
      <ConsentSheet open={consentOpen} onClose={() => setConsentOpen(false)} userId={uid} reconsent onConsented={() => setConsentOpen(false)} />
    </>
  );

  // Nog nooit (deze week) een nacht: een rustige regel in plaats van een lege kaart, weg te tikken.
  if (nights && nights.length === 0) {
    if (dismissed) return sheets;
    return (
      <>
        <div className="relative">
          <button
            type="button"
            onClick={() => setEntryOpen(true)}
            className="card animate-fade-in flex min-h-[62px] w-full items-center gap-3 py-3 pr-14 text-left hover:border-muted"
            aria-haspopup="dialog"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
              <MoonIcon size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Slaap bijhouden</span>
              <span className="block truncate text-xs text-muted">Vul je nacht in, of haal hem op met Health Connect</span>
            </span>
            <ChevronRightIcon className="shrink-0 text-muted" />
          </button>
          <button
            type="button"
            onClick={() => dismissEmpty(uid)}
            className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink"
            aria-label="Niet nu, verbergen op Home"
          >
            <CloseIcon size={16} />
          </button>
        </div>
        {sheets}
      </>
    );
  }

  return (
    <>
      <div className="relative animate-fade-up">
        <Link href="/sleep" className="card block space-y-3 hover:border-muted">
          <span className="flex items-center gap-2 pr-24">
            <span className="text-sm font-semibold uppercase tracking-wide text-muted">Slaap</span>
            {night && <span className="min-w-0 truncate text-xs text-muted">· {nightLabel(night.date, today).toLowerCase()}</span>}
          </span>

          {!nights ? (
            recent.error ? (
              <span className="block text-sm text-muted">Nog niet geladen. Dit verschijnt zodra je verbinding hebt.</span>
            ) : (
              <span className="skeleton block h-8 w-2/3" />
            )
          ) : night ? (
            <>
              <span className="flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold tabular-nums">{formatSleepDuration(night.asleep_minutes)}</span>
                <span className="text-sm text-muted">/ {formatSleepDuration(goal)}</span>
                <span className={`ml-auto text-xs tabular-nums ${hit ? "font-semibold text-accent" : "text-muted"}`}>
                  {hit ? "Doel gehaald" : `${formatSleepDuration(goal - night.asleep_minutes)} te kort`}
                </span>
              </span>
              <span className="block h-2 overflow-hidden rounded-full bg-surface-2">
                <span
                  className={`block h-full rounded-full ${hit ? "bg-accent" : "bg-accent/70"}`}
                  style={{ width: `${goalPct(night.asleep_minutes, goal)}%`, transition: BAR }}
                />
              </span>
              <span className="block space-y-0.5 text-xs text-muted">
                {night.bedtime && night.wake_time && (
                  <span className="block tabular-nums">
                    {formatClockTime(night.bedtime)} – {formatClockTime(night.wake_time)}
                  </span>
                )}
                <span className="block truncate">
                  {sleepSourceLine(night)}
                  {night.source !== "manual" && night.synced_at ? ` · ${timeAgo(night.synced_at)}` : ""}
                </span>
              </span>
            </>
          ) : (
            <span className="flex items-start gap-3">
              <MoonIcon size={20} className="mt-0.5 shrink-0 text-muted" />
              <span className="min-w-0">
                <span className="block text-base font-semibold text-muted">Nog geen slaap van afgelopen nacht</span>
                <span className="block text-xs text-muted">Vul hem zelf in, of haal hem op met Health Connect in de Android-app.</span>
              </span>
            </span>
          )}

          {nights && nights.length > 0 && (
            <span className="block pt-1">
              <SleepWeekChart days={days} nights={nights} goal={goal} today={today} compact />
              <span className="mt-1 block text-[11px] text-muted">
                {avg.avgMinutes != null
                  ? `Gemiddeld ${formatSleepDuration(avg.avgMinutes)} over ${avg.nights === 1 ? "1 nacht" : `${avg.nights} nachten`}`
                  : null}
              </span>
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setEntryOpen(true)}
          className="absolute right-3 top-3 flex min-h-9 items-center gap-1 rounded-full bg-surface-2 px-3 text-[11px] font-semibold text-ink transition hover:bg-line"
          aria-haspopup="dialog"
        >
          <PlusIcon size={12} /> Invoeren
        </button>
      </div>
      {sheets}
    </>
  );
}
