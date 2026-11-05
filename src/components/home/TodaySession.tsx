"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { Avatar } from "@/components/Avatar";
import { CheckIcon, PlusIcon } from "@/components/Icons";
import type { HistorySet } from "@/lib/history";
import { isMissingSchemaError, supabase } from "@/lib/supabase";
import { exerciseCount, exercisesLabel, findRecords, kg, progressOf, type TodayLog, type TodayMember, type UpcomingWorkout } from "./data";
import { refreshLive, strict, useLive } from "./live";

type State = "empty" | "start" | "progress" | "done";

type LiveLog = TodayLog & { id: string };
type LiveDetail = { logs: LiveLog[]; members: (TodayMember & { avatar_url?: string | null })[]; exerciseIds: string[] };

/** Wacht na de eerste set van een reeks zo lang, zodat een golf aan sets één verversing geeft. */
const REFRESH_DELAY = 1_500;

/** Sets van deze training (iedereen in de groep), de leden en de oefening-ids (voor het live filter). */
async function fetchTodayLive(workoutId: string, groupId: string): Promise<LiveDetail> {
  const membersQuery = (withPhoto: boolean) =>
    supabase
      .from("group_members")
      .select(withPhoto ? "user_id, role, profiles(display_name, avatar_url)" : "user_id, role, profiles(display_name)")
      .eq("group_id", groupId);
  const [logs, firstMembers, exercises] = await Promise.all([
    supabase
      .from("set_logs")
      .select("id, user_id, workout_exercise_id, reps, weight, workout_exercises!inner(workout_id)")
      .eq("workout_exercises.workout_id", workoutId)
      .gt("reps", 0),
    membersQuery(true),
    supabase.from("workout_exercises").select("id").eq("workout_id", workoutId),
  ]);
  // Profielfoto's nog niet ingeschakeld (upgrade-avatars.sql): zonder foto.
  const members =
    firstMembers.error && isMissingSchemaError(firstMembers.error) ? await membersQuery(false) : firstMembers;
  if (logs.error) throw logs.error;
  if (members.error) throw members.error;
  if (exercises.error) throw exercises.error;
  return {
    logs: (logs.data ?? []).map((l) => ({
      id: String(l.id),
      user_id: l.user_id as string,
      workout_exercise_id: l.workout_exercise_id as string,
      reps: l.reps as number | null,
      weight: l.weight != null ? Number(l.weight) : null,
    })),
    members: (members.data ?? []).map((m) => {
      const p = m.profiles as unknown as { display_name: string; avatar_url?: string | null } | null;
      return {
        user_id: m.user_id as string,
        role: m.role as TodayMember["role"],
        name: p?.display_name ?? "Onbekend",
        avatar_url: p?.avatar_url ?? null,
      };
    }),
    exerciseIds: (exercises.data ?? []).map((e) => String(e.id)),
  };
}

/**
 * Grote kaart voor de training van vandaag: start, ga verder (met voortgang) of afgerond (met
 * samenvatting). Laat ook zien wie van de groep al bezig is, live bijgewerkt: alleen sets van
 * deze training tellen, en een golf aan sets geeft één verversing. Een trainer tikt op een
 * groepslid om direct sets voor die persoon in te vullen.
 */
export function TodaySession({
  w,
  index,
  userId,
  isTrainer,
  history,
}: {
  w: UpcomingWorkout;
  index: number;
  userId: string;
  isTrainer: boolean;
  history: HistorySet[] | undefined;
}) {
  const key = `home:today-live:${w.id}`;
  const detail = useLive(key, strict(key, () => fetchTodayLive(w.id, w.group_id)), { persist: true, maxAge: 20_000 });

  const exerciseIds = detail?.exerciseIds.join(",") ?? "";
  // Bekende set-ids, voor verwijderingen (die kan de server niet filteren). Via een ref, zodat het
  // kanaal niet bij elke verversing opnieuw hoeft te verbinden.
  const logIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    logIds.current = new Set(detail?.logs.map((l) => l.id) ?? []);
  }, [detail]);

  // Live: alleen sets van de oefeningen van deze training (filter op de server), en verwijderde sets
  // die we kennen. Gebundeld: binnen REFRESH_DELAY na de eerste wijziging volgt één verversing.
  useEffect(() => {
    if (!exerciseIds) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        refreshLive(key);
      }, REFRESH_DELAY);
    };
    const filter = `workout_exercise_id=in.(${exerciseIds})`;
    const channel = supabase
      .channel(`home-today-${w.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "set_logs", filter }, schedule)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "set_logs", filter }, schedule)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "set_logs" }, (payload) => {
        const id = (payload.old as { id?: unknown } | null)?.id;
        if (id != null && logIds.current.has(String(id))) schedule();
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [w.id, key, exerciseIds]);

  const count = exerciseCount(w);
  const mine = useMemo(() => {
    if (detail) return progressOf(detail.logs, userId);
    // Nog geen detail: val terug op de eigen geschiedenis.
    const sets = (history ?? []).filter((s) => s.workoutId === w.id && (s.reps ?? 0) > 0);
    return {
      exercises: new Set(sets.map((s) => s.workoutExerciseId)).size,
      sets: sets.length,
      volume: sets.reduce((v, s) => v + (s.weight ?? 0) * (s.reps ?? 0), 0),
    };
  }, [detail, history, userId, w.id]);
  const records = useMemo(() => (history ? findRecords(history, (s) => s.workoutId === w.id).length : 0), [history, w.id]);

  const state: State = count === 0 ? "empty" : mine.exercises === 0 ? "start" : mine.exercises >= count ? "done" : "progress";
  const pct = count ? Math.min(100, (mine.exercises / count) * 100) : 0;
  const others = (detail?.members ?? [])
    .filter((m) => m.user_id !== userId)
    .map((m) => {
      const p = progressOf(detail!.logs, m.user_id);
      return { ...m, done: p.exercises, sets: p.sets };
    })
    .sort((a, b) => b.done - a.done || a.name.localeCompare(b.name, "nl"));
  const busy = others.filter((m) => m.done > 0).length;
  // Voor trainers: wie nu aan de beurt is (nog niet klaar, minste sets gedaan).
  const next =
    isTrainer && count > 0
      ? others
          .filter((m) => m.done < count)
          .reduce<(typeof others)[number] | null>((best, m) => (!best || m.sets < best.sets ? m : best), null)
      : null;

  return (
    <article
      className={`animate-scale-in relative overflow-hidden rounded-2xl border p-5 ${
        state === "done" ? "border-line bg-surface" : "border-accent/40 bg-gradient-to-br from-accent/20 via-accent/5 to-transparent"
      }`}
      style={{ "--i": index } as React.CSSProperties}
    >
      {state !== "done" && <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/25 blur-3xl" />}
      <div className="relative space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent">
          {state === "done" ? (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-ink">
              <CheckIcon size={11} strokeWidth={3} />
            </span>
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
          )}
          <span className="min-w-0 truncate">
            {state === "done" ? "Afgerond" : "Vandaag"}
            {w.groups?.name ? ` · ${w.groups.name}` : ""}
          </span>
        </div>

        <div>
          <Link href={`/workouts/${w.id}`} className="block text-2xl font-extrabold leading-tight hover:underline">
            {w.title}
          </Link>
          <p className="mt-1 text-sm text-muted">
            {state === "progress" || state === "done"
              ? `${mine.exercises} van ${count} ${count === 1 ? "oefening" : "oefeningen"} gedaan`
              : exercisesLabel(count)}
          </p>
        </div>

        {state === "progress" && (
          <div
            className="h-1.5 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-label="Voortgang van je training"
            aria-valuemin={0}
            aria-valuemax={count}
            aria-valuenow={mine.exercises}
          >
            <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%`, transition: "width 0.8s cubic-bezier(0.2,0.8,0.2,1)" }} />
          </div>
        )}

        {state === "done" && (
          <dl className="grid grid-cols-3 divide-x divide-line rounded-xl bg-surface-2 py-2.5 text-center">
            <Stat label="Sets" value={String(mine.sets)} />
            <Stat label="Volume" value={mine.volume > 0 ? kg(mine.volume) : "–"} />
            <Stat label={records === 1 ? "Record" : "Records"} value={String(records)} accent={records > 0} />
          </dl>
        )}

        {others.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted">
              {isTrainer ? "Jouw groep" : "Groep"} ·{" "}
              <span className="text-ink">
                {busy === 0 ? "nog niemand bezig" : `${busy} van ${others.length} ${busy === 1 ? "is" : "zijn"} bezig`}
              </span>
              {isTrainer && count > 0 && <span className="text-muted"> · tik om in te vullen</span>}
            </p>
            <ul className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-0.5 [scrollbar-width:none]">
              {others.map((m) => {
                const done = count > 0 && m.done >= count;
                const first = m.name.split(" ")[0];
                const chip = (
                  <>
                    <Avatar
                      id={m.user_id}
                      name={m.name}
                      src={m.avatar_url}
                      size={26}
                      ring={done ? "var(--color-accent)" : m.done > 0 ? "color-mix(in srgb, var(--color-accent) 45%, transparent)" : undefined}
                      className={m.done === 0 ? "opacity-50" : ""}
                    />
                    <span className="text-xs font-semibold">{first}</span>
                    <span className={`text-[11px] tabular-nums ${done ? "text-accent" : "text-muted"}`}>
                      {done ? "klaar" : `${m.done}/${count}`}
                    </span>
                  </>
                );
                const cls = "flex min-h-[34px] shrink-0 items-center gap-2 rounded-full bg-surface-2/80 py-1 pl-1 pr-3";
                return (
                  <li key={m.user_id} className="shrink-0">
                    {isTrainer && count > 0 ? (
                      <Link
                        href={`/workouts/${w.id}?voor=${encodeURIComponent(m.user_id)}`}
                        aria-label={`Sets invullen voor ${m.name}: ${done ? "klaar" : `${m.done} van ${count} oefeningen`}`}
                        className={`${cls} relative border border-transparent transition hover:border-muted active:scale-95 after:absolute after:-inset-y-[5px] after:inset-x-0 after:content-['']`}
                      >
                        {chip}
                      </Link>
                    ) : (
                      <span className={cls}>{chip}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {next && (
              <Link
                href={`/workouts/${w.id}?voor=${encodeURIComponent(next.user_id)}`}
                className="btn-ghost min-h-11 px-3 text-sm"
                aria-label={`Volgende: sets invullen voor ${next.name}`}
              >
                Volgende: {next.name.split(" ")[0]}
              </Link>
            )}
          </div>
        )}

        {state === "empty" ? (
          isTrainer ? (
            <Link href={`/groups/${w.group_id}/plan?edit=${w.id}`} className="btn-primary w-full">
              <PlusIcon size={16} /> Oefeningen toevoegen
            </Link>
          ) : (
            <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-muted">De trainer stelt deze training nog samen.</p>
          )
        ) : (
          <Link href={`/workouts/${w.id}`} className={`${state === "done" ? "btn-ghost" : "btn-primary"} w-full`}>
            {state === "start" ? "Start training" : state === "progress" ? "Ga verder" : "Bekijk training"}
          </Link>
        )}
      </div>
    </article>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="px-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`text-sm font-bold tabular-nums ${accent ? "text-accent" : ""}`}>{value}</dd>
    </div>
  );
}
