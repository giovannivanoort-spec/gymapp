"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useUserId } from "@/components/AuthProvider";
import { Celebration, type CelebrationData } from "@/components/Celebration";
import { MuscleChips } from "@/components/MuscleChips";
import { ageFrom, formatDate, timeAgo } from "@/lib/dates";
import { DEFAULT_VIDEOS } from "@/lib/exercise-videos";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { rankExercise, type LogLike } from "@/lib/ranks";
import { errorMessage, supabase } from "@/lib/supabase";
import { fetchLogsBySlug } from "@/lib/useRanks";
import { suggestNext } from "@/lib/progression";
import { postActivity } from "@/lib/activities";
import { enqueue, isNetworkError, SYNCED_EVENT } from "@/lib/offlineQueue";
import { PlateCalculator } from "@/components/PlateCalculator";
import type { Comment, GroupMember, SetLog, Workout, WorkoutExercise } from "@/lib/types";
import { ArrowUpIcon, ChatIcon, CheckIcon, ChevronRightIcon, CloseIcon, DumbbellIcon, PlayIcon, SparkleIcon } from "@/components/Icons";

type FullWorkout = Workout & { groups: { name: string } | null; workout_exercises: WorkoutExercise[] };
type CommentWithAuthor = Comment & { profiles: { display_name: string } | null };
type PrevLog = SetLog & { workout_exercises: { exercise_slug: string; workout_id: string; workouts: { date: string } } };

export default function WorkoutPage() {
  const { id } = useParams<{ id: string }>();
  const userId = useUserId();
  const [workout, setWorkout] = useState<FullWorkout | null | undefined>(undefined);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [logs, setLogs] = useState<SetLog[]>([]);
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [prev, setPrev] = useState<Record<string, PrevLog[]>>({});
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const forUser = selectedUser ?? userId;
  // Ophogen = opnieuw laden (na eigen wijziging of een live update van een vriend).
  const [logsVersion, setLogsVersion] = useState(0);
  const [commentsVersion, setCommentsVersion] = useState(0);
  const reloadLogs = useCallback(() => setLogsVersion((v) => v + 1), []);
  const reloadComments = useCallback(() => setCommentsVersion((v) => v + 1), []);

  const exercises = useMemo(
    () => [...(workout?.workout_exercises ?? [])].sort((a, b) => a.position - b.position),
    [workout],
  );
  const wexIds = useMemo(() => exercises.map((e) => e.id), [exercises]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("workouts")
        .select("*, groups(name), workout_exercises(*)")
        .eq("id", id)
        .single();
      setWorkout(data as FullWorkout | null);
      if (!data) return;
      const { data: m } = await supabase
        .from("group_members")
        .select("*, profiles(*)")
        .eq("group_id", data.group_id)
        .order("joined_at");
      setMembers((m as GroupMember[]) ?? []);
    })();
  }, [id]);

  useEffect(() => {
    supabase
      .from("comments")
      .select("*, profiles(display_name)")
      .eq("workout_id", id)
      .order("created_at")
      .then(({ data }) => setComments((data as CommentWithAuthor[]) ?? []));
  }, [id, commentsVersion]);

  useEffect(() => {
    if (wexIds.length === 0) return;
    supabase
      .from("set_logs")
      .select("*")
      .in("workout_exercise_id", wexIds)
      .then(({ data }) => setLogs(data ?? []));
  }, [wexIds, logsVersion]);

  // Vorige prestaties van de geselecteerde persoon voor dezelfde oefeningen.
  useEffect(() => {
    if (!workout || !forUser || exercises.length === 0) return;
    const slugs = [...new Set(exercises.map((e) => e.exercise_slug))];
    supabase
      .from("set_logs")
      .select("*, workout_exercises!inner(exercise_slug, workout_id, workouts!inner(date))")
      .eq("user_id", forUser)
      .in("workout_exercises.exercise_slug", slugs)
      .neq("workout_exercises.workout_id", workout.id)
      .lte("workout_exercises.workouts.date", workout.date)
      .order("created_at", { ascending: false })
      .limit(300)
      .then(({ data }) => {
        const bySlug: Record<string, PrevLog[]> = {};
        for (const log of (data as PrevLog[]) ?? []) {
          const slug = log.workout_exercises.exercise_slug;
          const list = (bySlug[slug] ??= []);
          // Alleen de meest recente sessie per oefening bewaren.
          if (list.length && list[0].workout_exercise_id !== log.workout_exercise_id) continue;
          list.push(log);
        }
        for (const list of Object.values(bySlug)) list.sort((a, b) => a.set_number - b.set_number);
        setPrev(bySlug);
      });
  }, [workout, forUser, exercises]);

  // Alle eerdere sets per oefening (voor promotie- en recordmeldingen).
  const [allLogs, setAllLogs] = useState<Map<string, LogLike[]> | null>(null);
  const [celebration, setCelebration] = useState<CelebrationData | null>(null);
  const slugKey = [...new Set(exercises.map((e) => e.exercise_slug))].join();
  useEffect(() => {
    if (!forUser || !slugKey) return;
    fetchLogsBySlug(forUser, slugKey.split(",")).then(setAllLogs);
  }, [forUser, slugKey]);

  const onLogged = useCallback(
    (slug: string, weight: number | null, reps: number | null) => {
      if (!allLogs) return;
      const member = members.find((m) => m.user_id === forUser);
      const bw = member?.profiles?.bodyweight_kg ?? null;
      const sex = member?.profiles?.sex ?? null;
      const age = ageFrom(member?.profiles?.birth_date);
      const before = allLogs.get(slug) ?? [];
      const after = [...before, { weight, reps }];
      setAllLogs(new Map(allLogs).set(slug, after));

      const r0 = rankExercise(slug, before, bw, sex, age);
      const r1 = rankExercise(slug, after, bw, sex, age);
      if (!r1) return;
      const exercise = EXERCISE_BY_SLUG[slug]?.name ?? slug;
      const who = forUser !== userId ? member?.profiles?.display_name : undefined;
      const detail =
        r1.unit === "reps"
          ? `${r1.value} reps`
          : r1.viaAdded
            ? `+${r1.value.toLocaleString("nl-NL")} kg extra (1RM)`
            : `1RM ≈ ${r1.value.toLocaleString("nl-NL")} kg`;
      const base = { groupId: workout!.group_id, userId: forUser, workoutId: workout!.id };
      if (!r0 || r1.tierIndex > r0.tierIndex) {
        setCelebration({ kind: "promotion", tierIndex: r1.tierIndex, exercise, who });
        // De allereerste rang telt alleen als promotie vanaf Zilver (anders is elke eerste set een melding).
        if (r0 || r1.tierIndex >= 1) postActivity({ ...base, type: "promotion", payload: { slug, tierIndex: r1.tierIndex } });
      } else if (r1.value > r0.value) {
        setCelebration({ kind: "record", exercise, detail, who });
        postActivity({ ...base, type: "pr", payload: { slug, detail } });
      }
    },
    [allLogs, members, forUser, userId, workout],
  );
  const closeCelebration = useCallback(() => setCelebration(null), []);

  // Na het versturen van offline ingevulde sets opnieuw laden.
  useEffect(() => {
    window.addEventListener(SYNCED_EVENT, reloadLogs);
    return () => window.removeEventListener(SYNCED_EVENT, reloadLogs);
  }, [reloadLogs]);

  // Live updates van vrienden.
  useEffect(() => {
    const channel = supabase
      .channel(`workout-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "set_logs" }, reloadLogs)
      .on("postgres_changes", { event: "*", schema: "public", table: "comments", filter: `workout_id=eq.${id}` }, reloadComments)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, reloadLogs, reloadComments]);

  const isTrainer = members.some((m) => m.user_id === userId && m.role === "trainer");
  const nameOf = (uid: string) => members.find((m) => m.user_id === uid)?.profiles?.display_name ?? "Onbekend";

  if (workout === undefined) {
    return (
      <AppShell title="Training" back>
        <div className="space-y-3"><div className="skeleton h-24" /><div className="skeleton h-40" /></div>
      </AppShell>
    );
  }
  if (workout === null) {
    return (
      <AppShell title="Training" back="/">
        <div className="card text-sm text-muted">Training niet gevonden.</div>
      </AppShell>
    );
  }

  const totalTarget = exercises.reduce((s, e) => s + e.target_sets, 0);
  const doneByUser = (uid: string) => logs.filter((l) => l.user_id === uid && (l.reps ?? 0) > 0).length;

  return (
    <AppShell
      title={workout.title}
      back={`/groups/${workout.group_id}`}
      action={
        isTrainer && (
          <Link href={`/groups/${workout.group_id}/plan?edit=${workout.id}`} className="btn-ghost px-3 py-1.5 text-xs">
            Aanpassen
          </Link>
        )
      }
    >
      <div className="space-y-5">
        <div className="space-y-1">
          <p className="text-sm text-muted">
            {formatDate(workout.date)} · {workout.groups?.name}
          </p>
          {workout.notes && <p className="whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-sm">{workout.notes}</p>}
        </div>

        <Link
          href={`/coach?q=${encodeURIComponent(`Kijk de training "${workout.title}" van ${workout.date} na (workout ${workout.id}). Hoe ging het en wat moet ik volgende keer anders doen?`)}`}
          className="btn-ghost w-full"
        >
          <SparkleIcon className="text-accent" /> Laat de coach deze training nakijken
        </Link>

        {/* Voortgang per persoon */}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {members.map((m) => {
            const done = doneByUser(m.user_id);
            const selectable = isTrainer || m.user_id === userId;
            const active = m.user_id === forUser;
            return (
              <button
                key={m.user_id}
                disabled={!selectable}
                onClick={() => setSelectedUser(m.user_id)}
                className={`shrink-0 rounded-xl border px-3 py-2 text-left ${active ? "border-accent bg-accent/10" : "border-line"} ${selectable ? "" : "cursor-default"}`}
              >
                <p className={`text-sm font-semibold ${active ? "text-accent" : ""}`}>
                  {m.user_id === userId ? "Jij" : m.profiles?.display_name}
                </p>
                <p className="text-xs text-muted">
                  {done}/{totalTarget} sets
                </p>
              </button>
            );
          })}
        </div>
        {isTrainer && forUser !== userId && (
          <p className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            Je vult nu sets in voor <strong>{nameOf(forUser)}</strong>.
          </p>
        )}

        <ol className="space-y-4">
          {exercises.map((we, i) => (
            <ExerciseCard
              key={we.id}
              index={i}
              we={we}
              forUser={forUser}
              logs={logs.filter((l) => l.workout_exercise_id === we.id)}
              prev={prev[we.exercise_slug] ?? []}
              comments={comments.filter((c) => c.workout_exercise_id === we.id)}
              nameOf={nameOf}
              userId={userId}
              isTrainer={isTrainer}
              onChange={reloadLogs}
              onComment={reloadComments}
              onLogged={(w, r) => onLogged(we.exercise_slug, w, r)}
            />
          ))}
        </ol>

        <section className="card space-y-3">
          <h2 className="font-bold">Opmerkingen bij de training</h2>
          <CommentThread
            workoutId={workout.id}
            workoutExerciseId={null}
            comments={comments.filter((c) => c.workout_exercise_id === null)}
            userId={userId}
            isTrainer={isTrainer}
            onChange={reloadComments}
          />
        </section>
      </div>
      <Celebration data={celebration} onClose={closeCelebration} />
    </AppShell>
  );
}

function ExerciseCard({
  index,
  we,
  forUser,
  logs,
  prev,
  comments,
  nameOf,
  userId,
  isTrainer,
  onChange,
  onComment,
  onLogged,
}: {
  index: number;
  we: WorkoutExercise;
  forUser: string;
  logs: SetLog[];
  prev: PrevLog[];
  comments: CommentWithAuthor[];
  nameOf: (uid: string) => string;
  userId: string;
  isTrainer: boolean;
  onChange: () => void;
  onComment: () => void;
  onLogged: (weight: number | null, reps: number | null) => void;
}) {
  const ex = EXERCISE_BY_SLUG[we.exercise_slug];
  const mine = logs.filter((l) => l.user_id === forUser);
  const [extraByUser, setExtraByUser] = useState<Record<string, number>>({});
  const extra = extraByUser[forUser] ?? 0;
  const [showComments, setShowComments] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const perHand = ex?.equipment === "dumbbell" || ex?.equipment === "kettlebell";
  const video = DEFAULT_VIDEOS[we.exercise_slug];
  const maxLogged = mine.reduce((m, l) => Math.max(m, l.set_number), 0);
  const rows = Math.max(we.target_sets, maxLogged) + extra;
  const others = [...new Set(logs.filter((l) => l.user_id !== forUser).map((l) => l.user_id))];
  const suggestion = ex ? suggestNext(prev, we.target_reps, we.target_sets, ex.equipment) : null;
  const usesPlates = ex?.equipment === "barbell" || ex?.equipment === "ez_bar";
  const [plateOpen, setPlateOpen] = useState(false);
  const lastWeight = [...mine].reverse().find((l) => l.weight)?.weight ?? suggestion?.perSet[0]?.weight ?? null;

  return (
    <li className="card space-y-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-muted">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-lg font-bold leading-tight">{ex?.name ?? we.exercise_slug}</p>
            <div className="flex shrink-0 gap-3 text-xs font-medium">
              {usesPlates && (
                <button className="inline-flex items-center gap-1 text-accent" onClick={() => setPlateOpen(true)}>
                  <DumbbellIcon size={13} /> Schijven
                </button>
              )}
              {video && (
                <button className="inline-flex items-center gap-1 text-accent" onClick={() => setShowVideo((v) => !v)}>
                  {showVideo ? <CloseIcon size={12} /> : <PlayIcon size={12} />} Video
                </button>
              )}
              {ex && (
                <Link href={`/exercises/${ex.slug}`} className="inline-flex items-center text-accent">
                  Uitleg <ChevronRightIcon size={14} />
                </Link>
              )}
            </div>
          </div>
          <p className="text-sm text-muted">
            {we.target_sets} × {we.target_reps} reps
          </p>
          {ex && <MuscleChips primary={ex.primary} secondary={ex.secondary} limit={5} />}
          {we.notes && <p className="text-sm italic text-muted">“{we.notes}”</p>}
        </div>
      </div>

      {showVideo && video && (
        <div className="aspect-video overflow-hidden rounded-xl bg-black">
          <iframe
            className="h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${video.id}`}
            title={`${ex?.name ?? we.exercise_slug} uitleg`}
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {prev.length > 0 && (
        <div className="space-y-2 rounded-xl bg-surface-2 px-3 py-2.5">
          <p className="text-xs text-muted">
            Vorige keer ({formatDate(prev[0].workout_exercises.workouts.date, { weekday: undefined, month: "short" })}):{" "}
            <span className="text-ink">{prev.map(fmtSet).join(" · ")}</span>
          </p>
          {suggestion && (
            <div className="flex items-start gap-2 border-t border-line pt-2">
              <ArrowUpIcon size={14} className="mt-0.5 shrink-0 text-accent" />
              <p className="text-xs">
                <span className="font-semibold text-accent">Advies vandaag: {suggestion.headline}</span>
                <span className="block text-muted">{suggestion.reason}</span>
              </p>
            </div>
          )}
        </div>
      )}
      {usesPlates && plateOpen && <PlateCalculator open onClose={() => setPlateOpen(false)} initial={lastWeight} />}

      <div className="space-y-2">
        <div className="grid grid-cols-[2rem_1fr_1fr_2.5rem] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted">
          <span>Set</span>
          <span title={perHand ? "Gewicht per dumbbell" : undefined}>{perHand ? "Kg p/db" : "Kg"}</span>
          <span>Reps</span>
          <span />
        </div>
        {Array.from({ length: rows }, (_, i) => i + 1).map((n) => (
          <SetRow
            key={`${forUser}-${n}`}
            workoutExerciseId={we.id}
            userId={forUser}
            setNumber={n}
            log={mine.find((l) => l.set_number === n)}
            hint={suggestion?.perSet[n - 1] ?? prev.find((p) => p.set_number === n) ?? prev[prev.length - 1]}
            onChange={onChange}
            onLogged={onLogged}
          />
        ))}
        <button className="w-full rounded-xl border border-dashed border-line py-2 text-sm text-muted hover:text-ink" onClick={() => setExtraByUser((e) => ({ ...e, [forUser]: extra + 1 }))}>
          + Set
        </button>
      </div>

      {others.length > 0 && (
        <div className="space-y-1 border-t border-line pt-3">
          {others.map((uid) => (
            <p key={uid} className="text-sm">
              <span className="font-medium">{uid === userId ? "Jij" : nameOf(uid)}:</span>{" "}
              <span className="text-muted">
                {logs
                  .filter((l) => l.user_id === uid)
                  .sort((a, b) => a.set_number - b.set_number)
                  .map(fmtSet)
                  .join(" · ")}
              </span>
            </p>
          ))}
        </div>
      )}

      <div className="border-t border-line pt-3">
        <button className="text-sm text-muted hover:text-ink" onClick={() => setShowComments((v) => !v)}>
          <ChatIcon size={15} className="mr-1.5 inline -translate-y-px" />
          {comments.length > 0 ? `${comments.length} opmerking${comments.length === 1 ? "" : "en"}` : "Opmerking plaatsen"}
        </button>
        {showComments && (
          <div className="mt-3">
            <CommentThread
              workoutId={we.workout_id}
              workoutExerciseId={we.id}
              comments={comments}
              userId={userId}
              isTrainer={isTrainer}
              onChange={onComment}
            />
          </div>
        )}
      </div>
    </li>
  );
}

function SetRow({
  workoutExerciseId,
  userId,
  setNumber,
  log,
  hint,
  onChange,
  onLogged,
}: {
  workoutExerciseId: string;
  userId: string;
  setNumber: number;
  log?: SetLog;
  /** Voorinvulling: advies voor deze set, of wat je vorige keer deed. */
  hint?: { weight: number | null; reps: number | null };
  onChange: () => void;
  onLogged: (weight: number | null, reps: number | null) => void;
}) {
  const [weight, setWeight] = useState(log?.weight?.toString() ?? "");
  const [reps, setReps] = useState(log?.reps?.toString() ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "queued" | "error">("idle");
  // Offline ingevuld en in de wachtrij gezet (nog niet in de database).
  const [queued, setQueued] = useState<{ weight: number | null; reps: number | null } | null>(null);

  // Bijwerken wanneer de opgeslagen waarde verandert (bijv. de trainer past deze set aan).
  // Per veld, zodat een veld waarin je nog typt niet wordt overschreven.
  const [seen, setSeen] = useState({ weight: log?.weight ?? null, reps: log?.reps ?? null });
  if ((log?.weight ?? null) !== seen.weight || (log?.reps ?? null) !== seen.reps) {
    if ((log?.weight ?? null) !== seen.weight) setWeight(log?.weight?.toString() ?? "");
    if ((log?.reps ?? null) !== seen.reps) setReps(log?.reps?.toString() ?? "");
    setSeen({ weight: log?.weight ?? null, reps: log?.reps ?? null });
  }

  const key = { workout_exercise_id: workoutExerciseId, user_id: userId, set_number: setNumber };
  const done = (log && (log.reps ?? 0) > 0) || (queued && (queued.reps ?? 0) > 0);

  async function save(w = weight, r = reps) {
    const wNum = w.trim() === "" ? null : Number(w.replace(",", "."));
    const rNum = r.trim() === "" ? null : Math.round(Number(r));
    const current = queued ?? log;
    if (wNum === (current?.weight ?? null) && rNum === (current?.reps ?? null)) return;
    if (wNum === null && rNum === null) {
      if (current) await remove();
      return;
    }
    if ((wNum !== null && Number.isNaN(wNum)) || (rNum !== null && Number.isNaN(rNum))) return setStatus("error");
    setStatus("saving");
    const row = { ...key, weight: wNum, reps: rNum };
    const { error } = await supabase.from("set_logs").upsert(row, { onConflict: "workout_exercise_id,user_id,set_number" });
    if (error && isNetworkError(error)) {
      // Geen verbinding: bewaren en later versturen.
      enqueue({ kind: "upsert", row });
      setQueued({ weight: wNum, reps: rNum });
      setStatus("queued");
      navigator.vibrate?.(12);
      onLogged(wNum, rNum);
      return;
    }
    if (error) {
      setStatus("error");
      alert(errorMessage(error));
      return;
    }
    setQueued(null);
    setStatus("saved");
    navigator.vibrate?.(12);
    onLogged(wNum, rNum);
    setTimeout(() => setStatus("idle"), 1200);
    onChange();
  }

  async function remove() {
    if (!log && !queued) return;
    setQueued(null);
    setStatus("idle");
    const { error } = log
      ? await supabase.from("set_logs").delete().eq("id", log.id)
      : { error: { message: "Failed to fetch" } };
    if (error && isNetworkError(error)) enqueue({ kind: "delete", key });
    onChange();
  }

  /** Snel afvinken: gebruikt het vorige gewicht/reps als je niets hebt ingevuld. */
  function quickComplete() {
    const w = weight || hint?.weight?.toString() || "";
    const r = reps || hint?.reps?.toString() || "";
    setWeight(w);
    setReps(r);
    save(w, r);
  }

  return (
    <div className={`grid grid-cols-[2rem_1fr_1fr_2.5rem] items-center gap-2 rounded-xl ${done ? "bg-accent/5" : ""}`}>
      <span className={`text-center text-sm font-bold ${done ? "text-accent" : "text-muted"}`}>{setNumber}</span>
      <input
        className="input py-2 text-center tabular-nums"
        inputMode="decimal"
        value={weight}
        placeholder={hint?.weight?.toString() ?? "–"}
        onChange={(e) => setWeight(e.target.value)}
        onBlur={() => save()}
        aria-label={`Gewicht set ${setNumber}`}
      />
      <input
        className="input py-2 text-center tabular-nums"
        inputMode="numeric"
        value={reps}
        placeholder={hint?.reps?.toString() ?? "–"}
        onChange={(e) => setReps(e.target.value)}
        onBlur={() => save()}
        aria-label={`Reps set ${setNumber}`}
      />
      <button
        onClick={done ? remove : quickComplete}
        aria-label={done ? "Set wissen" : "Set afronden"}
        title={queued ? "Offline bewaard, wordt verstuurd zodra er verbinding is" : undefined}
        className={`flex h-10 w-10 items-center justify-center rounded-xl border text-lg ${
          queued
            ? "border-dashed border-accent text-accent"
            : done
              ? "border-accent bg-accent text-accent-ink"
              : "border-line text-muted"
        } ${status === "error" ? "border-danger text-danger" : ""} ${status === "saved" || status === "queued" ? "animate-pop" : ""} transition-colors duration-200 active:scale-90`}
      >
        {status === "saving" ? "…" : <CheckIcon size={18} strokeWidth={2.6} />}
      </button>
    </div>
  );
}

function CommentThread({
  workoutId,
  workoutExerciseId,
  comments,
  userId,
  isTrainer,
  onChange,
}: {
  workoutId: string;
  workoutExerciseId: string | null;
  comments: CommentWithAuthor[];
  userId: string;
  isTrainer: boolean;
  onChange: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const { error } = await supabase
      .from("comments")
      .insert({ workout_id: workoutId, workout_exercise_id: workoutExerciseId, body: body.trim() });
    setBusy(false);
    if (error) return alert(errorMessage(error));
    setBody("");
    onChange();
  }

  async function remove(id: string) {
    await supabase.from("comments").delete().eq("id", id);
    onChange();
  }

  return (
    <div className="space-y-3">
      {comments.map((c) => (
        <div key={c.id} className="rounded-xl bg-surface-2 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">{c.user_id === userId ? "Jij" : c.profiles?.display_name}</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">{timeAgo(c.created_at)}</span>
              {(c.user_id === userId || isTrainer) && (
                <button className="text-muted hover:text-danger" onClick={() => remove(c.id)} aria-label="Verwijderen">
                  <CloseIcon size={13} />
                </button>
              )}
            </div>
          </div>
          <p className="whitespace-pre-wrap text-sm">{c.body}</p>
        </div>
      ))}
      <form onSubmit={post} className="flex gap-2">
        <input
          className="input flex-1"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={workoutExerciseId ? "Bijv. voelde zwaar, volgende keer +2,5 kg" : "Schrijf een opmerking…"}
          maxLength={2000}
        />
        <button className="btn-primary" disabled={busy || !body.trim()}>
          Plaats
        </button>
      </form>
    </div>
  );
}

function fmtSet(l: SetLog) {
  const w = l.weight != null ? `${Number(l.weight)}kg` : "";
  const r = l.reps != null ? `${l.reps}` : "–";
  return w ? `${w}×${r}` : `${r} reps`;
}
