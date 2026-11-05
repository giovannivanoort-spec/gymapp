"use client";

import Link from "next/link";
import { useState } from "react";
import { useCachedState } from "@/lib/cache";
import { formatDate } from "@/lib/dates";
import { EQUIPMENT_LABEL, type Exercise } from "@/lib/exercise-types";
import { DEFAULT_VIDEOS } from "@/lib/exercise-videos";
import type { Session } from "@/lib/history";
import { GROUP_BY_ID, MUSCLE_BY_ID, type MuscleId } from "@/lib/muscles";
import { supabase } from "@/lib/supabase";
import { youtubeSearchUrl } from "@/lib/youtube";
import { BodyMap, BodyMapLegend, MUSCLE_COLOR } from "../BodyMap";
import { ChevronRightIcon, ExternalIcon, PlayIcon } from "../Icons";
import { MuscleChips } from "../MuscleChips";
import { Sheet } from "../Sheet";
import { lastHint } from "./useLastSessions";

export const exerciseVideoKey = (slug: string) => `ex-video:${slug}`;

/**
 * Uitlegvideo van een oefening: een eigen gekozen video (gedeeld via de database) of de
 * standaardvideo. `ready` is pas true als bekend is of er een eigen video is, zodat YouTube
 * niet eerst de verkeerde laadt. Bij een fout valt hij terug op de standaardvideo.
 */
export function useExerciseVideo(slug: string | null) {
  const key = slug ? exerciseVideoKey(slug) : null;
  const st = useCachedState<{ id: string | null }>(
    key,
    async () => {
      const { data, error } = await supabase.from("exercise_videos").select("youtube_id").eq("exercise_slug", slug!).maybeSingle();
      if (error) throw error;
      return { id: (data?.youtube_id as string | undefined) ?? null };
    },
    { persist: true, maxAge: 5 * 60_000 },
  );
  const fallback = slug ? DEFAULT_VIDEOS[slug] : undefined;
  const custom = st.data?.id ?? null;
  return {
    key,
    ready: st.data !== undefined || !!st.error,
    custom,
    fallback,
    id: custom ?? fallback?.id ?? null,
  };
}

/** Lichte YouTube-embed: eerst alleen een plaatje, de speler laadt pas na een tik. */
export function VideoPlayer({ id, title }: { id: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
      {playing ? (
        <iframe
          className="h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`}
          title={title}
          loading="lazy"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button
          onClick={() => setPlaying(true)}
          className="group absolute inset-0 flex items-center justify-center bg-cover bg-center"
          style={{ backgroundImage: `url(https://i.ytimg.com/vi/${id}/hqdefault.jpg)` }}
          aria-label={`Speel video af: ${title}`}
        >
          <span className="absolute inset-0 bg-black/25 transition group-hover:bg-black/10" />
          <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-lg transition group-active:scale-90">
            <PlayIcon size={24} />
          </span>
        </button>
      )}
    </div>
  );
}

/** Spieren met hun groep, bijv. "Borst · Bovenkant borst (clavicularis)". */
export function MuscleList({ title, muscles, main }: { title: string; muscles: MuscleId[]; main?: boolean }) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted">{title}</p>
      <ul className="space-y-1">
        {muscles.map((id) => {
          const m = MUSCLE_BY_ID[id];
          return (
            <li key={id} className="flex items-baseline gap-2">
              <span
                className="mt-1 h-2 w-2 shrink-0 rounded-sm"
                style={{ background: main ? MUSCLE_COLOR.primary : MUSCLE_COLOR.secondary }}
                aria-hidden
              />
              <span>
                <span className="text-muted">{GROUP_BY_ID[m.group].name} · </span>
                {m.name}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Ronde info-knop van 44px voor naast een rij in een keuzelijst. */
export function InfoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-ink active:scale-90"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 7.5v.01" />
      </svg>
    </button>
  );
}

/**
 * Uitleg van een oefening in een paneel (spierkaart, video, stappen, tips en je vorige keer),
 * zodat je in de builder of een keuzelijst kunt kijken zonder je werk te verlaten.
 */
export function ExerciseInfoSheet({
  exercise,
  onClose,
  action,
  last,
  pageLink = false,
}: {
  exercise: Exercise | null;
  onClose: () => void;
  /** Hoofdknop onderaan, bijv. "Toevoegen" in de oefeningkiezer. */
  action?: { label: string; run: (e: Exercise) => void };
  /** Je laatste sessie met deze oefening (voor "Vorige keer"). */
  last?: Session;
  /** Link naar de volledige oefeningpagina tonen (niet in de builder: dan verlaat je je plan). */
  pageLink?: boolean;
}) {
  return (
    <Sheet open={!!exercise} onClose={onClose} title={exercise?.name ?? "Oefening"}>
      {exercise && <InfoBody key={exercise.slug} ex={exercise} action={action} last={last} pageLink={pageLink} />}
    </Sheet>
  );
}

function InfoBody({
  ex,
  action,
  last,
  pageLink,
}: {
  ex: Exercise;
  action?: { label: string; run: (e: Exercise) => void };
  last?: Session;
  pageLink: boolean;
}) {
  const video = useExerciseVideo(ex.slug);
  const [allTips, setAllTips] = useState(false);
  const hint = lastHint(last, ex.slug, "8-12", 3);
  const tips = allTips ? ex.tips : ex.tips.slice(0, 2);

  return (
    <div className="space-y-5">
      <div className="space-y-2.5">
        <p className="text-sm text-muted">{ex.summary}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="chip py-0.5">{EQUIPMENT_LABEL[ex.equipment]}</span>
          <MuscleChips primary={ex.primary} secondary={ex.secondary} />
        </div>
      </div>

      {hint && (
        <div className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Jouw vorige keer · {formatDate(hint.date, { month: "short" })}
          </p>
          <p className="tabular-nums">{hint.last}</p>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-4">
        <BodyMap primary={ex.primary} secondary={ex.secondary} className="w-full" />
        <div className="space-y-3 text-sm">
          <MuscleList title="Hoofdspieren" muscles={ex.primary} main />
          {ex.secondary.length > 0 && <MuscleList title="Helpen mee" muscles={ex.secondary} />}
        </div>
      </div>
      <BodyMapLegend />

      <div className="space-y-2">
        <h3 className="font-bold">Video</h3>
        {!video.ready ? (
          <div className="skeleton aspect-video" />
        ) : video.id ? (
          <VideoPlayer key={video.id} id={video.id} title={`${ex.name} uitleg`} />
        ) : (
          <a href={youtubeSearchUrl(ex.videoQuery)} target="_blank" rel="noreferrer" className="btn-ghost min-h-11 w-full">
            Zoek een video op YouTube <ExternalIcon size={15} />
          </a>
        )}
      </div>

      <div className="space-y-2.5">
        <h3 className="font-bold">Zo voer je het uit</h3>
        <ol className="space-y-2.5">
          {ex.steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-ink">
                {i + 1}
              </span>
              <span className="pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
      </div>

      {ex.tips.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-bold">Let op</h3>
          <ul className="space-y-2">
            {tips.map((t, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="font-bold text-warn" aria-hidden>
                  !
                </span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
          {ex.tips.length > 2 && (
            <button onClick={() => setAllTips((v) => !v)} className="min-h-11 text-sm font-medium text-muted hover:text-ink">
              {allTips ? "Minder tips" : `Alle ${ex.tips.length} tips`}
            </button>
          )}
        </div>
      )}

      {(action || pageLink) && (
        <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-line bg-surface px-5 py-3">
          {pageLink && (
            <Link href={`/exercises/${ex.slug}`} className="btn-ghost min-h-11 flex-1">
              Volledige pagina <ChevronRightIcon size={15} />
            </Link>
          )}
          {action && (
            <button className="btn-primary min-h-11 flex-1" onClick={() => action.run(ex)}>
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
