"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckIcon, ChevronRightIcon, DumbbellIcon, PlusIcon, RefreshIcon } from "@/components/Icons";
import { relativeDay } from "@/lib/dates";
import type { UpcomingWorkout } from "./data";

/**
 * Vandaag geen training gepland: rustdag, of vandaag al gelogd (bijv. een training van gisteren
 * ingehaald), met de volgende training of (voor trainers) een knop om te plannen.
 */
export function RestCard({
  loading,
  failed,
  trainedToday,
  next,
  planGroupId,
  onRetry,
}: {
  loading: boolean;
  failed: boolean;
  trainedToday: boolean;
  next: UpcomingWorkout | null;
  planGroupId: string | null;
  onRetry: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  if (loading) {
    if (!failed) return <div className="skeleton h-[76px]" aria-label="Training van vandaag laden" />;
    return (
      <section className="card animate-fade-in flex items-center gap-3" aria-label="Vandaag">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
          <DumbbellIcon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Trainingen nog niet geladen</p>
          <p className="text-xs text-muted">Ze verschijnen zodra je verbinding hebt.</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onRetry().finally(() => setBusy(false));
          }}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:text-ink active:scale-95 disabled:opacity-70"
          aria-label="Trainingen opnieuw laden"
        >
          {busy ? <span className="spinner text-[16px]" aria-hidden /> : <RefreshIcon size={18} />}
        </button>
      </section>
    );
  }
  const row = (
    <>
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          trainedToday ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"
        }`}
      >
        {trainedToday ? <CheckIcon size={20} strokeWidth={2.6} /> : <DumbbellIcon size={20} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{trainedToday ? "Vandaag getraind" : "Geen training vandaag"}</p>
        <p className="truncate text-xs text-muted">
          {next ? (
            <>
              Volgende: <span className="text-ink">{next.title}</span>, {relativeDay(next.date).toLowerCase()}
            </>
          ) : planGroupId ? (
            "Nog niets gepland. Plan de volgende training voor je groep."
          ) : (
            "Nog niets gepland. Je trainer plant de volgende training."
          )}
        </p>
      </div>
      {next && <ChevronRightIcon className="shrink-0 text-muted" />}
    </>
  );
  return (
    <section className="animate-scale-in" aria-label="Vandaag">
      {next ? (
        <Link href={`/workouts/${next.id}`} className="card flex items-center gap-3 transition-colors hover:border-muted">
          {row}
        </Link>
      ) : (
        <div className="card space-y-3">
          <div className="flex items-center gap-3">{row}</div>
          {planGroupId && (
            <Link href={`/groups/${planGroupId}/plan`} className="btn-ghost w-full">
              <PlusIcon size={16} /> Training plannen
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
