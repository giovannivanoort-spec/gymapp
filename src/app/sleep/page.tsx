"use client";

import Link from "next/link";
import { useState } from "react";
import { ConsentSheet } from "@/components/activity/ConsentSheet";
import { AppShell } from "@/components/AppShell";
import { useUserId } from "@/components/AuthProvider";
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, LockIcon, PlusIcon } from "@/components/Icons";
import { DataStatus } from "@/components/platform/DataStatus";
import { LoadError } from "@/components/platform/LoadError";
import { goalMet, nightLabel, shortWakeDay } from "@/components/sleep/format";
import { MoonIcon } from "@/components/sleep/icons";
import { NightDetail } from "@/components/sleep/NightDetail";
import { sleepCoachOn, useSleepGoal } from "@/components/sleep/settings";
import { SleepEntrySheet } from "@/components/sleep/SleepEntrySheet";
import { SleepWeekChart } from "@/components/sleep/SleepWeekChart";
import { EmptyState } from "@/components/ui/States";
import { useActivitySettings } from "@/lib/activity";
import { toISODate } from "@/lib/dates";
import { formatSleepDuration, manualSleepDates, sleepAverage, useLatestSleep, useMySleep, useSleepAvailable } from "@/lib/sleep";
import { formatWeekRange, weekRange } from "@/lib/week";

/** Zo ver terug kun je bladeren (in weken). */
const MAX_WEEKS_BACK = 52;

/**
 * Slaapoverzicht: de laatste nacht in detail, een week met balkjes per nacht en het gemiddelde, en
 * handmatig invoeren. Alleen voor jezelf; bereikbaar via de slaapkaart op Home en via Progressie.
 */
export default function SleepPage() {
  const userId = useUserId();
  const uid = userId || null;
  const settingsS = useActivitySettings(uid);
  const s = settingsS.data;
  const available = useSleepAvailable();
  const ready = !!s && s.available && s.consented && !s.needsReconsent && available.data !== false;

  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [entry, setEntry] = useState<{ open: boolean; date?: string }>({ open: false });
  const [consentOpen, setConsentOpen] = useState(false);

  const today = toISODate();
  const week = weekRange(weekOffset);
  const prev = weekRange(weekOffset - 1);
  const weekS = useMySleep(ready ? uid : null, week.from, week.to);
  const prevS = useMySleep(ready ? uid : null, prev.from, prev.to);
  const latest = useLatestSleep(ready ? uid : null);
  const { goal } = useSleepGoal(uid);

  const manualDates = manualSleepDates();
  const openEntry = (date?: string) => setEntry({ open: true, date });

  let body: React.ReactNode;
  if (!uid || (!s && !settingsS.error)) {
    body = <PageSkeleton />;
  } else if (!s) {
    body = <LoadError error={settingsS.error} onRetry={settingsS.retry} retrying={settingsS.refreshing} title="Kon je slaap niet laden" />;
  } else if (!s.available || available.data === false) {
    body = (
      <EmptyState
        icon={<MoonIcon size={24} />}
        title="Slaap bijhouden is nog niet ingeschakeld"
        text="Zodra het is ingeschakeld, zie je hier hoe lang je slaapt."
        action={{ label: "Naar Home", href: "/" }}
      />
    );
  } else if (!s.consented) {
    body = (
      <EmptyState
        icon={<MoonIcon size={24} />}
        title="Houd je slaap bij"
        text="Zie per nacht hoe lang je sliep, handmatig of via je telefoon en horloge. Alleen voor jou. Daarvoor vragen we eerst je toestemming."
        action={{ label: "Toestemming geven", onClick: () => setConsentOpen(true) }}
      />
    );
  } else if (s.needsReconsent) {
    body = (
      <EmptyState
        icon={<MoonIcon size={24} />}
        title="Toestemming bijwerken"
        text="De uitleg over je activiteitsgegevens noemt nu ook je slaap. Geef opnieuw toestemming om je slaap bij te houden. Je gegevens blijven staan."
        action={{ label: "Bekijken", onClick: () => setConsentOpen(true) }}
      />
    );
  } else {
    const nights = weekS.data;
    const avg = sleepAverage(nights ?? []);
    const prevAvg = sleepAverage(prevS.data ?? []);
    const delta = avg.avgMinutes != null && prevAvg.avgMinutes != null ? avg.avgMinutes - prevAvg.avgMinutes : null;
    const onGoal = (nights ?? []).filter((n) => goalMet(n.asleep_minutes, goal)).length;
    const sel = selected ? (nights ?? []).find((n) => n.date === selected) ?? null : null;
    const weekLabel = weekOffset === 0 ? "Deze week" : weekOffset === -1 ? "Vorige week" : formatWeekRange(week);

    body = (
      <div className="space-y-6">
        {/* Laatste nacht */}
        <section className="card space-y-3" aria-labelledby="sleep-last-h">
          <h2 id="sleep-last-h" className="text-sm font-semibold uppercase tracking-wide text-muted">
            {latest.night ? nightLabel(latest.night.date, today) : "Afgelopen nacht"}
          </h2>
          {latest.night ? (
            <NightDetail night={latest.night} goal={goal} />
          ) : !latest.data ? (
            latest.error ? (
              <LoadError error={latest.error} onRetry={latest.retry} retrying={latest.refreshing} compact />
            ) : (
              <div className="space-y-2" aria-busy>
                <div className="skeleton h-9 w-1/2" />
                <div className="skeleton h-2" />
                <div className="skeleton h-14" />
              </div>
            )
          ) : (
            <EmptyState
              compact
              icon={<MoonIcon size={20} />}
              title="Nog geen slaap van afgelopen nacht"
              text="Vul hem zelf in, of koppel je telefoon en horloge via Health Connect in de Android-app."
              action={{ label: "Slaap invoeren", onClick: () => openEntry(today) }}
            />
          )}
        </section>

        {/* Week */}
        <section className="card space-y-4" aria-labelledby="sleep-week-h">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-line transition hover:border-muted disabled:opacity-40"
              onClick={() => {
                setWeekOffset((w) => w - 1);
                setSelected(null);
              }}
              disabled={weekOffset <= -MAX_WEEKS_BACK}
              aria-label="Vorige week"
            >
              <ChevronLeftIcon size={18} />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <h2 id="sleep-week-h" className="text-sm font-semibold">
                {weekLabel}
              </h2>
              {weekOffset > -2 && <p className="text-xs text-muted">{formatWeekRange(week)}</p>}
            </div>
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-line transition hover:border-muted disabled:opacity-40"
              onClick={() => {
                setWeekOffset((w) => Math.min(0, w + 1));
                setSelected(null);
              }}
              disabled={weekOffset >= 0}
              aria-label="Volgende week"
            >
              <ChevronRightIcon size={18} />
            </button>
          </div>

          <DataStatus state={weekS} title="Kon deze week niet laden" />

          {nights === undefined ? (
            weekS.error ? null : <div className="skeleton h-44" aria-busy />
          ) : nights.length === 0 ? (
            <EmptyState
              compact
              icon={<MoonIcon size={20} />}
              title={weekOffset === 0 ? "Nog geen nachten deze week" : "Geen nachten in deze week"}
              text={weekOffset === 0 ? "Vul je slaap in of synchroniseer via Health Connect." : undefined}
            />
          ) : (
            <>
              <SleepWeekChart days={week.days} nights={nights} goal={goal} today={today} selected={selected} onSelect={(d) => setSelected((cur) => (cur === d ? null : d))} />
              <div className="grid grid-cols-3 border-t border-line pt-3 text-center">
                <div>
                  <p className="text-lg font-extrabold tabular-nums">{formatSleepDuration(avg.avgMinutes)}</p>
                  <p className="text-xs text-muted">gemiddeld</p>
                  {delta != null && (
                    <p className={`mt-0.5 inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${delta > 0 ? "text-accent" : "text-muted"}`}>
                      {delta > 0 ? <ArrowUpIcon size={10} /> : delta < 0 ? <ArrowDownIcon size={10} /> : null}
                      {delta === 0 ? "gelijk" : formatSleepDuration(Math.abs(delta))}
                      <span className="sr-only"> ten opzichte van de week ervoor</span>
                    </p>
                  )}
                </div>
                <div className="border-l border-line">
                  <p className="text-lg font-extrabold tabular-nums">
                    {onGoal}/{avg.nights}
                  </p>
                  <p className="text-xs text-muted">op je doel</p>
                </div>
                <div className="border-l border-line">
                  <p className="text-lg font-extrabold tabular-nums">{formatSleepDuration(goal)}</p>
                  <p className="text-xs text-muted">slaapdoel</p>
                </div>
              </div>
              {!selected && <p className="text-center text-xs text-muted">Tik op een nacht voor de details.</p>}
            </>
          )}

          {sel && (
            <div className="animate-fade-in space-y-3 rounded-xl border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold first-letter:uppercase">{nightLabel(sel.date, today)}</p>
                {manualDates.includes(sel.date) && (
                  <button type="button" className="btn-ghost min-h-9 px-3 text-xs" onClick={() => openEntry(sel.date)}>
                    Aanpassen
                  </button>
                )}
              </div>
              <NightDetail night={sel} goal={goal} />
            </div>
          )}
          {selected && !sel && <p className="text-center text-xs text-muted">Geen gegevens voor {shortWakeDay(selected)}.</p>}
        </section>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-primary" onClick={() => openEntry()}>
            <PlusIcon size={16} /> Slaap invoeren
          </button>
          <Link href="/profile#koppelingen" className="btn-ghost">
            Slaapdoel en koppelingen
          </Link>
        </div>

        <p className="flex items-start gap-2 text-xs text-muted">
          <LockIcon size={14} className="mt-0.5 shrink-0" />
          <span>
            Je slaap is alleen voor jou: vrienden, groepen en je trainer zien hem niet.
            {sleepCoachOn(s)
              ? " Je hebt de AI-coach toegang gegeven tot je slaap; dat zet je uit bij Koppelingen."
              : " Ook de AI-coach ziet hem niet, tenzij je dat zelf aanzet bij Koppelingen."}
          </span>
        </p>
      </div>
    );
  }

  return (
    <AppShell title="Slaap" back>
      {body}
      {uid && s?.available && (
        <>
          <ConsentSheet
            open={consentOpen}
            onClose={() => setConsentOpen(false)}
            userId={uid}
            reconsent={!!s.needsReconsent}
            onConsented={() => setConsentOpen(false)}
          />
          <SleepEntrySheet
            open={entry.open}
            onClose={() => setEntry({ open: false })}
            userId={uid}
            date={entry.date}
            onReconsent={() => {
              setEntry({ open: false });
              setConsentOpen(true);
            }}
          />
        </>
      )}
    </AppShell>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Slaap laden">
      <div className="skeleton h-44" />
      <div className="skeleton h-64" />
    </div>
  );
}
