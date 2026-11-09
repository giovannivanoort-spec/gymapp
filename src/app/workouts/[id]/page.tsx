"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useUserId } from "@/components/AuthProvider";
import { Celebration, type CelebrationData } from "@/components/Celebration";
import { CalendarIcon, CheckIcon, ChevronRightIcon, UsersIcon } from "@/components/Icons";
import { CommentThread } from "@/components/workout/CommentThread";
import { commentsKey, fetchComments, fetchLogs, fetchWorkout, logsKey, useHistories, useLoad, workoutKey } from "@/components/workout/data";
import { ExerciseCard, type PersonView } from "@/components/workout/ExerciseCard";
import { syncFeedAfterChange } from "@/components/workout/feed";
import { FinishSheet } from "@/components/workout/FinishSheet";
import { GroupGrid } from "@/components/workout/GroupGrid";
import { JumpCheck, type JumpCheckItem } from "@/components/workout/JumpCheck";
import { writesFor } from "@/components/workout/localWrites";
import {
  beats,
  bestOf,
  detectAchievement,
  doneSets,
  firstOpenIn,
  fmtNum,
  fmtSet,
  isDone,
  keyOfLog,
  logsBySlug,
  memberProfile,
  mergeFailed,
  mergeQueue,
  normalizeLog,
  parseReps,
  parseWeight,
  plannedSets,
  prevSessions,
  setKey,
  upsertLocal,
  validateSet,
  type LogRow,
  type PrevSession,
} from "@/components/workout/logic";
import { setAnchorId, type FillSet } from "@/components/workout/PersonSets";
import { TurnsControl } from "@/components/workout/TurnsControl";
import { cardInView, useCardInView, useTurns } from "@/components/workout/useTurns";
import type { SaveResult } from "@/components/workout/SetRow";
import { toast } from "@/components/ui/Toast";
import { postActivity } from "@/lib/activities";
import { getCached, invalidate, setCached } from "@/lib/cache";
import { ageFrom, formatDate } from "@/lib/dates";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { invalidateHistory } from "@/lib/history";
import {
  dequeue,
  enqueue,
  enqueueActivity,
  flushQueue,
  markFailed,
  readActivities,
  readFailed,
  removeFailed,
  setOfOp,
  SYNCED_EVENT,
  useFailed,
  useQueue,
  withSetLock,
  writeTimeout,
} from "@/lib/offlineQueue";
import type { LogLike } from "@/lib/ranks";
import { errorMessage, isAuthError, isRetryableError, staleResponseCount, supabase } from "@/lib/supabase";
import type { GroupMember, SetLog, WorkoutExercise } from "@/lib/types";

const NO_MEMBERS: GroupMember[] = [];
const NO_COMMENTS: never[] = [];
const NO_LOGS: LogRow[] = [];
const ON_CONFLICT = "workout_exercise_id,user_id,set_number";
/** Record of promotie die nog niet kon worden bepaald (geschiedenis van die persoon nog niet geladen). */
type PendingAnnouncement = { we: WorkoutExercise; uid: string; n: number; value: LogLike };
type Check = JumpCheckItem & { key: string };

/** Onder de vaste kop van de app (iets overlappend, de kop ligt erboven). */
const STICKY_TOP = "top-[calc(max(0.75rem,env(safe-area-inset-top))+2.75rem)]";

export default function WorkoutPage() {
  return (
    <Suspense fallback={<WorkoutSkeleton />}>
      <Workout />
    </Suspense>
  );
}

function WorkoutSkeleton() {
  return (
    <AppShell title="Training" back>
      <div className="space-y-4" aria-busy="true" aria-label="Training laden">
        <div className="skeleton h-4 w-2/3" />
        <div className="flex gap-2">
          <div className="skeleton h-14 w-24" />
          <div className="skeleton h-14 w-24" />
          <div className="skeleton h-14 w-24" />
        </div>
        <div className="skeleton h-64" />
        <div className="skeleton h-48" />
      </div>
    </AppShell>
  );
}

function Workout() {
  const { id } = useParams<{ id: string }>();
  const userId = useUserId();
  const router = useRouter();
  const searchParams = useSearchParams();
  /**
   * Persoon uit de link: `?voor=<id>` (snelkoppeling voor trainers vanaf Home) of `?lid=<id>`
   * (vanuit het live overzicht van de groep). Een onbekend id wordt hieronder genegeerd.
   */
  const linkedPerson = searchParams.get("voor") ?? searchParams.get("lid");

  // ─── Laden (ook offline uit de cache) ───
  const wk = useLoad(workoutKey(id), () => fetchWorkout(id), { persist: true, maxAge: 5_000 });
  const bundle = wk.data;
  const workout = bundle?.workout;
  const members = bundle?.members ?? NO_MEMBERS;
  const cm = useLoad(commentsKey(id), () => fetchComments(id), { persist: true, maxAge: 5_000 });
  const comments = cm.data ?? NO_COMMENTS;

  // Sets: lokale staat (voor directe updates), bewaard in de cache zodat de pagina offline werkt.
  const [logsState, setLogsState] = useState(() => ({ id, logs: getCached<SetLog[]>(logsKey(id)) }));
  if (logsState.id !== id) setLogsState({ id, logs: getCached<SetLog[]>(logsKey(id)) });
  const serverLogs = logsState.id === id ? logsState.logs : undefined;
  const [logsError, setLogsError] = useState(false);
  const [logsVersion, setLogsVersion] = useState(0);
  const reloadLogs = useCallback(() => setLogsVersion((v) => v + 1), []);
  /** Sets die nu worden opgeslagen (sleutel → waarden), tegen dubbel opslaan en verouderde updates. */
  const pendingSaves = useRef(new Map<string, string>());

  const patchLogs = useCallback((fn: (logs: SetLog[]) => SetLog[]) => {
    setLogsState((s) => ({ ...s, logs: fn(s.logs ?? []) }));
  }, []);

  useEffect(() => {
    let stale = false;
    const hitsBefore = staleResponseCount();
    fetchLogs(id)
      .then((data) => {
        if (stale) return;
        // Offline kopie van de service worker: alleen gebruiken als er nog niets op dit toestel staat.
        const offlineCopy = staleResponseCount() !== hitsBefore;
        setLogsError(offlineCopy);
        if (offlineCopy && logsRef.current?.length) return;
        // Wat dit toestel zelf heeft opgeslagen of gewist, blijft staan tot de server het bevestigt
        // (een verouderd antwoord, of een herlaadactie die vóór een opslag begon en pas daarna terugkomt).
        const merged = writesFor(id).reconcile(data);
        setLogsState((s) => (s.id === id ? { id, logs: merged } : s));
      })
      .catch(() => {
        if (!stale) setLogsError(true);
      });
    return () => {
      stale = true;
    };
  }, [id, logsVersion]);

  useEffect(() => {
    if (serverLogs) setCached(logsKey(id), serverLogs, true);
  }, [id, serverLogs]);

  const exercises = useMemo(() => [...(workout?.workout_exercises ?? [])].sort((a, b) => a.position - b.position), [workout]);
  const wexKey = exercises.map((e) => e.id).join(",");
  const wexSet = useMemo(() => new Set(wexKey ? wexKey.split(",") : []), [wexKey]);
  const queue = useQueue();
  const failedOps = useFailed();
  // Offline ingevulde sets staan erbij (gemarkeerd als "wacht op verbinding"), en sets die
  // definitief niet konden worden opgeslagen als "niet opgeslagen".
  const logs = useMemo(() => {
    const base = serverLogs ?? (logsError ? NO_LOGS : undefined);
    return base ? mergeFailed(mergeQueue(base, queue, wexSet), failedOps, wexSet) : undefined;
  }, [serverLogs, logsError, queue, failedOps, wexSet]);
  const allLogs = logs ?? NO_LOGS;
  const logsMap = useMemo(() => new Map(allLogs.map((l) => [keyOfLog(l), l])), [allLogs]);
  const logsRef = useRef(logs);
  useEffect(() => {
    logsRef.current = logs;
  });

  // ─── Wie, en wat mag je ───
  const me = members.find((m) => m.user_id === userId);
  const isMember = !!me;
  const isTrainer = me?.role === "trainer";
  const [selectedUser, setSelectedUser] = useState<string | null>(linkedPerson);
  const [groupMode, setGroupMode] = useState(false);
  // Nieuwe link naar dezelfde training (bijv. een andere chip op Home): die persoon tonen.
  const [seenLink, setSeenLink] = useState(linkedPerson);
  if (linkedPerson && linkedPerson !== seenLink) {
    setSeenLink(linkedPerson);
    setSelectedUser(linkedPerson);
    setGroupMode(false);
  }
  // Parameter uit de adresbalk halen, zodat terugkomen of herladen niet opnieuw die persoon kiest.
  useEffect(() => {
    if (linkedPerson) router.replace(`/workouts/${id}`, { scroll: false });
  }, [linkedPerson, id, router]);
  const forUser =
    selectedUser && members.some((m) => m.user_id === selectedUser) ? selectedUser : isMember ? userId : (members[0]?.user_id ?? userId);
  const showGroup = groupMode && isTrainer && members.length > 1;
  const canEdit = (uid: string) => isMember && (uid === userId || isTrainer);
  const nameOf = useCallback((uid: string) => members.find((m) => m.user_id === uid)?.profiles?.display_name ?? "Onbekend", [members]);
  /** Een trainer kan wisselen tussen de leden van de groep. */
  const switcher = isTrainer && members.length > 1;
  /** Om de beurt: na het afvinken van een set automatisch door naar de volgende persoon. */
  const turns = useTurns({
    workoutId: id,
    available: switcher,
    showGroup,
    forUser,
    userId,
    members: members.map((m) => m.user_id),
    canEdit,
    logsRef,
    wexSet,
    nameOf,
    focusSet,
  });

  // Wisselen van persoon: dezelfde oefening blijft in beeld (handig als je om de beurt traint).
  const anchor = useRef<{ id: string; top: number } | null>(null);
  function rememberAnchor() {
    const el = cardInView();
    anchor.current = el ? { id: el.id, top: el.getBoundingClientRect().top } : null;
  }
  function switchPerson(uid: string | null) {
    // Zelf gekozen: een nog geplande wissel (om de beurt) vervalt.
    turns.cancel();
    rememberAnchor();
    if (uid) setSelectedUser(uid);
    setGroupMode(uid === null);
  }
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    document.querySelector('[data-person-chip][aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (!a) return;
    const el = document.getElementById(a.id);
    if (el) window.scrollBy(0, el.getBoundingClientRect().top - a.top);
  }, [forUser, showGroup]);

  // Oefening die nu in beeld is, voor de knop "Volgende" (wie heeft daar nog een open set).
  const viewCard = useCardInView(switcher && !showGroup, `${wexKey}|${forUser}`);

  // ─── Eerdere trainingen (vorige keer, advies, records) ───
  const slugs = useMemo(() => exercises.map((e) => e.exercise_slug), [exercises]);
  const memberIds = members.map((m) => m.user_id).join(",");
  const histUids = useMemo(() => (showGroup ? memberIds.split(",") : [forUser]), [showGroup, memberIds, forUser]);
  const histories = useHistories(id, workout ? histUids : [], slugs);
  const derived = useMemo(() => {
    const out: Record<string, { prev: Record<string, PrevSession>; before: Map<string, LogLike[]> }> = {};
    for (const [uid, rows] of Object.entries(histories)) {
      if (rows) out[uid] = { prev: prevSessions(rows, workout?.date ?? "9999-12-31"), before: logsBySlug(rows) };
    }
    return out;
  }, [histories, workout?.date]);

  // ─── Meldingen ───
  // Gewone meldingen (fouten, ongedaan maken) via het centrale meldingensysteem; controlevragen bij
  // een onwaarschijnlijke sprong in een eigen balk bovenin, zodat een andere melding ze nooit wegdrukt.
  const [celebration, setCelebration] = useState<CelebrationData | null>(null);
  const closeCelebration = useCallback(() => setCelebration(null), []);
  const showError = useCallback((message: string) => {
    toast.error(message);
  }, []);
  const [checks, setChecks] = useState<Check[]>([]);
  const checkSeq = useRef(0);
  const closeCheck = useCallback((cid: number) => setChecks((q) => q.filter((c) => c.id !== cid)), []);
  const [finishOpen, setFinishOpen] = useState(false);
  /** Records die wachten tot de geschiedenis van die persoon binnen is. */
  const pendingAnnouncements = useRef<PendingAnnouncement[]>([]);
  /** Records in de feed die opnieuw moeten worden nagekeken zodra offline bewerkingen zijn verstuurd. */
  const feedDirty = useRef(new Map<string, { slug: string; uid: string }>());

  /** Groepspagina (aanwezigheid) en ranglijst tonen meteen de nieuwe stand. */
  function afterChange(uid: string) {
    invalidateHistory(uid, workout ? { workoutDate: workout.date } : undefined);
    invalidate("leaderboard:");
    if (workout) invalidate(`group:${workout.group_id}`);
  }

  /** Alle eerdere sets van iemand voor deze oefening: andere trainingen plus de rest van vandaag. */
  function beforeFor(we: WorkoutExercise, uid: string, exclude: Set<string>): LogLike[] | null {
    const hist = derived[uid];
    if (!hist) return null;
    const sameSlug = new Set(exercises.filter((e) => e.exercise_slug === we.exercise_slug).map((e) => e.id));
    const today = allLogs
      .filter((l) => l.user_id === uid && sameSlug.has(l.workout_exercise_id) && isDone(l) && !exclude.has(keyOfLog(l)))
      .map((l) => ({ weight: l.weight, reps: l.reps }));
    return [...(hist.before.get(we.exercise_slug) ?? []), ...today];
  }

  /** Naar een set springen (bijv. om een typfout te verbeteren), zo nodig eerst naar die persoon. */
  function focusSet(we: WorkoutExercise, uid: string, n: number, { focus = true }: { focus?: boolean } = {}) {
    if (!showGroup && uid !== forUser) switchPerson(uid);
    window.setTimeout(() => {
      const el = document.getElementById(setAnchorId(we.id, uid, n)) ?? document.getElementById(`exercise-${we.id}`);
      if (!el) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      if (!focus) return;
      const input = el.querySelector<HTMLInputElement>("input[data-set-input]");
      input?.focus({ preventScroll: true });
      input?.select();
    }, 80);
  }

  /** Eerste set die nog open staat voor iemand bij deze oefening (voor het groepsoverzicht). */
  function firstOpenSet(we: WorkoutExercise, uid: string): number {
    return firstOpenIn(we, uid, allLogs);
  }

  /** Staat deze set nog precies zo (niet intussen aangepast of gewist)? */
  function stillIs(k: string, value: LogLike) {
    const cur = logsRef.current?.find((l) => keyOfLog(l) === k);
    return !!cur && isDone(cur) && cur.weight === value.weight && cur.reps === value.reps;
  }

  /**
   * Promotie of record vieren en in de groepsfeed zetten (na een controlevraag bij een
   * onwaarschijnlijke sprong). Offline behaald: de feed volgt zodra de set is verstuurd.
   * Is de geschiedenis van die persoon nog niet geladen (net gewisseld, of offline), dan wacht
   * de controle tot die binnen is.
   */
  function announce(we: WorkoutExercise, uid: string, n: number, value: LogLike, before: LogLike[] | null, queued = false) {
    if (!workout) return;
    const k = setKey(we.id, uid, n);
    if (!before) {
      pendingAnnouncements.current = [...pendingAnnouncements.current.filter((p) => setKey(p.we.id, p.uid, p.n) !== k), { we, uid, n, value }];
      return;
    }
    const member = members.find((m) => m.user_id === uid);
    const slug = we.exercise_slug;
    const a = detectAchievement(slug, before, value, memberProfile(member, ageFrom));
    if (!a) return;
    const exercise = EXERCISE_BY_SLUG[slug]?.name ?? slug;
    const who = uid !== userId ? member?.profiles?.display_name : undefined;
    const base = { groupId: workout.group_id, userId: uid, workoutId: workout.id };
    const set = { workout_exercise_id: we.id, user_id: uid, set_number: n };
    const post = (activity: Parameters<typeof postActivity>[0]) => {
      if (queued) enqueueActivity({ set, value: { weight: value.weight, reps: value.reps }, activity, by: userId });
      else postActivity(activity);
    };
    const fire = () => {
      if (a.kind === "promotion") {
        setCelebration({ kind: "promotion", tierIndex: a.tierIndex, exercise, who });
        if (a.post) post({ ...base, type: "promotion", payload: { slug, tierIndex: a.tierIndex } });
      } else {
        setCelebration({ kind: "record", exercise, detail: a.detail, who });
        post({ ...base, type: "pr", payload: { slug, detail: a.detail } });
      }
    };
    if (!a.suspicious) return fire();
    checkSeq.current += 1;
    const check: Check = {
      id: checkSeq.current,
      key: k,
      set: `${fmtSet(value, slug)} bij ${exercise}${who ? ` (${who})` : ""}`,
      // Alleen vieren als de set intussen niet is aangepast.
      onConfirm: () => {
        if (stillIs(k, value)) fire();
      },
      onFix: () => focusSet(we, uid, n),
    };
    // Een nieuwe vraag over dezelfde set vervangt de oude.
    setChecks((q) => [...q.filter((c) => c.key !== k), check].slice(-5));
  }

  /** Records die wachtten op de geschiedenis: alsnog bepalen, één melding per persoon en oefening. */
  const replayAnnouncements = useEffectEvent(() => {
    const ready = pendingAnnouncements.current.filter((p) => derived[p.uid]);
    if (!ready.length) return;
    pendingAnnouncements.current = pendingAnnouncements.current.filter((p) => !derived[p.uid]);
    const groups = new Map<string, PendingAnnouncement[]>();
    for (const p of ready) {
      const g = `${p.uid}|${p.we.exercise_slug}`;
      groups.set(g, [...(groups.get(g) ?? []), p]);
    }
    for (const items of groups.values()) {
      const still = items.filter((p) => stillIs(setKey(p.we.id, p.uid, p.n), p.value));
      if (!still.length) continue;
      const best = bestOf(still.map((p) => p.value), still[0].we.exercise_slug)?.set;
      const pick = still.find((p) => p.value === best) ?? still[0];
      const exclude = new Set(still.map((p) => setKey(p.we.id, p.uid, p.n)));
      const pk = setKey(pick.we.id, pick.uid, pick.n);
      const queued = !!logsRef.current?.find((l) => keyOfLog(l) === pk)?.pending;
      announce(pick.we, pick.uid, pick.n, pick.value, beforeFor(pick.we, pick.uid, exclude), queued);
    }
  });
  useEffect(() => {
    replayAnnouncements();
  }, [derived]);

  /** Record of promotie in de feed bijwerken of intrekken nadat een set is gewist of verlaagd. */
  const feedTimers = useRef(new Map<string, number>());
  function scheduleFeedSync(slug: string, uid: string) {
    if (!workout || !derived[uid]) return;
    const key = `${uid}|${slug}`;
    window.clearTimeout(feedTimers.current.get(key));
    const hist = derived[uid].before.get(slug) ?? [];
    const profile = memberProfile(
      members.find((m) => m.user_id === uid),
      ageFrom,
    );
    const ids = new Set(exercises.filter((e) => e.exercise_slug === slug).map((e) => e.id));
    const workoutId = workout.id;
    feedTimers.current.set(
      key,
      window.setTimeout(() => {
        feedTimers.current.delete(key);
        const today = (logsRef.current ?? []).filter((l) => l.user_id === uid && ids.has(l.workout_exercise_id) && isDone(l));
        const best = bestOf(today, slug)?.set;
        const a = best ? detectAchievement(slug, hist, best, profile) : null;
        // Een onbevestigde, onwaarschijnlijke sprong zet niets in de feed.
        if (a?.suspicious) return;
        syncFeedAfterChange({ workoutId, userId: uid, slug, prDetail: a?.detail ?? null, tierIndex: a?.kind === "promotion" ? a.tierIndex : null });
      }, 1500),
    );
  }

  /** Offline gewist of verlaagd: de feed pas bijwerken als de bewerking echt is verstuurd. */
  function markFeedDirty(slug: string, uid: string) {
    feedDirty.current.set(`${uid}|${slug}`, { slug, uid });
  }

  /** Netwerk- of sessieprobleem: in de wachtrij, en bij een verlopen sessie meteen verversen. */
  function queueOp(op: Parameters<typeof enqueue>[0], error: unknown) {
    enqueue({ ...op, by: userId });
    if (isAuthError(error)) {
      supabase.auth
        .refreshSession()
        .then(() => flushQueue())
        .catch(() => {});
    }
  }

  // ─── Opslaan en wissen ───
  // Alle schrijfacties voor één set lopen via withSetLock (gedeeld met het versturen van de
  // wachtrij) en hebben een time-out: een hangend verzoek op haperende wifi gaat zo in de wachtrij.
  async function saveSet(
    we: WorkoutExercise,
    uid: string,
    n: number,
    wStr: string,
    rStr: string,
    opts: { silent?: boolean; force?: boolean } = {},
  ): Promise<SaveResult> {
    if (!canEdit(uid)) return "skipped";
    const w = parseWeight(wStr);
    const r = parseReps(rStr);
    const k = setKey(we.id, uid, n);
    const existing = logsMap.get(k);
    const retry = !!existing?.failed;
    const sig = `${w}|${r}`;
    const inflight = pendingSaves.current.get(k);
    // Dubbele opslag (verlaten van het veld + afvinken) of niets veranderd: niets doen.
    if (inflight === sig && !retry) return "skipped";
    if (!opts.force && !retry && inflight === undefined && (existing?.weight ?? null) === w && (existing?.reps ?? null) === r) return "skipped";
    if (w === null && r === null) {
      if (existing) deleteSet(we, uid, n, existing);
      return "skipped";
    }
    const invalid = validateSet(w, r, we.exercise_slug);
    if (invalid) {
      showError(invalid);
      return "invalid";
    }

    const row = { workout_exercise_id: we.id, user_id: uid, set_number: n, weight: w, reps: r };
    const keyObj = { workout_exercise_id: we.id, user_id: uid, set_number: n };
    const before = opts.silent ? null : beforeFor(we, uid, new Set([k]));
    // Een afgeronde set verlaagd: het record in de feed kan dan niet meer kloppen.
    const lowered = isDone(existing) && !retry && !beats({ weight: w, reps: r }, bestOf([existing!], we.exercise_slug));
    const previous = existing && !existing.failed ? existing : null;
    pendingSaves.current.set(k, sig);
    writesFor(id).record(k, previous, { weight: w, reps: r });
    patchLogs((ls) => upsertLocal(ls, { ...row, id: existing?.id ?? `tmp:${k}`, created_at: existing?.created_at ?? new Date().toISOString() }));

    const res = await withSetLock(k, async () => {
      // Intussen al opnieuw aangepast: deze tussenversie hoeft niet meer verstuurd.
      if (pendingSaves.current.get(k) !== sig) return null;
      const out = await supabase.from("set_logs").upsert(row, { onConflict: ON_CONFLICT }).select().abortSignal(writeTimeout()).single();
      // Nog binnen het slot: een oudere wachtende versie van deze set mag hierna niet meer worden verstuurd.
      if (!out.error) dequeue(keyObj);
      return out;
    });
    if (!res) return "skipped";
    const { data, error, status } = res;
    const latest = pendingSaves.current.get(k) === sig;
    if (latest) pendingSaves.current.delete(k);

    if (error && isRetryableError({ ...error, status })) {
      // Geen verbinding, time-out of sessie verlopen: bewaren en later versturen. Alleen als dit nog
      // de nieuwste bewerking is: een latere opslag of wissen van deze set gaat voor (anders komt een
      // intussen gewiste set via de wachtrij terug).
      if (latest) queueOp({ kind: "upsert", row }, { ...error, status });
      if (retry) removeFailed(keyObj);
      if (lowered) markFeedDirty(we.exercise_slug, uid);
      navigator.vibrate?.(12);
      if (latest && !opts.silent) announce(we, uid, n, { weight: w, reps: r }, before, true);
      return "queued";
    }
    if (error) {
      if (latest) {
        writesFor(id).record(k, { weight: w, reps: r }, previous);
        if (previous && !previous.pending) {
          patchLogs((ls) => upsertLocal(ls, previous));
        } else {
          // Nieuwe of eerder mislukte set: zichtbaar houden als "niet opgeslagen", met opnieuw proberen.
          patchLogs((ls) => ls.filter((l) => keyOfLog(l) !== k));
          markFailed({ kind: "upsert", row, by: userId }, { ...error, status });
        }
      }
      showError(`Set ${n} niet opgeslagen: ${errorMessage(error)}`);
      return "error";
    }
    if (retry) removeFailed(keyObj);
    // Verbinding is er weer: offline behaalde records alvast in de feed zetten.
    if (readActivities().length) flushQueue();
    if (latest && data) patchLogs((ls) => upsertLocal(ls, normalizeLog(data)));
    navigator.vibrate?.(12);
    afterChange(uid);
    if (latest) {
      if (!opts.silent) announce(we, uid, n, { weight: w, reps: r }, before);
      if (lowered) scheduleFeedSync(we.exercise_slug, uid);
    }
    return "saved";
  }

  async function deleteSet(we: WorkoutExercise, uid: string, n: number, existing: LogRow, opts: { undo?: boolean } = { undo: true }) {
    if (!canEdit(uid)) return;
    // Weer een open set: na een correctie mag "Iedereen klaar" (om de beurt) opnieuw worden gemeld.
    turns.reopen(we.id);
    const k = setKey(we.id, uid, n);
    const key = { workout_exercise_id: we.id, user_id: uid, set_number: n };
    const previous = existing.failed ? null : existing;
    pendingSaves.current.set(k, "delete");
    writesFor(id).record(k, previous, null);
    patchLogs((ls) => ls.filter((l) => keyOfLog(l) !== k));
    dequeue(key);
    removeFailed(key);
    pendingAnnouncements.current = pendingAnnouncements.current.filter((p) => setKey(p.we.id, p.uid, p.n) !== k);
    if (opts.undo && !existing.failed) {
      toast(`Set ${n} gewist`, {
        action: {
          label: "Ongedaan maken",
          run: () =>
            actions.current.saveSet(we, uid, n, fmtNum(existing.weight), existing.reps?.toString() ?? "", { silent: true, force: true }),
        },
      });
    }
    // Alleen lokaal mislukt (nooit in de database gekomen): niets te wissen.
    if (existing.failed && existing.id.startsWith("failed:")) {
      pendingSaves.current.delete(k);
      return;
    }
    const res = await withSetLock(k, async () => {
      if (pendingSaves.current.get(k) !== "delete") return null;
      const out = await supabase
        .from("set_logs")
        .delete()
        .eq("workout_exercise_id", we.id)
        .eq("user_id", uid)
        .eq("set_number", n)
        .abortSignal(writeTimeout());
      // Nog binnen het slot: een wachtende oudere opslag van deze set mag na het wissen nooit meer worden verstuurd.
      if (!out.error) dequeue(key);
      return out;
    });
    if (!res) return;
    const { error, status } = res;
    if (pendingSaves.current.get(k) === "delete") pendingSaves.current.delete(k);
    if (error && isRetryableError({ ...error, status })) {
      queueOp({ kind: "delete", key }, { ...error, status });
      if (isDone(existing)) markFeedDirty(we.exercise_slug, uid);
      return;
    }
    if (error) {
      writesFor(id).record(k, null, previous);
      if (previous) patchLogs((ls) => (ls.some((l) => keyOfLog(l) === k) ? ls : upsertLocal(ls, previous)));
      showError(`Wissen mislukt: ${errorMessage(error)}`);
      return;
    }
    afterChange(uid);
    if (isDone(existing)) scheduleFeedSync(we.exercise_slug, uid);
  }

  /** Afvinken ongedaan maken: de set telt niet meer, de getallen blijven in de velden staan. */
  function uncompleteSet(we: WorkoutExercise, uid: string, n: number, log: LogRow) {
    // Net afgevinkt en meteen weer teruggezet: niet meer doorgaan naar de volgende persoon.
    turns.cancel();
    deleteSet(we, uid, n, log, { undo: false });
  }

  /** Open sets in één keer afronden met de voorinvulling (met ongedaan maken). */
  async function fillSets(we: WorkoutExercise, uid: string, sets: FillSet[]) {
    if (!sets.length || !canEdit(uid)) return;
    const keys = new Set(sets.map((s) => setKey(we.id, uid, s.n)));
    const before = beforeFor(we, uid, keys);
    // Wat er voor het afronden stond (bijv. alleen een gewicht), om ongedaan maken precies terug te zetten.
    const prior = new Map(sets.map((s) => [s.n, logsMap.get(setKey(we.id, uid, s.n))]));
    const results = await Promise.all(sets.map((s) => saveSet(we, uid, s.n, fmtNum(s.weight), String(s.reps), { silent: true })));
    const ok = sets.filter((_, i) => results[i] === "saved" || results[i] === "queued");
    if (!ok.length) return;
    // Eén melding voor de beste set, niet voor elke set apart (een eventuele controlevraag komt eerst).
    const best = bestOf(ok.map((s) => ({ weight: s.weight, reps: s.reps })), we.exercise_slug)?.set;
    const bestSet = best && ok.find((s) => s.weight === best.weight && s.reps === best.reps);
    if (bestSet) {
      const queued = results[sets.indexOf(bestSet)] === "queued";
      announce(we, uid, bestSet.n, { weight: bestSet.weight, reps: bestSet.reps }, before, queued);
    }
    toast(`${ok.length} ${ok.length === 1 ? "set" : "sets"} afgerond`, {
      action: {
        label: "Ongedaan maken",
        run: () => {
          const { saveSet: save, deleteSet: remove } = actions.current;
          for (const s of ok) {
            const was = prior.get(s.n);
            if (was && !was.failed && !isDone(was) && was.weight != null) {
              // Er stond al een gewicht (nog niet afgevinkt): dat gewicht terugzetten.
              save(we, uid, s.n, fmtNum(was.weight), "", { silent: true, force: true });
              continue;
            }
            const log: LogRow = {
              id: `tmp:${setKey(we.id, uid, s.n)}`,
              workout_exercise_id: we.id,
              user_id: uid,
              set_number: s.n,
              weight: s.weight,
              reps: s.reps,
              created_at: new Date().toISOString(),
            };
            remove(we, uid, s.n, log, { undo: false });
          }
        },
      },
    });
  }

  /** Altijd de nieuwste versie van opslaan/wissen (voor knoppen in meldingen die later worden ingedrukt). */
  const actions = useRef({ saveSet, deleteSet });
  useEffect(() => {
    actions.current = { saveSet, deleteSet };
  });

  // ─── Live updates, herverbinden en offline ───
  const onRemoteRow = useEffectEvent((row: Record<string, unknown>) => {
    if (!serverLogs) return;
    const log = normalizeLog(row);
    const k = keyOfLog(log);
    if (!wexSet.has(log.workout_exercise_id) || pendingSaves.current.has(k)) return;
    // Een late echo van een eigen, inmiddels achterhaalde opslag niet terugzetten.
    if (!writesFor(id).remote(k, log)) return;
    const prev = logsRef.current?.find((l) => keyOfLog(l) === k);
    const changed = !prev || prev.weight !== log.weight || prev.reps !== log.reps;
    patchLogs((ls) => upsertLocal(ls, log));
    if (changed && log.user_id === userId && isDone(log)) celebrateOwn(log);
  });

  /**
   * Je trainer heeft (op zijn telefoon) een set voor jou gelogd die een record of promotie is:
   * dan zie je de viering ook op je eigen telefoon. De feed regelt het toestel van de trainer.
   */
  function celebrateOwn(log: SetLog) {
    const we = exercises.find((e) => e.id === log.workout_exercise_id);
    const trainers = members.filter((m) => m.role === "trainer" && m.user_id !== userId);
    if (!we || !trainers.length) return;
    const before = beforeFor(we, userId, new Set([keyOfLog(log)]));
    if (!before) return;
    const a = detectAchievement(we.exercise_slug, before, log, memberProfile(me, ageFrom));
    // Een onwaarschijnlijke sprong vraagt de trainer om bevestiging; hier niet vieren.
    if (!a || a.suspicious) return;
    const exercise = EXERCISE_BY_SLUG[we.exercise_slug]?.name ?? we.exercise_slug;
    const by = trainers.length === 1 ? (trainers[0].profiles?.display_name ?? "je trainer") : "je trainer";
    setCelebration(
      a.kind === "promotion" ? { kind: "promotion", tierIndex: a.tierIndex, exercise, by } : { kind: "record", exercise, detail: a.detail, by },
    );
  }
  const onRemoteDelete = useEffectEvent((old: Record<string, unknown>) => {
    const oid = old?.id;
    if (!oid) return;
    const cur = logsRef.current?.find((l) => l.id === oid);
    if (!cur) return;
    const k = keyOfLog(cur);
    if (pendingSaves.current.has(k) || !writesFor(id).remote(k, null)) return;
    patchLogs((ls) => ls.filter((l) => l.id !== oid));
  });
  const refreshAll = useEffectEvent(() => {
    reloadLogs();
    cm.retry();
    if (wk.error || !bundle) wk.retry();
  });
  const refreshComments = useEffectEvent(() => cm.retry());
  /** Na versturen van de wachtrij: definitief mislukte sets niet meer als "gedaan" vasthouden, en verversen. */
  const onSynced = useEffectEvent(() => {
    const w = writesFor(id);
    for (const f of readFailed()) w.forget(keyOfLog(setOfOp(f.op)));
    // Offline gewiste of verlaagde records: nu de feed bijwerken.
    for (const { slug, uid } of feedDirty.current.values()) scheduleFeedSync(slug, uid);
    feedDirty.current.clear();
    reloadLogs();
    if (workout) invalidate(`group:${workout.group_id}`);
  });

  useEffect(() => {
    if (!wexKey) return;
    let subscribedOnce = false;
    const filter = `workout_exercise_id=in.(${wexKey})`;
    const channel = supabase
      .channel(`workout-${id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "set_logs", filter }, (p) => onRemoteRow(p.new as Record<string, unknown>))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "set_logs", filter }, (p) => onRemoteRow(p.new as Record<string, unknown>))
      // Verwijderingen zijn niet te filteren; we krijgen alleen het id en negeren onbekende sets.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "set_logs" }, (p) => onRemoteDelete(p.old as Record<string, unknown>))
      .on("postgres_changes", { event: "*", schema: "public", table: "comments", filter: `workout_id=eq.${id}` }, () => refreshComments())
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        // Na een herverbinding kunnen we updates gemist hebben.
        if (subscribedOnce) refreshAll();
        subscribedOnce = true;
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, wexKey]);

  useEffect(() => {
    // Invoer bewaren als de telefoon op slot gaat of je van app wisselt terwijl je nog in een veld zit.
    const flushInput = () => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && el.dataset.setInput !== undefined) el.blur();
    };
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        flushInput();
      } else if (hiddenAt && Date.now() - hiddenAt > 15_000) {
        refreshAll();
      }
    };
    const onOnline = () => refreshAll();
    const synced = () => onSynced();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushInput);
    window.addEventListener("online", onOnline);
    window.addEventListener(SYNCED_EVENT, synced);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushInput);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(SYNCED_EVENT, synced);
    };
  }, []);

  useEffect(() => {
    const timers = feedTimers.current;
    return () => {
      for (const t of timers.values()) window.clearTimeout(t);
    };
  }, []);

  // ─── Weergave ───
  if (bundle === undefined) {
    return (
      <AppShell title="Training" back>
        {wk.error ? (
          <div className="card space-y-3">
            <p className="font-semibold">Training kon niet worden geladen</p>
            <p className="text-sm text-muted">
              {typeof navigator !== "undefined" && !navigator.onLine
                ? "Je bent offline en deze training staat nog niet op dit toestel. Probeer het opnieuw zodra je verbinding hebt."
                : "Controleer je verbinding en probeer het opnieuw."}
            </p>
            <button className="btn-primary w-full" onClick={wk.retry}>
              Opnieuw proberen
            </button>
          </div>
        ) : (
          <div className="space-y-4" aria-busy="true" aria-label="Training laden">
            <div className="skeleton h-4 w-2/3" />
            <div className="flex gap-2">
              <div className="skeleton h-14 w-24" />
              <div className="skeleton h-14 w-24" />
              <div className="skeleton h-14 w-24" />
            </div>
            <div className="skeleton h-64" />
            <div className="skeleton h-48" />
          </div>
        )}
      </AppShell>
    );
  }
  if (bundle === null || !workout) {
    return (
      <AppShell title="Training" back="/">
        <div className="card space-y-3">
          <p className="font-semibold">Training niet gevonden</p>
          <p className="text-sm text-muted">Deze training bestaat niet meer, of je hebt er geen toegang toe.</p>
          <Link href="/" className="btn-ghost w-full">
            Naar home
          </Link>
        </div>
      </AppShell>
    );
  }

  const loadingLogs = logs === undefined;
  const plannedFor = (uid: string) => plannedSets(exercises, allLogs, uid);
  const myDone = doneSets(allLogs, forUser);
  const myPlanned = plannedFor(forUser);
  const allDone = myPlanned > 0 && myDone >= myPlanned;
  const bestFor = (uid: string, slug: string) => (derived[uid] ? bestOf(derived[uid].before.get(slug) ?? [], slug) : null);
  const personView = (uid: string, slug: string, name?: string): PersonView => ({
    uid,
    name,
    prev: derived[uid]?.prev[slug],
    best: bestFor(uid, slug),
    readOnly: !canEdit(uid),
  });
  const logsByWex = new Map<string, LogRow[]>();
  for (const l of allLogs) {
    const list = logsByWex.get(l.workout_exercise_id);
    if (list) list.push(l);
    else logsByWex.set(l.workout_exercise_id, [l]);
  }
  /**
   * Volgende persoon voor dezelfde oefening: wie daar nog een open set heeft, anders gewoon de
   * volgende in de rij.
   */
  const nextFor = (cardId: string | null | undefined) =>
    turns.nextFor(
      cardId ? exercises.find((e) => `exercise-${e.id}` === cardId) : undefined,
      forUser,
      allLogs,
    );
  const nextPerson = switcher && !showGroup ? nextFor(viewCard) : undefined;
  const failedHere = allLogs.filter((l) => l.failed).length;

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
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="text-sm text-muted">
              {formatDate(workout.date)}
              {workout.groups?.name ? ` · ${workout.groups.name}` : ""}
            </p>
            {isTrainer && (
              <Link
                href={`/groups/${workout.group_id}/plan?from=${workout.id}`}
                className="-my-2 inline-flex min-h-10 items-center gap-1.5 text-xs font-medium text-muted transition hover:text-ink"
              >
                <CalendarIcon size={14} className="text-accent" /> Opnieuw plannen
              </Link>
            )}
          </div>
          {workout.notes && <p className="whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-sm">{workout.notes}</p>}
        </div>

        {/* Voortgang per persoon; blijft bovenin staan zodat je overal kunt wisselen */}
        {(members.length > 0 || checks.length > 0) && (
          <div className={`sticky ${STICKY_TOP} z-10 -mx-4 bg-bg/90 px-4 py-2 backdrop-blur`}>
            <div className="flex items-stretch gap-2">
              <div
                className="-ml-4 flex min-w-0 flex-1 gap-2 overflow-x-auto pl-4 [scrollbar-width:none]"
                role="group"
                aria-label="Kies voor wie je sets bekijkt of invult"
              >
                {switcher && (
                  <button
                    data-person-chip
                    onClick={() => switchPerson(null)}
                    aria-pressed={showGroup}
                    className={`flex shrink-0 flex-col justify-center rounded-xl border px-3 py-1.5 text-left transition active:scale-[0.97] ${
                      showGroup ? "border-accent bg-accent/10" : "border-line bg-bg hover:border-muted"
                    }`}
                  >
                    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${showGroup ? "text-accent" : ""}`}>
                      <UsersIcon size={15} /> Iedereen
                    </span>
                    <span className="text-xs text-muted">Groepsmodus</span>
                  </button>
                )}
                {members.map((m) => {
                  const done = doneSets(allLogs, m.user_id);
                  const planned = plannedFor(m.user_id);
                  const active = !showGroup && m.user_id === forUser;
                  const skipped = turns.on && !turns.takesPart(m.user_id);
                  const pct = planned ? Math.min(100, (done / planned) * 100) : 0;
                  return (
                    <button
                      key={m.user_id}
                      data-person-chip
                      onClick={() => switchPerson(m.user_id)}
                      aria-pressed={active}
                      className={`min-w-24 shrink-0 rounded-xl border px-3 py-1.5 text-left transition active:scale-[0.97] ${
                        active ? "border-accent bg-accent/10" : "border-line bg-bg hover:border-muted"
                      } ${skipped ? "opacity-55" : ""}`}
                    >
                      <span className={`flex items-center gap-1 text-sm font-semibold ${active ? "text-accent" : ""}`}>
                        <span className="max-w-28 truncate">{m.user_id === userId ? "Jij" : (m.profiles?.display_name ?? "Onbekend")}</span>
                        {planned > 0 && done >= planned && <CheckIcon size={13} strokeWidth={3} className="text-accent" />}
                      </span>
                      <span className="block text-xs tabular-nums text-muted">
                        {loadingLogs ? "…" : `${done}/${planned} sets`}
                        {skipped && <span className="sr-only">, doet niet mee met om de beurt</span>}
                      </span>
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                        <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
                      </span>
                    </button>
                  );
                })}
              </div>
              {switcher && (
                <TurnsControl
                  on={turns.on}
                  people={members.filter((m) => canEdit(m.user_id)).map((m) => ({ uid: m.user_id, name: m.user_id === userId ? "Jij" : nameOf(m.user_id) }))}
                  takesPart={turns.takesPart}
                  onToggle={turns.setOn}
                  onTakePart={turns.setTakesPart}
                />
              )}
              {turns.on && (
                <p className="sr-only" aria-live="polite" aria-atomic="true">
                  {turns.note}
                </p>
              )}
              {nextPerson && (
                <button
                  type="button"
                  // Bij de tik zelf opnieuw bepalen welke oefening in beeld is (het label kan net achterlopen).
                  onClick={() => switchPerson(nextFor(cardInView()?.id))}
                  className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl border border-line bg-surface-2 text-xs font-medium text-muted transition hover:text-ink active:scale-[0.97]"
                  aria-label={`Volgende persoon: ${nextPerson === userId ? "jij" : nameOf(nextPerson)}`}
                  title="Volgende persoon, zelfde oefening"
                >
                  <ChevronRightIcon size={18} className="text-accent" />
                  Volgende
                </button>
              )}
            </div>
            <JumpCheck items={checks} onDone={closeCheck} />
          </div>
        )}

        {showGroup ? (
          <div className="space-y-3">
            <p className="rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-sm">
              Groepsmodus: per oefening vul je de sets van iedereen in, zonder te wisselen.
            </p>
            <GroupGrid
              exercises={exercises}
              members={members}
              logs={allLogs}
              userId={userId}
              loading={loadingLogs}
              onJump={(we, uid) => focusSet(we, uid, firstOpenSet(we, uid), { focus: false })}
            />
          </div>
        ) : !isMember ? (
          <p className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-muted">
            Je bekijkt deze training als vriend. Alleen groepsleden kunnen sets invullen.
          </p>
        ) : forUser !== userId && isTrainer ? (
          <p className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            Je vult nu sets in voor <strong>{nameOf(forUser)}</strong>.
          </p>
        ) : forUser !== userId ? (
          <p className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-muted">
            Je bekijkt de sets van <strong className="text-ink">{nameOf(forUser)}</strong>.
          </p>
        ) : null}

        {logsError && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm" role="status">
            <span className="text-muted">
              {serverLogs ? "Geen verbinding: je ziet de laatst bekende sets. Wat je invult wordt bewaard." : "Sets konden niet worden geladen. Wat je invult wordt bewaard."}
            </span>
            <button className="min-h-10 shrink-0 font-semibold text-accent" onClick={reloadLogs}>
              Opnieuw
            </button>
          </div>
        )}

        {failedHere > 0 && (
          <p className="rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
            {failedHere === 1 ? "Eén set kon" : `${failedHere} sets konden`} niet worden opgeslagen. Tik op het pijltje bij de set om het opnieuw te
            proberen.
          </p>
        )}

        {exercises.length === 0 ? (
          <div className="card space-y-3 text-center">
            <p className="font-semibold">Nog geen oefeningen</p>
            <p className="text-sm text-muted">
              {isTrainer ? "Voeg oefeningen toe om deze training te kunnen loggen." : "De trainer heeft nog geen oefeningen aan deze training toegevoegd."}
            </p>
            {isTrainer && (
              <Link href={`/groups/${workout.group_id}/plan?edit=${workout.id}`} className="btn-primary w-full">
                Oefeningen toevoegen
              </Link>
            )}
          </div>
        ) : (
          <ol className="space-y-4">
            {exercises.map((we, i) => (
              <ExerciseCard
                key={we.id}
                index={i}
                we={we}
                people={
                  showGroup
                    ? members.map((m) => personView(m.user_id, we.exercise_slug, m.user_id === userId ? "Jij" : (m.profiles?.display_name ?? "Onbekend")))
                    : [personView(forUser, we.exercise_slug)]
                }
                logs={logsByWex.get(we.id) ?? NO_LOGS}
                comments={comments.filter((c) => c.workout_exercise_id === we.id)}
                nameOf={nameOf}
                userId={userId}
                isTrainer={isTrainer}
                canComment={isMember}
                groupMode={showGroup}
                loading={loadingLogs}
                onSave={saveSet}
                onDelete={(w, uid, n, log) => deleteSet(w, uid, n, log)}
                onUncomplete={uncompleteSet}
                onFill={fillSets}
                onCompleted={turns.onCompleted}
                onCommentsChange={cm.retry}
                onError={showError}
              />
            ))}
          </ol>
        )}

        {exercises.length > 0 && (
          <button
            className={`${allDone ? "btn-primary" : "btn-ghost"} w-full py-3 text-base`}
            onClick={() => setFinishOpen(true)}
            disabled={loadingLogs}
          >
            {allDone && <CheckIcon size={18} strokeWidth={2.6} />}
            {allDone ? "Training afgerond, bekijk samenvatting" : `Training afronden (${myDone}/${myPlanned} sets)`}
          </button>
        )}

        <section className="card space-y-3">
          <h2 className="font-bold">Opmerkingen bij de training</h2>
          {cm.error && comments.length === 0 && <p className="text-sm text-muted">Opmerkingen konden niet worden geladen.</p>}
          <CommentThread
            workoutId={workout.id}
            workoutExerciseId={null}
            comments={comments.filter((c) => c.workout_exercise_id === null)}
            userId={userId}
            isTrainer={isTrainer}
            canPost={isMember}
            nameOf={nameOf}
            onChange={cm.retry}
            onError={showError}
          />
        </section>
      </div>

      {finishOpen && (
        <FinishSheet
          open
          onClose={() => setFinishOpen(false)}
          workout={workout}
          exercises={exercises}
          members={members}
          logs={allLogs}
          uid={forUser}
          userId={userId}
          history={histories[forUser]}
          historyFor={(uid) => histories[uid]}
          canShareFor={canEdit}
          nameOf={nameOf}
        />
      )}
      <Celebration data={celebration} onClose={closeCelebration} />
    </AppShell>
  );
}
