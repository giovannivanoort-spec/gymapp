"use client";

import { useCallback, useState } from "react";
import { useUserId } from "@/components/AuthProvider";
import { commentsKey, histPrefix, logsKey, workoutKey } from "@/components/workout/data";
import {
  cachedKeys,
  fetchCached,
  forgetPersisted,
  getCached,
  invalidate,
  readCached,
  removeCached,
  setCached,
  useCached,
  useCachedError,
} from "@/lib/cache";
import { toISODate } from "@/lib/dates";
import { invalidateMyGroups, myGroupsKey, type MyGroup } from "@/lib/groups";
import { invalidateHistory } from "@/lib/history";
import { dropForGroup } from "@/lib/offlineQueue";
import { isMissingSchemaError, supabase } from "@/lib/supabase";
import { PUBLIC_PROFILE_COLUMNS, PUBLIC_PROFILE_COLUMNS_NO_PHOTO, type Group, type GroupMember, type Workout } from "@/lib/types";
import { addDays } from "@/lib/week";

/** Eén plek voor de (nieuwe) naam van de app in deelteksten. */
export const APP_NAME = "Spotter";

export type GroupWorkout = Workout & { exerciseCount: number };

export type GroupData = {
  group: Group;
  members: GroupMember[];
  /** Vandaag en later, oud → nieuw. */
  upcoming: GroupWorkout[];
  /** Eerdere trainingen (eerste pagina), nieuw → oud. */
  past: GroupWorkout[];
  hasMorePast: boolean;
  /** Per training: wie er minstens één set heeft gelogd. */
  attendance: Record<string, string[]>;
  /**
   * Alle groepstrainingen van de laatste ATTENDANCE_WEEKS weken (t/m vandaag), los van de paginering,
   * zodat aanwezigheid en reeksen niet veranderen na "Meer laden". Ontbreekt in oude cache-data.
   */
  window?: { id: string; date: string }[];
};

/** Zoveel weken terug telt de aanwezigheid (ranglijst "Aanwezig" en reeksen). */
export const ATTENDANCE_WEEKS = 16;

export const PAST_PAGE = 30;

/** Aantal feed-items per pagina (de eerste pagina wordt bewaard). */
export const FEED_PAGE = 15;

export const groupKey = (id: string) => `group:${id}`;

export type GroupLoadErrorKind = "notfound" | "network";

export class GroupLoadError extends Error {
  kind: GroupLoadErrorKind;
  constructor(kind: GroupLoadErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

type WorkoutRow = Workout & { workout_exercises: { count: number }[] };

const toGroupWorkout = (w: WorkoutRow): GroupWorkout => {
  const { workout_exercises, ...rest } = w;
  return { ...rest, exerciseCount: workout_exercises?.[0]?.count ?? 0 };
};

function networkError(): GroupLoadError {
  return new GroupLoadError("network", "Kan de groep niet laden. Controleer je verbinding.");
}

const isMissingFunction = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? ""));

/** Zonder RPC: PostgREST geeft standaard hooguit 1000 rijen per verzoek, dus per pagina ophalen. */
const ATTENDANCE_PAGE = 1000;
/** Zonder RPC: zoveel trainingen per verzoek (houdt de URL kort). */
const ATTENDANCE_CHUNK = 60;
/** Zonder RPC: vangnet tegen eindeloos doorpagineren per groep trainingen. */
const ATTENDANCE_MAX_PAGES = 50;

/**
 * Wie er per training minstens één set heeft gelogd (welk setnummer dan ook).
 * Gooit bij een fout: een lege lijst zou anders als "niemand heeft getraind" in de cache belanden.
 */
export async function fetchAttendance(workoutIds: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (workoutIds.length === 0) return out;
  const add = (wid: string, uid: string) => {
    const list = (out[wid] ??= []);
    if (!list.includes(uid)) list.push(uid);
  };

  // Bij voorkeur de RPC uit upgrade-groups.sql: alleen unieke (training, lid)-paren, geen limiet.
  const rpc = await supabase.rpc("group_attendance", { wids: workoutIds });
  if (!rpc.error && rpc.data) {
    for (const r of rpc.data as { workout_id: string; user_id: string }[]) add(r.workout_id, r.user_id);
    return out;
  }
  if (!isMissingFunction(rpc.error)) throw networkError();

  // Zonder RPC: ruwe set-rijen, in kleine groepen trainingen en per pagina met een vaste
  // volgorde, zodat de standaardlimiet van PostgREST niet stilletjes trainingen weglaat.
  const chunks: string[][] = [];
  for (let i = 0; i < workoutIds.length; i += ATTENDANCE_CHUNK) chunks.push(workoutIds.slice(i, i + ATTENDANCE_CHUNK));
  await Promise.all(
    chunks.map(async (ids) => {
      for (let page = 0; page < ATTENDANCE_MAX_PAGES; page++) {
        const from = page * ATTENDANCE_PAGE;
        const { data, error } = await supabase
          .from("set_logs")
          .select("id, user_id, workout_exercises!inner(workout_id)")
          .in("workout_exercises.workout_id", ids)
          .gt("reps", 0)
          .order("id")
          .range(from, from + ATTENDANCE_PAGE - 1);
        if (error || !data) throw networkError();
        for (const r of data as unknown as { user_id: string; workout_exercises: { workout_id: string } }[]) {
          add(r.workout_exercises.workout_id, r.user_id);
        }
        if (data.length < ATTENDANCE_PAGE) break;
      }
    }),
  );
  return out;
}

/** Een pagina eerdere trainingen (nieuw → oud). */
export async function fetchPastWorkouts(groupId: string, offset: number): Promise<{ items: GroupWorkout[]; hasMore: boolean }> {
  const { data, error } = await supabase
    .from("workouts")
    .select("*, workout_exercises(count)")
    .eq("group_id", groupId)
    .lt("date", toISODate())
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + PAST_PAGE);
  if (error) throw networkError();
  const rows = (data as WorkoutRow[]) ?? [];
  return { items: rows.slice(0, PAST_PAGE).map(toGroupWorkout), hasMore: rows.length > PAST_PAGE };
}

/** Trainingen (alleen id en datum) binnen het vaste aanwezigheidsvenster, vóór vandaag. */
async function fetchWindow(groupId: string, today: string) {
  const since = toISODate(addDays(new Date(), -ATTENDANCE_WEEKS * 7));
  const { data, error } = await supabase
    .from("workouts")
    .select("id, date")
    .eq("group_id", groupId)
    .gte("date", since)
    .lt("date", today)
    .order("date", { ascending: false })
    .limit(400);
  if (error) throw networkError();
  return (data ?? []) as { id: string; date: string }[];
}

/** Leden met openbaar profiel; zonder profielfoto als upgrade-avatars.sql nog niet is gedraaid. */
async function fetchGroupMembers(id: string) {
  const query = (cols: string) => supabase.from("group_members").select(`*, profiles(${cols})`).eq("group_id", id).order("joined_at");
  const res = await query(PUBLIC_PROFILE_COLUMNS);
  return res.error && isMissingSchemaError(res.error) ? query(PUBLIC_PROFILE_COLUMNS_NO_PHOTO) : res;
}

export async function fetchGroupData(id: string): Promise<GroupData> {
  const today = toISODate();
  const [g, m, up, past, win, me] = await Promise.all([
    supabase.from("groups").select("*").eq("id", id).single(),
    fetchGroupMembers(id),
    supabase
      .from("workouts")
      .select("*, workout_exercises(count)")
      .eq("group_id", id)
      .gte("date", today)
      .order("date")
      .order("created_at")
      .limit(60),
    fetchPastWorkouts(id, 0).catch(() => null),
    fetchWindow(id, today).catch(() => null),
    supabase.auth.getSession().then(
      (r) => r.data.session?.user.id ?? null,
      () => null,
    ),
  ]);
  if (g.error) {
    // PGRST116: geen rij. Door RLS betekent dat: bestaat niet of je bent geen lid.
    if (g.error.code === "PGRST116") throw new GroupLoadError("notfound", "Deze groep bestaat niet of je bent geen lid.");
    throw networkError();
  }
  if (m.error || up.error || !past || !win) throw networkError();

  const members = (m.data as unknown as GroupMember[] | null) ?? [];
  // De groepsrij is ook leesbaar voor wie hem ooit maakte. Wie geen lid (meer) is, krijgt
  // "niet gevonden" in plaats van een lege groep zonder leden en trainingen.
  if (me && !members.some((x) => x.user_id === me)) {
    throw new GroupLoadError("notfound", "Je bent geen lid (meer) van deze groep.");
  }

  const upcoming = ((up.data as WorkoutRow[]) ?? []).map(toGroupWorkout);
  const todays = upcoming.filter((w) => w.date === today).map((w) => ({ id: w.id, date: w.date }));
  const inWindow = [...todays, ...win];
  const attendanceIds = [...new Set([...inWindow, ...past.items].map((w) => w.id))];
  const attendance = await fetchAttendance(attendanceIds);

  return {
    group: g.data as Group,
    members,
    upcoming,
    past: past.items,
    hasMorePast: past.hasMore,
    attendance,
    window: inWindow,
  };
}

/**
 * Groepsdata uit de gedeelde cache (direct zichtbaar bij terugkeren), met foutstatus:
 * "notfound" (geen lid of verwijderd) of "network" (offline, time-out).
 */
export function useGroupData(id: string | null) {
  const userId = useUserId();
  const [error, setError] = useState<GroupLoadError | null>(null);
  const key = id ? groupKey(id) : null;

  const fetcher = useCallback(
    () =>
      fetchGroupData(id!).then(
        (d) => {
          setError(null);
          return d;
        },
        (e: unknown) => {
          const err = e instanceof GroupLoadError ? e : networkError();
          // Verwijderd uit de groep of groep weg: ook de lokale kopieën en Home bijwerken.
          if (err.kind === "notfound" && id) dropGroupLocally(id, userId);
          setError(err);
          throw e;
        },
      ),
    [id, userId],
  );

  const data = useCached(key, fetcher, { persist: true, maxAge: 15_000 });
  // Opnieuw geopend na "niet gevonden": die uitkomst staat nog in de cache-status (er wordt dan
  // niet opnieuw opgehaald), dus ook dan direct het juiste scherm tonen.
  const lastError = useCachedError(key);
  const notFound = lastError instanceof GroupLoadError && lastError.kind === "notfound" && data === undefined ? lastError : null;

  const retry = useCallback(() => {
    if (!id) return;
    setError(null);
    fetchCached(groupKey(id), fetcher, true).catch(() => {});
  }, [id, fetcher]);

  return { data, error: error ?? notFound, retry };
}

/** Na wijzigingen aan leden of trainingen: groep (en de lijst op Home) opnieuw laten ophalen. */
export function refreshGroup(groupId: string, userId?: string) {
  invalidate(groupKey(groupId));
  if (userId) invalidateMyGroups(userId);
}

/** Na verwijderen/aanpassen van trainingen: afgeleide data (ranglijst, geschiedenis) verversen. */
export function refreshTrainingData(groupId: string) {
  invalidate(groupKey(groupId));
  invalidate("leaderboard:");
  invalidate("history:");
  invalidate(`feed:${groupId}`);
  // Geopende trainingen (titel, oefeningen) ook verversen.
  invalidate("wo:workout:");
}

/** De groep uit de lijst op Home halen (direct, zonder te wachten op het verversen). */
function removeFromHome(groupId: string, userId: string) {
  if (!userId) return;
  const homeKey = myGroupsKey(userId);
  const mine = getCached<MyGroup[]>(homeKey);
  if (mine?.some((g) => g.id === groupId)) setCached(homeKey, mine.filter((g) => g.id !== groupId), true);
  invalidateMyGroups(userId);
}

/**
 * Bij "niet gevonden": de bewaarde kopieën vergeten. De groepssleutel krijgt een lege waarde die
 * even als vers geldt, zodat er geen herhaalde verzoeken volgen terwijl het foutscherm staat.
 *
 * Meestal is dit iemand die door een trainer uit de groep is gehaald (of een groep die intussen is
 * verwijderd): dan ook de bewaarde trainingen en de offline wachtrij van die groep opruimen, net als
 * bij zelf verlaten. Anders staat hij in een offline kopie nog als lid en lijkt de training bewerkbaar.
 */
function dropGroupLocally(groupId: string, userId: string) {
  removeFromHome(groupId, userId);
  if (getCached(groupKey(groupId)) !== undefined) setCached(groupKey(groupId), undefined);
  forgetPersisted(groupKey(groupId));
  forgetPersisted(`feed:${groupId}:${FEED_PAGE}`);
  forgetGroupWorkouts(groupId).catch(() => {});
  invalidate("leaderboard:", { soft: true });
}

/**
 * Vanaf een trainingspagina vastgesteld dat je geen lid meer bent (de bewaarde kopie had je nog als
 * lid, de server niet meer): de groep en zijn andere bewaarde trainingen vergeten, zoals bij het
 * openen van de groepspagina. De training die nu open staat (`keepWorkout`) blijft staan: die pagina
 * toont zelf al de alleen-lezen weergave en laat wachtende sets bewust weggooien.
 */
export function forgetRemovedGroup(groupId: string, userId: string, keepWorkout: string) {
  removeFromHome(groupId, userId);
  forgetPersisted(groupKey(groupId));
  forgetPersisted(`feed:${groupId}:${FEED_PAGE}`);
  removeCached(groupKey(groupId));
  removeCached(`feed:${groupId}:`);
  forgetGroupWorkouts(groupId, keepWorkout).catch(() => {});
  invalidate("leaderboard:", { soft: true });
}

/**
 * Na verlaten of verwijderen: de groep meteen uit de lijst op Home halen en de bewaarde
 * groepsdata en feed vergeten, zodat er nergens nog een oude kopie opduikt. De kopie op het
 * toestel gaat meteen weg; het geheugen (en een fetch die nog loopt) pas als de navigatie naar
 * Home klaar is, anders flitst er op de nog zichtbare pagina een skeleton of "niet gevonden".
 *
 * `deleted`: de groep zelf is verwijderd (niet alleen verlaten). Dan zijn ook alle gelogde sets
 * daarin weg en moet de eigen geschiedenis volledig opnieuw worden opgehaald.
 */
export function forgetGroup(groupId: string, userId: string, { deleted = false }: { deleted?: boolean } = {}) {
  removeFromHome(groupId, userId);
  forgetPersisted(groupKey(groupId));
  forgetPersisted(`feed:${groupId}:${FEED_PAGE}`);
  window.setTimeout(() => {
    removeCached(groupKey(groupId));
    removeCached(`feed:${groupId}:`);
  }, FORGET_DELAY_MS);
  // Opruimen op de achtergrond; een onverwachte fout (opslag niet beschikbaar) mag het verlaten niet
  // in de weg zitten: online haalt de trainingspagina toch alles opnieuw op.
  forgetGroupWorkouts(groupId).catch(() => {});
  invalidate("leaderboard:", { soft: true });
  invalidate("history:", { soft: true });
  // Groep verwijderd: de sets daarin zijn echt weg, dus de eigen geschiedenis volledig opnieuw (een
  // gedeeltelijke sync haalt alleen de laatste week op en zou oudere sets laten staan).
  // Alleen verlaten: de eigen sets blijven bestaan en (met upgrade-own-history.sql) zichtbaar, dus
  // volstaat het zachte verversen hierboven. Bewust niet volledig: staat de SQL-upgrade (nog) niet
  // live, dan zou een volledige sync de sets uit deze groep direct uit records en ranks halen, terwijl
  // de melding bij verlaten belooft dat ze blijven.
  if (deleted) invalidateHistory(userId);
}

/** Bewaarde training zoals hier gelezen: data van het toestel, dus niet op de vorm vertrouwen. */
type StoredBundle = { workout?: { group_id?: unknown; workout_exercises?: unknown } } | null;

/**
 * Bewaarde trainingen van een verlaten of verwijderde groep vergeten (training met leden, sets,
 * opmerkingen en de geschiedenis die erbij is opgehaald). Anders staat jij er in een offline kopie
 * nog als lid in: de training lijkt dan bewerkbaar, en wat je invult zou later toch geweigerd worden.
 * Online haalt de trainingspagina alles opnieuw op met wat je nu nog mag zien.
 *
 * Welke bewaarde trainingen bij de groep horen, staat alleen in die trainingen zelf: ze worden dus
 * allemaal even ingelezen (ook grote items uit IndexedDB). Dat gebeurt alleen bij verlaten of
 * verwijderen, en een onleesbaar item slaat alleen dat item over.
 *
 * Ook wat er voor deze groep nog in de offline wachtrij stond, gaat weg: die sets kunnen na het
 * verlaten niet meer worden opgeslagen (de server weigert ze), en records of "training afgerond"
 * kunnen niet meer in de groepsfeed. Sets van een training die niet (meer) bewaard was, worden hier
 * niet herkend; die verschijnen op de trainingspagina als "niet meer op te slaan", met de keuze om
 * ze weg te gooien.
 *
 * `keepWorkout`: deze training (en wat daarvoor nog wacht) overslaan, omdat die nu open staat.
 */
async function forgetGroupWorkouts(groupId: string, keepWorkout?: string) {
  const prefix = workoutKey("");
  const ids: string[] = [];
  const wexIds = new Set<string>();
  for (const key of await cachedKeys(prefix)) {
    if (keepWorkout && key === workoutKey(keepWorkout)) continue;
    let workout: NonNullable<StoredBundle>["workout"];
    try {
      workout = (await readCached<StoredBundle>(key))?.workout;
    } catch {
      continue;
    }
    if (!workout || workout.group_id !== groupId) continue;
    ids.push(key.slice(prefix.length));
    const list = workout.workout_exercises;
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      const wexId = (e as { id?: unknown } | null)?.id;
      if (typeof wexId === "string") wexIds.add(wexId);
    }
  }
  dropForGroup(groupId, wexIds);
  for (const id of ids) for (const k of [workoutKey(id), logsKey(id), commentsKey(id), histPrefix(id)]) removeCached(k);
}

/** Wachttijd voordat een verlaten groep ook uit het geheugen gaat (navigatie naar Home is dan klaar). */
const FORGET_DELAY_MS = 1500;

/** Nette Nederlandse opsomming: "A", "A en B", "A, B en C". */
export function joinNames(names: string[], max = 3): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > max) {
    const rest = names.length - (max - 1);
    return `${names.slice(0, max - 1).join(", ")} en ${rest} anderen`;
  }
  return `${names.slice(0, -1).join(", ")} en ${names[names.length - 1]}`;
}

export const memberName = (m: GroupMember | undefined) => m?.profiles?.display_name?.trim() || "Onbekend";

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
