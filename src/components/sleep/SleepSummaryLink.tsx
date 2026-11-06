"use client";

import Link from "next/link";
import { ChevronRightIcon } from "@/components/Icons";
import { useActivitySettings } from "@/lib/activity";
import { formatSleepDuration, sleepAverage, useRecentSleep, useSleepAvailable } from "@/lib/sleep";
import { MoonIcon } from "./icons";

/**
 * Rij naar het slaapoverzicht (bijv. op Progressie), met het gemiddelde van de afgelopen 7 nachten.
 * Niets zonder toestemming (voor de huidige tekst) of zolang slaap nog niet is ingeschakeld.
 */
export function SleepSummaryLink({ userId }: { userId: string | null }) {
  const s = useActivitySettings(userId).data;
  const ready = !!s && s.available && s.consented && !s.needsReconsent;
  const available = useSleepAvailable();
  const recent = useRecentSleep(ready && available.data !== false ? userId : null, 7);
  if (!userId || !ready || available.data === false) return null;

  const avg = sleepAverage(recent.data ?? []);
  const text = !recent.data
    ? recent.error
      ? "Bekijk je slaap per nacht en per week"
      : "Laden…"
    : avg.avgMinutes != null
      ? `Gemiddeld ${formatSleepDuration(avg.avgMinutes)} over de afgelopen ${avg.nights === 1 ? "nacht" : `${avg.nights} nachten`}`
      : "Nog geen nachten de afgelopen week. Vul je slaap in of koppel je horloge.";

  return (
    <Link href="/sleep" className="card animate-fade-in flex min-h-[62px] items-center gap-3 py-3 hover:border-muted">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-accent">
        <MoonIcon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Slaap</span>
        <span className="block truncate text-xs text-muted">{text}</span>
      </span>
      <ChevronRightIcon className="shrink-0 text-muted" />
    </Link>
  );
}
