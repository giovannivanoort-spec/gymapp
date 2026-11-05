"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { BodyMap } from "@/components/BodyMap";
import { ExerciseFilter } from "@/components/ExerciseFilter";
import { MuscleChips } from "@/components/MuscleChips";
import { useMyGroupsState } from "@/components/planning/sharing";
import { useRecentExercises } from "@/components/planning/useRecent";
import { useTemplateList } from "@/components/planning/useTemplateList";
import { ChevronRightIcon, ListIcon } from "@/components/Icons";
import { RankBadge } from "@/components/RankBadge";
import { ageFrom } from "@/lib/dates";
import { EQUIPMENT_LABEL, type Exercise } from "@/lib/exercise-types";
import { EXERCISES, EXERCISE_BY_SLUG } from "@/lib/exercises";
import type { ExerciseRank } from "@/lib/ranks";
import { useRanks } from "@/lib/useRanks";

const SCROLL_KEY = "gymapp-library-scroll";
const DONE_KEY = "gymapp-library-done";

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // geen opslag beschikbaar
  }
}

export default function ExercisesPage() {
  const userId = useUserId();
  const { profile } = useAuth();
  const data = useRanks(userId, profile?.bodyweight_kg ?? null, profile?.sex ?? null, ageFrom(profile?.birth_date));
  const rankBySlug = useMemo(() => new Map((data?.ranks ?? []).map((r) => [r.slug, r])), [data]);
  const recent = useRecentExercises(userId || null);
  // Leden hebben geen tabblad Schema's: hier de ingang, met wat de trainer gedeeld heeft.
  const { groups, trainerGroups } = useMyGroupsState(userId);
  const memberOnly = groups !== undefined && !trainerGroups?.length;
  const { templates } = useTemplateList(userId, memberOnly);
  const fromTrainer = templates?.filter((t) => t.owner_id !== userId).length ?? 0;
  const ownCount = templates ? templates.length - fromTrainer : 0;
  const [onlyDone, setOnlyDone] = useState(() => typeof window !== "undefined" && readSession(DONE_KEY) === "1");

  const done = useMemo(() => (recent ?? []).filter((s) => EXERCISE_BY_SLUG[s]).map((s) => EXERCISE_BY_SLUG[s]), [recent]);
  const source = onlyDone ? done : EXERCISES;

  // Terug uit een oefening: dezelfde plek in de lijst (zoekterm en filters bewaart ExerciseFilter zelf).
  useEffect(() => {
    const raw = readSession(SCROLL_KEY);
    writeSession(SCROLL_KEY, null);
    const y = raw ? Number(raw) : 0;
    if (!y) return;
    const id = requestAnimationFrame(() => window.scrollTo(0, y));
    return () => cancelAnimationFrame(id);
  }, []);

  function toggleDone(v: boolean) {
    setOnlyDone(v);
    writeSession(DONE_KEY, v ? "1" : null);
  }

  return (
    <AppShell title="Oefeningen">
      {memberOnly && (
        <Link
          href="/templates"
          className="card animate-fade-up mb-4 flex min-h-14 items-center gap-3 p-3 hover:border-muted active:scale-[0.99]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent" aria-hidden>
            <ListIcon size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold leading-tight">Schema&apos;s</span>
            <span className="block text-xs text-muted">
              {templates === undefined
                ? "Je schema's en die van je trainer"
                : fromTrainer > 0
                  ? `${fromTrainer} van je trainer${ownCount ? `, ${ownCount} van jezelf` : ""}`
                  : ownCount > 0
                    ? `${ownCount} eigen ${ownCount === 1 ? "schema" : "schema's"}`
                    : "Maak een schema of kopieer er een van je trainer"}
            </span>
          </span>
          {fromTrainer > 0 && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold tabular-nums text-accent-ink" aria-hidden>
              {fromTrainer}
            </span>
          )}
          <ChevronRightIcon size={16} className="shrink-0 text-muted" />
        </Link>
      )}
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-muted">
          {onlyDone
            ? `${done.length} ${done.length === 1 ? "oefening" : "oefeningen"} die je gelogd hebt, laatst gedaan eerst.`
            : `${EXERCISES.length} oefeningen met uitleg, video en spieren.`}
        </p>
        <div className="flex shrink-0 rounded-xl border border-line bg-surface-2 p-0.5 text-xs font-semibold" role="group" aria-label="Welke oefeningen">
          {[false, true].map((v) => (
            <button
              key={String(v)}
              onClick={() => toggleDone(v)}
              aria-pressed={onlyDone === v}
              disabled={v && recent === undefined}
              className={`min-h-11 rounded-[10px] px-3.5 transition ${onlyDone === v ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
            >
              {v ? `Gedaan${recent ? ` (${done.length})` : ""}` : "Alle"}
            </button>
          ))}
        </div>
      </div>

      {onlyDone && recent !== undefined && done.length === 0 ? (
        <div className="card animate-fade-up space-y-3 py-8 text-center">
          <p className="font-semibold">Nog niets gelogd</p>
          <p className="text-sm text-muted">Zodra je sets logt, vind je die oefeningen hier terug met je rang.</p>
          <button className="btn-ghost mx-auto min-h-11" onClick={() => toggleDone(false)}>
            Toon alle oefeningen
          </button>
        </div>
      ) : (
        <ExerciseFilter key={String(onlyDone)} exercises={source} prioritize={onlyDone ? recent : undefined} storageKey={onlyDone ? "library-done" : "library"}>
          {(list) => (
            <ul className="space-y-2">
              {list.map((e, i) => (
                <ExerciseRow key={e.slug} exercise={e} index={i} rank={rankBySlug.get(e.slug)} />
              ))}
            </ul>
          )}
        </ExerciseFilter>
      )}
    </AppShell>
  );
}

function rememberScroll() {
  writeSession(SCROLL_KEY, String(Math.round(window.scrollY)));
}

/**
 * Eén rij in de bibliotheek. Gememoïseerd en met content-visibility, zodat de lange lijst
 * (200+ spierkaartjes) alleen tekent wat in beeld is en typen in de zoekbalk vloeiend blijft.
 */
const ExerciseRow = memo(function ExerciseRow({ exercise: e, index, rank }: { exercise: Exercise; index: number; rank?: ExerciseRank }) {
  return (
    <li
      className={index < 10 ? "animate-fade-up" : undefined}
      style={{ "--i": index, contentVisibility: "auto", containIntrinsicSize: "auto 104px" } as React.CSSProperties}
    >
      <Link
        href={`/exercises/${e.slug}`}
        onClick={rememberScroll}
        className="card flex items-center gap-3 p-3 hover:border-muted active:scale-[0.99]"
      >
        <BodyMap primary={e.primary} secondary={e.secondary} labels={false} view="auto" decorative className="h-20 w-10 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold leading-tight">{e.name}</p>
            {rank && <RankBadge tierIndex={rank.tierIndex} size={24} className="shrink-0" />}
          </div>
          <p className="text-xs text-muted">{EQUIPMENT_LABEL[e.equipment]}</p>
          <MuscleChips primary={e.primary} secondary={e.secondary} limit={4} />
        </div>
      </Link>
    </li>
  );
});
