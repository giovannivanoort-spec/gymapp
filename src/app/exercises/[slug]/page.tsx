"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { BodyMap, BodyMapLegend } from "@/components/BodyMap";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { RankBadge, TierProgress } from "@/components/RankBadge";
import { describeRank } from "@/components/RankRow";
import { formatDate } from "@/lib/dates";
import { EQUIPMENT_LABEL } from "@/lib/exercise-types";
import { EXERCISES, EXERCISE_BY_SLUG } from "@/lib/exercises";
import { GROUP_BY_ID, MUSCLE_BY_ID, type MuscleId } from "@/lib/muscles";
import { DEFAULT_VIDEOS } from "@/lib/exercise-videos";
import { errorMessage, supabase } from "@/lib/supabase";
import type { SetLog } from "@/lib/types";
import { parseYouTubeId, youtubeSearchUrl } from "@/lib/youtube";
import { ExternalIcon } from "@/components/Icons";
import { rankExercise, tierLadder, type ExerciseRank } from "@/lib/ranks";
import { fetchLogsBySlug } from "@/lib/useRanks";
import { ageFrom } from "@/lib/dates";

type HistoryLog = SetLog & { workout_exercises: { workout_id: string; workouts: { date: string; title: string } } };

export default function ExerciseDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const ex = EXERCISE_BY_SLUG[slug];
  const userId = useUserId();
  const { profile } = useAuth();
  const [rank, setRank] = useState<ExerciseRank | null | undefined>(undefined);
  const [customVideo, setCustomVideo] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState("");
  const [history, setHistory] = useState<{ date: string; title: string; sets: HistoryLog[] }[]>([]);

  useEffect(() => {
    supabase
      .from("exercise_videos")
      .select("youtube_id")
      .eq("exercise_slug", slug)
      .maybeSingle()
      .then(({ data }) => setCustomVideo(data?.youtube_id ?? null));

    supabase
      .from("set_logs")
      .select("*, workout_exercises!inner(exercise_slug, workout_id, workouts!inner(date, title))")
      .eq("user_id", userId)
      .eq("workout_exercises.exercise_slug", slug)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        const sessions = new Map<string, { date: string; title: string; sets: HistoryLog[] }>();
        for (const l of (data as HistoryLog[]) ?? []) {
          const key = l.workout_exercise_id;
          if (!sessions.has(key)) {
            sessions.set(key, { date: l.workout_exercises.workouts.date, title: l.workout_exercises.workouts.title, sets: [] });
          }
          sessions.get(key)!.sets.push(l);
        }
        const list = [...sessions.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
        list.forEach((s) => s.sets.sort((a, b) => a.set_number - b.set_number));
        setHistory(list);
      });
  }, [slug, userId]);

  useEffect(() => {
    fetchLogsBySlug(userId, [slug]).then((logs) =>
      setRank(rankExercise(slug, logs.get(slug) ?? [], profile?.bodyweight_kg ?? null, profile?.sex ?? null, ageFrom(profile?.birth_date))),
    );
  }, [slug, userId, profile?.bodyweight_kg, profile?.sex, profile?.birth_date]);

  async function saveVideo() {
    const id = parseYouTubeId(link);
    if (!id) return alert("Dat lijkt geen geldige YouTube-link.");
    const { error } = await supabase.from("exercise_videos").upsert({ exercise_slug: slug, youtube_id: id, updated_at: new Date().toISOString() });
    if (error) return alert(errorMessage(error));
    setCustomVideo(id);
    setEditing(false);
    setLink("");
  }

  if (!ex) {
    return (
      <AppShell title="Oefening" back="/exercises">
        <div className="card text-sm text-muted">Oefening niet gevonden.</div>
      </AppShell>
    );
  }

  const defaultVideo = DEFAULT_VIDEOS[ex.slug];
  const videoId = customVideo ?? defaultVideo?.id ?? null;
  const similar = EXERCISES.filter((e) => e.slug !== ex.slug && e.primary.some((m) => ex.primary.includes(m))).slice(0, 6);
  const best = history.flatMap((h) => h.sets).reduce<HistoryLog | null>((b, l) => ((l.weight ?? 0) > (b?.weight ?? 0) ? l : b), null);

  return (
    <AppShell title={ex.name} back>
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-muted">{ex.summary}</p>
          <p className="text-xs text-muted">Materiaal: {EQUIPMENT_LABEL[ex.equipment]}</p>
        </div>

        <RankSection
          slug={ex.slug}
          rank={rank}
          bodyweight={profile?.bodyweight_kg ?? null}
          sex={profile?.sex ?? null}
          age={ageFrom(profile?.birth_date)}
          equipment={ex.equipment}
        />

        <section className="card space-y-3">
          <h2 className="font-bold">Spieren</h2>
          <BodyMap primary={ex.primary} secondary={ex.secondary} className="mx-auto w-full max-w-xs" />
          <BodyMapLegend />
          <div className="space-y-3 text-sm">
            <MuscleList title="Hoofdspieren" muscles={ex.primary} main />
            {ex.secondary.length > 0 && <MuscleList title="Helpen mee" muscles={ex.secondary} />}
          </div>
        </section>

        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Video</h2>
            <button className="text-xs text-muted hover:text-ink" onClick={() => setEditing((v) => !v)}>
              Andere video kiezen
            </button>
          </div>
          {videoId ? (
            <div className="aspect-video overflow-hidden rounded-xl bg-black">
              <iframe
                className="h-full w-full"
                src={`https://www.youtube-nocookie.com/embed/${videoId}`}
                title={`${ex.name} uitleg`}
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <p className="text-sm text-muted">Geen video gevonden. Zoek er een op YouTube en plak de link via “Andere video kiezen”.</p>
          )}
          {videoId && !customVideo && defaultVideo && (
            <p className="text-xs text-muted">
              {defaultVideo.title} · {defaultVideo.channel}
            </p>
          )}
          {editing && (
            <div className="flex gap-2">
              <input className="input flex-1" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Plak YouTube-link" />
              <button className="btn-primary" onClick={saveVideo}>
                Opslaan
              </button>
            </div>
          )}
          <a href={youtubeSearchUrl(ex.videoQuery)} target="_blank" rel="noreferrer" className="btn-ghost w-full">
            Meer video&apos;s op YouTube <ExternalIcon size={15} />
          </a>
        </section>

        <section className="card space-y-3">
          <h2 className="font-bold">Zo voer je het uit</h2>
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
        </section>

        <section className="card space-y-2">
          <h2 className="font-bold">Tips & veelgemaakte fouten</h2>
          <ul className="space-y-2">
            {ex.tips.map((t, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="text-warn">!</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-bold">Jouw geschiedenis</h2>
            {best?.weight != null && <span className="text-xs text-muted">Record: {Number(best.weight)} kg × {best.reps}</span>}
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-muted">Je hebt deze oefening nog niet gelogd.</p>
          ) : (
            <ul className="divide-y divide-line">
              {history.map((h, i) => (
                <li key={i} className="py-2 text-sm">
                  <Link href={`/workouts/${h.sets[0].workout_exercises.workout_id}`} className="block">
                    <p className="text-xs text-muted">
                      {formatDate(h.date, { weekday: "short", month: "short" })} · {h.title}
                    </p>
                    <p>
                      {h.sets.map((l) => `${l.weight != null ? `${Number(l.weight)}kg×` : ""}${l.reps ?? "–"}`).join(" · ")}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {similar.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Vergelijkbare oefeningen</h2>
            <div className="flex flex-wrap gap-2">
              {similar.map((e) => (
                <Link key={e.slug} href={`/exercises/${e.slug}`} className="chip hover:border-accent hover:text-accent">
                  {e.name}
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}

/** Spieren met hun groep, bijv. "Borst · Bovenkant borst (clavicularis)". */
function MuscleList({ title, muscles, main }: { title: string; muscles: MuscleId[]; main?: boolean }) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted">{title}</p>
      <ul className="space-y-1">
        {muscles.map((id) => {
          const m = MUSCLE_BY_ID[id];
          return (
            <li key={id} className="flex items-baseline gap-2">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-sm ${main ? "bg-[#ff4d5e]" : "bg-[#ffa24a]"}`} />
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

function RankSection({
  slug,
  rank,
  bodyweight,
  sex,
  age,
  equipment,
}: {
  slug: string;
  rank: ExerciseRank | null | undefined;
  bodyweight: number | null;
  sex: "male" | "female" | null;
  age: number | null;
  equipment: string;
}) {
  const ladder = bodyweight && sex ? tierLadder(slug, bodyweight, sex, age) : null;
  if (!ladder && bodyweight && sex) {
    return (
      <section className="card text-sm text-muted">
        Voor deze oefening is geen betrouwbare krachtstandaard beschikbaar, dus er is geen rang.
      </section>
    );
  }
  if (!bodyweight || !sex) {
    return (
      <section className="card flex items-center justify-between gap-3 text-sm">
        <span className="text-muted">Vul je lichaamsgewicht en geslacht in om je rang voor deze oefening te zien.</span>
        <Link href="/profile" className="btn-ghost shrink-0 px-3 py-1.5 text-xs">
          Profiel
        </Link>
      </section>
    );
  }
  return (
    <section className="card space-y-4">
      <div className="flex items-center gap-4">
        <RankBadge tierIndex={rank?.tierIndex ?? 0} size={64} glow={!!rank} className={rank ? "animate-badge-reveal" : "opacity-30 grayscale"} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Jouw rang</p>
          <p className="text-xl font-bold" style={rank ? { color: rank.tier.to } : undefined}>
            {rank === undefined ? "…" : rank ? rank.tier.name : "Nog geen rang"}
          </p>
          {rank && <TierProgress tierIndex={rank.tierIndex} progress={rank.progress} />}
        </div>
      </div>
      <p className="text-xs text-muted">
        {rank ? describeRank(rank) : "Log een set (maximaal 12 reps) om je rang te krijgen."}
      </p>
      {ladder && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Nodig bij {bodyweight} kg{age != null ? `, ${age} jaar` : ""} {ladder.unit === "kg" ? `(1RM${equipment === "dumbbell" || equipment === "kettlebell" ? ", per dumbbell" : ""})` : "(reps)"}
          </p>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {ladder.steps.map((s, i) => (
              <div
                key={s.tier.id}
                className={`flex flex-col items-center gap-1 rounded-xl border p-2 ${rank && rank.tierIndex >= i + 1 ? "border-transparent bg-surface-2" : "border-line"}`}
              >
                <RankBadge tierIndex={i + 1} size={26} className={rank && rank.tierIndex >= i + 1 ? "" : "opacity-40"} />
                <span className="text-[11px] font-semibold tabular-nums">
                  {s.at}
                  {ladder.unit === "kg" ? " kg" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
