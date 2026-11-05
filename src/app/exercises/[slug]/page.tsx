"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { BodyMap, BodyMapLegend } from "@/components/BodyMap";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { ExternalIcon, PlusIcon } from "@/components/Icons";
import { LineChart, type ChartPoint } from "@/components/LineChart";
import { MuscleChips } from "@/components/MuscleChips";
import { AddToTemplateSheet } from "@/components/planning/AddToTemplateSheet";
import { GroupBest } from "@/components/planning/GroupBest";
import { DataStatus } from "@/components/platform/DataStatus";
import { MuscleList, useExerciseVideo, VideoPlayer } from "@/components/planning/ExerciseInfo";
import { notify } from "@/components/planning/notify";
import { RankBadge, TierProgress } from "@/components/RankBadge";
import { describeRank } from "@/components/RankRow";
import { alternativesFor } from "@/lib/analysis";
import { setCached } from "@/lib/cache";
import { ageFrom, formatDate } from "@/lib/dates";
import { EQUIPMENT_LABEL } from "@/lib/exercise-types";
import { EXERCISE_BY_SLUG, isTimed } from "@/lib/exercises";
import { formatSet, nl, sessionsBySlug, useHistoryState, type Session } from "@/lib/history";
import { assistedCeiling, assistedScore, isAssisted, isLoadScored, rankExercise, standardInfo, tierLadder, type ExerciseRank } from "@/lib/ranks";
import { errorMessage, supabase } from "@/lib/supabase";
import { parseYouTubeId, youtubeSearchUrl } from "@/lib/youtube";

export default function ExerciseDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const ex = EXERCISE_BY_SLUG[slug];
  const userId = useUserId();
  const { profile } = useAuth();
  const bodyweight = profile?.bodyweight_kg ?? null;
  const sex = profile?.sex ?? null;
  const age = ageFrom(profile?.birth_date);

  // Video-instellingen horen bij één oefening: bij het wisselen van oefening opnieuw beginnen.
  const [prevSlug, setPrevSlug] = useState(slug);
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  if (slug !== prevSlug) {
    setPrevSlug(slug);
    setEditing(false);
    setLink("");
    setLinkError(null);
    setAddOpen(false);
  }

  // Geschiedenis en rang komen uit de gedeelde (gecachete) trainingsgeschiedenis: direct zichtbaar
  // en altijd van de oefening die nu open staat (geen losse verzoeken die elkaar kunnen inhalen).
  // Met foutstatus: zonder cache en zonder verbinding toont de pagina een foutmelding met "Opnieuw"
  // in plaats van een eindeloos skeleton.
  const historyState = useHistoryState(userId || null);
  const history = historyState.data;
  const historyFailed = history === undefined && !!historyState.error;
  const mine = useMemo(() => history?.filter((s) => s.slug === slug), [history, slug]);
  const sessions = useMemo(() => (mine ? [...(sessionsBySlug(mine).get(slug) ?? [])].reverse() : undefined), [mine, slug]);
  const rank = useMemo<ExerciseRank | null | undefined>(
    () => (mine ? rankExercise(slug, mine.map((s) => ({ weight: s.weight, reps: s.reps })), bodyweight, sex, age) : undefined),
    [mine, slug, bodyweight, sex, age],
  );
  const best = bestSession(sessions);
  const chart = useMemo(() => progressPoints(sessions), [sessions]);

  const video = useExerciseVideo(ex ? slug : null);
  const videoKey = video.key ?? `ex-video:${slug}`;

  const similar = useMemo(() => (ex ? alternativesFor(ex).slice(0, 8) : []), [ex]);

  if (!ex) {
    return (
      <AppShell title="Oefening" back="/exercises">
        <div className="card space-y-3 text-sm">
          <p className="text-muted">Deze oefening bestaat niet (meer).</p>
          <Link href="/exercises" className="btn-ghost min-h-11 w-full">
            Naar alle oefeningen
          </Link>
        </div>
      </AppShell>
    );
  }

  const defaultVideo = video.fallback;
  const customVideo = video.custom;
  // Pas een video tonen als bekend is of er een eigen video is (anders laadt YouTube twee keer).
  const videoReady = video.ready;
  const videoId = video.id;

  async function saveVideo() {
    const id = parseYouTubeId(link);
    if (!id) return setLinkError("Dat lijkt geen geldige YouTube-link. Kopieer de link via Delen in YouTube.");
    setVideoBusy(true);
    setLinkError(null);
    const { error } = await supabase
      .from("exercise_videos")
      .upsert({ exercise_slug: slug, youtube_id: id, updated_at: new Date().toISOString() });
    setVideoBusy(false);
    if (error) return setLinkError(`Opslaan mislukt: ${errorMessage(error)}`);
    setCached(videoKey, { id }, true);
    setEditing(false);
    setLink("");
    notify("Video bijgewerkt");
  }

  async function restoreDefault() {
    setVideoBusy(true);
    setLinkError(null);
    const { error } = await supabase.from("exercise_videos").delete().eq("exercise_slug", slug);
    setVideoBusy(false);
    if (error) return setLinkError(`Herstellen mislukt: ${errorMessage(error)}`);
    setCached(videoKey, { id: null }, true);
    setEditing(false);
    setLink("");
    notify(defaultVideo ? "Standaardvideo hersteld" : "Video weggehaald");
  }

  return (
    <AppShell title={ex.name} back>
      <div className="space-y-5">
        <div className="space-y-3">
          <p className="text-muted">{ex.summary}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="chip py-0.5">{EQUIPMENT_LABEL[ex.equipment]}</span>
            <MuscleChips primary={ex.primary} />
          </div>
          <button className="btn-ghost min-h-11 w-full" onClick={() => setAddOpen(true)}>
            <PlusIcon size={16} /> Toevoegen aan schema
          </button>
        </div>

        <RankSection slug={ex.slug} rank={historyFailed ? null : rank} unknown={historyFailed} bodyweight={bodyweight} sex={sex} age={age} equipment={ex.equipment} />

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
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold">Video</h2>
            {!editing && (
              <button
                className="-mr-2 min-h-11 rounded-lg px-3 text-xs text-muted hover:text-ink"
                onClick={() => {
                  setEditing(true);
                  setLinkError(null);
                }}
              >
                Andere video kiezen
              </button>
            )}
          </div>
          {!videoReady ? (
            <div className="skeleton aspect-video" />
          ) : videoId ? (
            <VideoPlayer key={videoId} id={videoId} title={`${ex.name} uitleg`} />
          ) : (
            <p className="text-sm text-muted">Nog geen video. Zoek er een op YouTube en plak de link via &quot;Andere video kiezen&quot;.</p>
          )}
          {videoReady && videoId && !customVideo && defaultVideo && (
            <p className="text-xs text-muted">
              {defaultVideo.title} · {defaultVideo.channel}
            </p>
          )}
          {videoReady && customVideo && <p className="text-xs text-muted">Video gekozen door iemand uit de app.</p>}
          {editing && (
            <form
              className="animate-fade-in space-y-2 rounded-xl bg-surface-2 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                saveVideo();
              }}
            >
              <label className="label" htmlFor="video-link">
                YouTube-link
              </label>
              <input
                id="video-link"
                className="input bg-surface"
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  setLinkError(null);
                }}
                placeholder="https://youtu.be/..."
                inputMode="url"
                autoComplete="off"
                autoFocus
                aria-invalid={!!linkError}
                aria-describedby="video-help"
              />
              <p id="video-help" className={`text-xs ${linkError ? "text-danger" : "text-muted"}`}>
                {linkError ?? "Deze video zien alle gebruikers van de app bij deze oefening."}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="submit" className="btn-primary min-h-11 flex-1" disabled={videoBusy || !link.trim()}>
                  {videoBusy ? "Bezig…" : "Opslaan"}
                </button>
                <button type="button" className="btn-ghost min-h-11 flex-1" onClick={() => setEditing(false)} disabled={videoBusy}>
                  Annuleren
                </button>
                {customVideo && (
                  <button
                    type="button"
                    className="min-h-11 w-full rounded-lg text-xs text-muted hover:text-ink"
                    onClick={restoreDefault}
                    disabled={videoBusy}
                  >
                    {defaultVideo ? "Standaardvideo herstellen" : "Video weghalen"}
                  </button>
                )}
              </div>
            </form>
          )}
          <a href={youtubeSearchUrl(ex.videoQuery)} target="_blank" rel="noreferrer" className="btn-ghost min-h-11 w-full">
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
                <span className="font-bold text-warn" aria-hidden>
                  !
                </span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card space-y-3">
          <h2 className="font-bold">Jouw geschiedenis</h2>
          {/* Fout zonder data: foutkaart met "Opnieuw proberen"; met oude data: een compacte regel erboven. */}
          <DataStatus state={historyState} title="Geschiedenis laden mislukt" />
          {historyFailed ? null : sessions === undefined ? (
            <div className="space-y-2" aria-busy>
              <div className="skeleton h-12" />
              <div className="skeleton h-12" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted">Je hebt deze oefening nog niet gelogd.</p>
          ) : (
            <>
              {chart && (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{chart.title}</p>
                  <LineChart points={chart.points} unit={chart.unit} ranges label={`${chart.title} ${ex.name}`} />
                </div>
              )}
              {best && (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Beste set</p>
                    <p className="font-bold tabular-nums">
                      {isAssisted(slug) && best.bestSet.weight
                        ? `${nl(best.bestSet.weight)} kg ondersteuning × ${best.bestSet.reps ?? "–"}`
                        : formatSet(best.bestSet)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted">
                    {best.best1RM != null && !isLoadScored(slug) && <p className="tabular-nums">ca. {nl(best.best1RM)} kg 1RM</p>}
                    <p>{formatDate(best.date, { month: "short" })}</p>
                  </div>
                </div>
              )}
              <ul className="divide-y divide-line">
                {sessions.slice(0, 8).map((h) => (
                  <li key={h.sets[0].workoutExerciseId} className="text-sm">
                    <Link href={`/workouts/${h.workoutId}`} className="-mx-2 block rounded-lg px-2 py-2 hover:bg-surface-2">
                      <p className="text-xs text-muted">
                        {formatDate(h.date, { weekday: "short", month: "short" })} · {h.workoutTitle}
                      </p>
                      <p className="tabular-nums">
                        {h.sets.map((l) => `${l.weight != null ? `${nl(l.weight)}kg×` : ""}${l.reps ?? "–"}`).join(" · ")}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
              {sessions.length > 8 && <p className="text-xs text-muted">Laatste 8 van {sessions.length} trainingen.</p>}
            </>
          )}
        </section>

        {userId && <GroupBest slug={ex.slug} userId={userId} />}

        {similar.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Vergelijkbare oefeningen</h2>
            <div className="flex flex-wrap gap-2">
              {similar.map((e) => (
                <Link key={e.slug} href={`/exercises/${e.slug}`} className="chip min-h-11 py-1.5 hover:border-accent hover:text-accent">
                  {e.name}
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      <AddToTemplateSheet
        exercise={ex}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(t) => {
          setAddOpen(false);
          notify(`Toegevoegd aan "${t.name}"`);
        }}
      />
    </AppShell>
  );
}

/**
 * Sessie met de hoogste geschatte 1RM (zelfde berekening als de ranks), anders die met de meeste reps.
 * Assisted machine: de sessie met de minste ondersteuning (bij gelijke hulp de meeste reps).
 */
function bestSession(sessions: Session[] | undefined): Session | null {
  if (!sessions?.length) return null;
  if (isAssisted(sessions[0].sets[0]?.slug)) {
    const score = (s: Session) => assistedScore(s.bestSet.weight, s.bestSet.reps) ?? 0;
    return sessions.reduce((a, b) => (score(b) > score(a) ? b : a));
  }
  // Dragen/duwen: de rang gaat op het zwaarste gewicht, dus ook hier de sessie met het zwaarste gewicht.
  if (isLoadScored(sessions[0].sets[0]?.slug)) return sessions.reduce((a, b) => (heaviest(b) > heaviest(a) ? b : a));
  const withE = sessions.filter((s) => s.best1RM != null);
  if (withE.length) return withE.reduce((a, b) => (b.best1RM! > a.best1RM! ? b : a));
  return sessions.reduce((a, b) => (b.maxReps > a.maxReps ? b : a));
}

/**
 * Voortgang per training: geschatte 1RM (of bij oefeningen zonder gewicht de meeste reps),
 * met de records gemarkeerd. Pas zinvol vanaf twee trainingen.
 */
function progressPoints(sessions: Session[] | undefined): { points: ChartPoint[]; unit: string; title: string } | null {
  if (!sessions || sessions.length < 2) return null;
  // Assisted machine: gewicht is ondersteuning; een 1RM- of reps-lijn zou de verkeerde kant op wijzen.
  if (isAssisted(sessions[0].sets[0]?.slug)) return null;
  const chrono = [...sessions].reverse();
  if (isLoadScored(chrono[0].sets[0]?.slug)) {
    const points = prPoints(chrono, heaviest, (s) => s.sets.reduce((a, b) => ((b.weight ?? 0) > (a.weight ?? 0) ? b : a)));
    return points.length < 2 ? null : { points, unit: "kg", title: "Zwaarste set" };
  }
  const weighted = chrono.some((s) => s.best1RM != null);
  let top = -Infinity;
  const points: ChartPoint[] = [];
  for (const s of chrono) {
    const value = weighted ? s.best1RM : s.maxReps;
    if (value == null || value <= 0) continue;
    const pr = value > top;
    if (pr) top = value;
    points.push({ date: s.date, value, detail: formatSet(s.bestSet), pr: pr && points.length > 0 });
  }
  if (points.length < 2) return null;
  if (weighted) return { points, unit: "kg", title: "Geschatte 1RM" };
  return isTimed(chrono[0].sets[0]?.slug) ? { points, unit: "s", title: "Langste set" } : { points, unit: "reps", title: "Meeste reps in een set" };
}

/** Zwaarste gewicht van een set met reps in deze sessie (0 als er geen is). */
function heaviest(s: Session): number {
  return Math.max(0, ...s.sets.filter((x) => (x.reps ?? 0) > 0).map((x) => x.weight ?? 0));
}

/** Grafiekpunten (oud → nieuw) met records gemarkeerd. */
function prPoints(chrono: Session[], valueOf: (s: Session) => number | null, setOf: (s: Session) => Session["bestSet"]): ChartPoint[] {
  let top = -Infinity;
  const points: ChartPoint[] = [];
  for (const s of chrono) {
    const value = valueOf(s);
    if (value == null || value <= 0) continue;
    const pr = value > top;
    if (pr) top = value;
    points.push({ date: s.date, value, detail: formatSet(setOf(s)), pr: pr && points.length > 0 });
  }
  return points;
}

/** Wat de getallen in de tier-ladder betekenen: "(1RM, per dumbbell)", "(reps)", "(seconden)". */
function ladderMeasure(ladder: NonNullable<ReturnType<typeof tierLadder>>, equipment: string): string {
  const perDumbbell = equipment === "dumbbell" || equipment === "kettlebell" ? ", per dumbbell" : "";
  if (ladder.unit === "reps") return "(reps)";
  if (ladder.unit === "seconds") return "(seconden)";
  if (ladder.scoring === "load") return `(zwaarste set${equipment === "dumbbell" ? ", per dumbbell" : ""})`;
  if (ladder.scoring === "assisted") return "(1RM van lichaamsgewicht min ondersteuning)";
  return `(1RM${perDumbbell})`;
}

/** Eerlijke vermelding bij een afgeleide of geschatte standaard (geen gemeten StrengthLevel-data). */
function EstimateNote({ slug }: { slug: string }) {
  const info = standardInfo(slug);
  if (!info?.estimated) return null;
  const basedOn = info.basedOn ? (EXERCISE_BY_SLUG[info.basedOn]?.name ?? info.basedOn) : null;
  return (
    <p className="mt-2 text-[11px] text-muted">
      {basedOn
        ? `Geschatte standaard op basis van ${basedOn}.`
        : "Geschatte standaard: voor deze oefening zijn geen gemeten krachtstandaarden, dit is een schatting van gangbare niveaus."}
    </p>
  );
}

function RankSection({
  slug,
  rank,
  unknown,
  bodyweight,
  sex,
  age,
  equipment,
}: {
  slug: string;
  rank: ExerciseRank | null | undefined;
  /** Geschiedenis kon niet geladen worden: rang is onbekend (geen eindeloos "..."). */
  unknown?: boolean;
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
        <Link href="/profile" className="btn-ghost min-h-11 shrink-0 px-3 text-xs">
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
            {unknown ? (
              "Rang onbekend"
            ) : rank === undefined ? (
              <span className="skeleton inline-block h-6 w-28 align-middle" aria-label="Rang laden" />
            ) : rank ? (
              rank.tier.name
            ) : (
              "Nog geen rang"
            )}
          </p>
          {rank && <TierProgress tierIndex={rank.tierIndex} progress={rank.progress} />}
        </div>
      </div>
      <p className="text-xs text-muted">
        {unknown
          ? "Je geschiedenis kon niet geladen worden, daarom is je rang nu onbekend."
          : rank
            ? describeRank(rank)
            : rank === undefined
              ? "Je rang wordt berekend uit je gelogde sets."
              : ladder?.unit === "seconds"
                ? "Log een set (aantal seconden) om je rang te krijgen."
                : ladder?.scoring === "load"
                  ? "Log een set met gewicht om je rang te krijgen."
                  : ladder?.scoring === "assisted"
                    ? "Log een set (gewicht = ondersteuning) om je rang te krijgen."
                    : `Log een set (maximaal ${ladder?.maxReps ?? 12} reps) om je rang te krijgen.`}
      </p>
      {ladder && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Nodig bij {bodyweight} kg{age != null ? `, ${age} jaar` : ""} {ladderMeasure(ladder, equipment)}
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
                  {ladder.unit === "kg" ? " kg" : ladder.unit === "seconds" ? " s" : ""}
                </span>
              </div>
            ))}
          </div>
          {ladder.scoring === "assisted" && ladder.steps.some((s) => s.at > assistedCeiling(bodyweight)) && (
            <p className="mt-2 text-[11px] text-muted">
              Op de machine tellen hooguit 12 reps zonder ondersteuning. Hogere tiers haal je met gewone of weighted pull-ups.
            </p>
          )}
          <EstimateNote slug={slug} />
        </div>
      )}
    </section>
  );
}
