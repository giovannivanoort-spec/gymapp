"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronRightIcon, LockIcon } from "@/components/Icons";
import { ConfirmSheet } from "@/components/social/ConfirmSheet";
import { TrashIcon } from "@/components/social/icons";
import { toast } from "@/components/ui/Toast";
import type { ActivitySettingsState } from "@/lib/activity";
import { deleteAllSleep, formatSleepDuration, sleepErrorMessage, useSleepAvailable } from "@/lib/sleep";
import { MoonIcon } from "./icons";
import { saveSleepSettings, SLEEP_GOAL_LIMITS, useSleepGoal } from "./settings";
import { SleepEntrySheet } from "./SleepEntrySheet";

/** Na zo lang stilstaan wordt een gewijzigd slaapdoel opgeslagen. */
const GOAL_SAVE_DELAY = 700;

/**
 * Profiel → Koppelingen: het slaapblok (alleen met toestemming). Slaapdoel, handmatig invoeren, naar het
 * overzicht, de belofte dat slaap privé blijft, en alleen je slaap verwijderen.
 */
export function SleepSettingsSection({
  userId,
  settings,
  onRequestConsent,
  healthLinked,
}: {
  userId: string;
  settings: ActivitySettingsState;
  /** Opnieuw toestemming vragen (de server weigert slaap met toestemming van vóór slaap). */
  onRequestConsent: () => void;
  /** Health Connect is op dit toestel gekoppeld (dan komen de laatste nachten na verwijderen terug). */
  healthLinked: boolean;
}) {
  const available = useSleepAvailable();
  const { goal, synced } = useSleepGoal(userId);
  const [draft, setDraft] = useState<number | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number | null>(null);

  // Een nog niet opgeslagen slaapdoel alsnog opslaan bij weggaan van de pagina.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      const next = pending.current;
      if (next != null) saveSleepSettings(userId, { goalMinutes: next }).catch(() => {});
    };
  }, [userId]);

  function changeGoal(delta: number) {
    const { min, max } = SLEEP_GOAL_LIMITS;
    const next = Math.min(max, Math.max(min, (draft ?? goal) + delta));
    setDraft(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      timer.current = null;
      const value = pending.current;
      pending.current = null;
      if (value == null) return;
      try {
        await saveSleepSettings(userId, { goalMinutes: value });
      } catch (err) {
        toast.error(sleepErrorMessage(err));
      } finally {
        if (pending.current == null) setDraft(null);
      }
    }, GOAL_SAVE_DELAY);
  }

  async function removeSleep() {
    await deleteAllSleep(userId);
    setDeleteOpen(false);
    toast.success("Al je slaapgegevens zijn verwijderd");
  }

  const heading = (
    <div className="flex items-center gap-3 px-4 py-3">
      <MoonIcon size={18} className="shrink-0 text-muted" />
      <p className="min-w-0 flex-1 text-sm font-semibold">Slaap</p>
    </div>
  );

  if (available.data === false) {
    return (
      <div className="card divide-y divide-line p-0">
        {heading}
        <p className="px-4 py-3 text-xs text-muted">Slaap bijhouden is nog niet ingeschakeld. Je stappen werken gewoon.</p>
      </div>
    );
  }

  if (settings.needsReconsent) {
    return (
      <div className="card divide-y divide-line p-0">
        {heading}
        <div className="space-y-2 px-4 py-3 text-xs text-muted">
          <p>Om ook je slaap bij te houden, vragen we je opnieuw toestemming. Je stappen blijven gewoon staan.</p>
          <button type="button" className="btn-primary min-h-11 w-full text-xs" onClick={onRequestConsent}>
            Toestemming bijwerken
          </button>
        </div>
      </div>
    );
  }

  const shown = draft ?? goal;
  const { min, max, step } = SLEEP_GOAL_LIMITS;

  return (
    <div className="card animate-fade-up divide-y divide-line p-0">
      <Link href="/sleep" className="flex min-h-12 items-center gap-3 px-4 py-3 transition hover:bg-surface-2/40">
        <MoonIcon size={18} className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Slaap</p>
          <p className="text-xs text-muted">Je nachten per week en je gemiddelde</p>
        </div>
        <ChevronRightIcon size={16} className="shrink-0 text-muted" />
      </Link>

      {/* Slaapdoel */}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p id="sleep-goal-label" className="text-sm font-medium">
            Slaapdoel
          </p>
          <p className="text-xs text-muted">Per nacht{synced ? "" : " (op dit toestel)"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1" role="group" aria-labelledby="sleep-goal-label">
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-line text-lg font-semibold transition hover:border-muted active:scale-95 disabled:opacity-40"
            onClick={() => changeGoal(-step)}
            disabled={shown <= min}
            aria-label={`Slaapdoel ${step} minuten korter`}
          >
            −
          </button>
          <output className="w-24 text-center text-sm font-bold tabular-nums" aria-live="polite">
            {formatSleepDuration(shown)}
          </output>
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-line text-lg font-semibold transition hover:border-muted active:scale-95 disabled:opacity-40"
            onClick={() => changeGoal(step)}
            disabled={shown >= max}
            aria-label={`Slaapdoel ${step} minuten langer`}
          >
            +
          </button>
        </div>
      </div>

      {/* Handmatig invoeren */}
      <button
        type="button"
        className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2/40"
        onClick={() => setEntryOpen(true)}
        aria-haspopup="dialog"
      >
        <MoonIcon size={18} className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Slaap handmatig invoeren</p>
          <p className="text-xs text-muted">Bedtijd en wektijd van de afgelopen 7 nachten</p>
        </div>
        <ChevronRightIcon size={16} className="shrink-0 text-muted" />
      </button>

      <div className="flex items-start gap-3 px-4 py-3 text-xs text-muted">
        <LockIcon size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <p>
            Je slaap is alleen voor jou. Hij wordt nooit gedeeld met vrienden, groepen of je trainer, ook niet als je je stappen
            deelt. De AI-coach ziet hem alleen als je dat hierboven apart aanzet.
          </p>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1.5 font-semibold transition hover:text-danger"
            onClick={() => setDeleteOpen(true)}
            aria-haspopup="dialog"
          >
            <TrashIcon size={14} /> Alleen mijn slaap verwijderen
          </button>
        </div>
      </div>

      <SleepEntrySheet open={entryOpen} onClose={() => setEntryOpen(false)} userId={userId} onReconsent={onRequestConsent} />

      <ConfirmSheet
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Slaapgegevens verwijderen"
        body={
          <>
            <span className="font-semibold text-ink">Al je opgeslagen nachten worden definitief verwijderd</span>, van alle bronnen.
            Je stappen en je toestemming blijven staan.
            {healthLinked &&
              " Health Connect blijft gekoppeld: bij de volgende sync komen de laatste nachten terug. Wil je dat niet, zet dan Slaap uit in Health Connect onder App-rechten."}
          </>
        }
        confirmLabel="Slaap verwijderen"
        busyLabel="Verwijderen…"
        danger
        onConfirm={removeSleep}
      />
    </div>
  );
}
