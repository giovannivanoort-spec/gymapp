"use client";

import { useSyncExternalStore } from "react";
import { postActivity, type ActivityPayload, type ActivityType } from "./activities";
import { freePersistedSpace } from "./cache";
import { errorMessage, isAuthError, isRetryableError, supabase } from "./supabase";

/**
 * Wachtrij voor sets die zonder internet zijn ingevuld. Ze worden in de browser bewaard
 * (localStorage) en verstuurd zodra er weer verbinding is. Bewerkingen die echt mislukken
 * (bijv. geen rechten meer) gaan naar een aparte lijst, zodat ze nooit stilletjes verdwijnen.
 * Records en promoties die offline zijn behaald, wachten in een eigen lijst en worden pas in
 * de groepsfeed gezet als de set zelf is opgeslagen.
 */

export type SetKey = { workout_exercise_id: string; user_id: string; set_number: number };
export type QueuedOp = (
  | { kind: "upsert"; row: SetKey & { weight: number | null; reps: number | null } }
  | { kind: "delete"; key: SetKey }
) & {
  /** Moment van invullen (ms), om de volgorde te tonen. */
  at?: number;
  /** Wie de bewerking deed (ingelogde gebruiker); een ander account op dit toestel verstuurt hem niet. */
  by?: string;
};
export type FailedOp = { op: QueuedOp; error: string; at: number };
/** Activiteit voor de groepsfeed die wacht tot de bijbehorende set is opgeslagen. */
export type QueuedActivity = {
  set: SetKey;
  /** De waarde waarmee het record is behaald; is de set intussen anders, dan vervalt hij. */
  value: { weight: number | null; reps: number | null };
  activity: { groupId: string; userId: string; workoutId?: string; type: ActivityType; payload: ActivityPayload };
  by?: string;
  at: number;
};

/** "Training afgerond" die wacht tot de sets van die training zijn verstuurd. */
export type QueuedFinished = {
  activity: { groupId: string; userId: string; workoutId: string; type: "finished"; payload: ActivityPayload };
  /** Oefeningen van de training: zo zien we welke wachtende sets erbij horen. */
  wexIds: string[];
  by?: string;
  at: number;
};

const STORAGE_KEY = "gymapp-offline-queue";
const FINISHED_KEY = "gymapp-offline-finished";
const FAILED_KEY = "gymapp-offline-failed";
const ACTIVITY_KEY = "gymapp-offline-activities";
export const QUEUE_EVENT = "gymapp-queue-change";
/** Na een verzendpoging waarbij sets de wachtrij hebben verlaten (verstuurd of definitief mislukt). */
export const SYNCED_EVENT = "gymapp-synced";
/** De browseropslag is vol: een offline ingevulde set kon niet worden bewaard. */
export const QUEUE_FULL_EVENT = "gymapp-queue-full";
/** Hoe lang een schrijfactie mag duren voordat hij als "geen verbinding" geldt (en in de wachtrij gaat). */
export const WRITE_TIMEOUT_MS = 12_000;

function readJson<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJson(key: string, value: unknown[]) {
  let full = false;
  try {
    if (value.length) {
      const raw = JSON.stringify(value);
      try {
        localStorage.setItem(key, raw);
      } catch {
        // Opslag vol: oude cache opruimen (die is altijd opnieuw op te halen) en nog één keer proberen.
        freePersistedSpace(raw.length * 2);
        try {
          localStorage.setItem(key, raw);
        } catch {
          full = true;
        }
      }
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // opslag niet beschikbaar (privévenster): dan helaas niet offline bewaren
  }
  window.dispatchEvent(new Event(QUEUE_EVENT));
  if (full) window.dispatchEvent(new Event(QUEUE_FULL_EVENT));
}

export function readQueue(): QueuedOp[] {
  return readJson<QueuedOp>(STORAGE_KEY);
}

function writeQueue(q: QueuedOp[]) {
  writeJson(STORAGE_KEY, q);
}

export function readFailed(): FailedOp[] {
  return readJson<FailedOp>(FAILED_KEY);
}

const keyOf = (op: QueuedOp): SetKey => (op.kind === "upsert" ? op.row : op.key);
const sameSet = (a: SetKey, b: SetKey) =>
  a.workout_exercise_id === b.workout_exercise_id && a.user_id === b.user_id && a.set_number === b.set_number;

/** De set waar een (mislukte) bewerking over gaat. */
export const setOfOp = keyOf;

/** Voegt een bewerking toe; een nieuwere bewerking op dezelfde set vervangt de oude. */
export function enqueue(op: QueuedOp) {
  const key = keyOf(op);
  const q = readQueue().filter((o) => !sameSet(keyOf(o), key));
  writeQueue([...q, { ...op, at: op.at ?? Date.now() }]);
}

/** Haalt een wachtende bewerking weg (bijv. omdat dezelfde set net online is opgeslagen). */
export function dequeue(key: SetKey) {
  const q = readQueue();
  const next = q.filter((o) => !sameSet(keyOf(o), key));
  if (next.length !== q.length) writeQueue(next);
}

/** Haalt een set uit de lijst met mislukte sets (bijv. omdat hij opnieuw wordt opgeslagen). */
export function removeFailed(key: SetKey) {
  const f = readFailed();
  const next = f.filter((x) => !sameSet(keyOf(x.op), key));
  if (next.length !== f.length) writeJson(FAILED_KEY, next);
}

/**
 * Haalt alle wachtende en mislukte bewerkingen van deze oefeningen (workout_exercise-ids) weg. Alleen
 * aanroepen als vaststaat dat ze weg zijn (een live verwijdering, of goneWex: zie dropGoneWex).
 * Eén schrijfactie per lijst.
 * Geeft het aantal sets terug waarvan iets is weggehaald (een set die zowel wachtte als mislukte,
 * telt één keer).
 */
export function dropForWex(wexIds: ReadonlySet<string>): number {
  if (!wexIds.size) return 0;
  const sets = new Set<string>();
  const drop = (op: QueuedOp) => {
    const k = keyOf(op);
    if (!wexIds.has(k.workout_exercise_id)) return false;
    sets.add(lockKeyOf(k));
    return true;
  };
  const q = readQueue();
  const keepQ = q.filter((o) => !drop(o));
  if (keepQ.length !== q.length) writeQueue(keepQ);
  const f = readFailed();
  const keepF = f.filter((x) => !drop(x.op));
  if (keepF.length !== f.length) writeJson(FAILED_KEY, keepF);
  return sets.size;
}

/** Zet een set (opnieuw) op de lijst met mislukte sets, met een Nederlandse foutmelding. */
export function markFailed(op: QueuedOp, error: unknown) {
  const key = keyOf(op);
  const entry: FailedOp = { op: { ...op, at: op.at ?? Date.now() }, error: errorMessage(error), at: Date.now() };
  writeJson(FAILED_KEY, [...readFailed().filter((f) => !sameSet(keyOf(f.op), key)), entry].slice(-50));
}

/**
 * Door dit account in de wachtrij gezet (een trainer logt ook voor vrienden). Bewerkingen uit een
 * oudere versie hebben geen `by`: die horen bij wie nu is ingelogd (de trainer kan offline sets van
 * vrienden hebben gelogd). Mag dit account de set niet schrijven, dan gaat hij naar de mislukte sets.
 */
export function isOwnOp(op: QueuedOp, uid: string): boolean {
  return op.by === undefined || op.by === uid;
}

/** Sleutel van een set voor het slot hieronder (zelfde vorm als op de trainingspagina). */
export const lockKeyOf = (k: SetKey) => `${k.workout_exercise_id}|${k.user_id}|${k.set_number}`;

const locks = new Map<string, Promise<unknown>>();

/**
 * Voert schrijfacties voor dezelfde set na elkaar uit, in volgorde. De trainingspagina en het
 * versturen van de wachtrij gebruiken hetzelfde slot, zodat een oude wachtende versie van een set
 * nooit tegelijk met (en dus mogelijk na) een nieuwere opslag wordt verstuurd.
 */
export function withSetLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  locks.set(key, next);
  const clear = () => {
    if (locks.get(key) === next) locks.delete(key);
  };
  next.then(clear, clear);
  return next;
}

/**
 * Signaal dat een schrijfactie na `ms` afbreekt. Bij wifi die "verbonden" is maar pakketten
 * verliest, valt een hangende opslag zo in de wachtrij in plaats van eindeloos te laden.
 * Opslaan (upsert op de sleutel) en wissen zijn idempotent, dus opnieuw versturen is veilig.
 */
export function writeTimeout(ms = WRITE_TIMEOUT_MS): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(new DOMException("Timed out", "TimeoutError")), ms);
  return c.signal;
}

/** Wacht op een belofte, maar hoogstens `ms`; daarna `fallback`. */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

// ─── Records die offline zijn behaald ───

export function readActivities(): QueuedActivity[] {
  return readJson<QueuedActivity>(ACTIVITY_KEY);
}

/** Bewaart een record of promotie tot de bijbehorende set is verstuurd. */
export function enqueueActivity(a: Omit<QueuedActivity, "at">) {
  const same = (x: QueuedActivity) =>
    sameSet(x.set, a.set) && x.activity.type === a.activity.type && x.activity.payload.slug === a.activity.payload.slug;
  writeJson(ACTIVITY_KEY, [...readActivities().filter((x) => !same(x)), { ...a, at: Date.now() }].slice(-50));
}

/** Records plaatsen waarvan de set inmiddels is opgeslagen; vervallen als de set mislukte of is aangepast. */
async function flushActivities(uid: string) {
  const list = readActivities();
  if (!list.length) return;
  const queue = readQueue();
  const failed = readFailed();
  const keep: QueuedActivity[] = [];
  const post: QueuedActivity[] = [];
  for (const a of list) {
    if ((a.by ?? a.activity.userId) !== uid) keep.push(a);
    else if (queue.some((o) => sameSet(keyOf(o), a.set))) keep.push(a);
    else if (failed.some((f) => sameSet(keyOf(f.op), a.set))) continue;
    else if (Date.now() - a.at > 2 * 24 * 3600_000) continue;
    else post.push(a);
  }
  writeJson(ACTIVITY_KEY, keep);
  if (!post.length) return;
  // Alleen plaatsen als de set nog precies zo in de database staat.
  for (const a of post) {
    const { data, error } = await supabase
      .from("set_logs")
      .select("weight, reps")
      .eq("workout_exercise_id", a.set.workout_exercise_id)
      .eq("user_id", a.set.user_id)
      .eq("set_number", a.set.set_number)
      .maybeSingle();
    if (error) {
      if (isRetryableError(error)) writeJson(ACTIVITY_KEY, [...readActivities(), a]);
      continue;
    }
    if (!data || Number(data.weight ?? 0) !== Number(a.value.weight ?? 0) || data.reps !== a.value.reps) continue;
    await postActivity(a.activity).catch(() => {});
  }
}

// ─── "Training afgerond" die offline is gedeeld ───

export function readFinished(): QueuedFinished[] {
  return readJson<QueuedFinished>(FINISHED_KEY);
}

const sameFinished = (a: Pick<QueuedFinished, "activity">, b: Pick<QueuedFinished, "activity">) =>
  a.activity.workoutId === b.activity.workoutId && a.activity.userId === b.activity.userId;

/** Wachten er voor deze persoon nog sets van deze training? */
function hasQueuedSets(userId: string, wexIds: string[]) {
  const ids = new Set(wexIds);
  return readQueue().some((o) => keyOf(o).user_id === userId && ids.has(keyOf(o).workout_exercise_id));
}

/**
 * Deelt "training afgerond" in de groepsfeed. Offline, of terwijl er nog sets van deze training
 * in de wachtrij staan, wacht de melding tot die sets zijn verstuurd; de aantallen worden dan
 * opnieuw uit de database berekend (een wachtende set kan alsnog mislukken).
 */
export async function postFinished(activity: QueuedFinished["activity"], wexIds: string[], by?: string): Promise<"posted" | "queued"> {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  if (offline || hasQueuedSets(activity.userId, wexIds)) {
    const rest = readFinished().filter((f) => !sameFinished(f, { activity }));
    writeJson(FINISHED_KEY, [...rest, { activity, wexIds, by, at: Date.now() }].slice(-20));
    return "queued";
  }
  await postActivity(activity).catch(() => {});
  return "posted";
}

async function flushFinished(uid: string) {
  const list = readFinished();
  if (!list.length) return;
  const keep: QueuedFinished[] = [];
  const post: QueuedFinished[] = [];
  for (const f of list) {
    if ((f.by ?? f.activity.userId) !== uid || hasQueuedSets(f.activity.userId, f.wexIds)) keep.push(f);
    else if (Date.now() - f.at > 2 * 24 * 3600_000) continue;
    else post.push(f);
  }
  writeJson(FINISHED_KEY, keep);
  for (const f of post) {
    const { data, error } = await supabase
      .from("set_logs")
      .select("workout_exercise_id, weight, reps")
      .eq("user_id", f.activity.userId)
      .in("workout_exercise_id", f.wexIds);
    if (error) {
      if (isRetryableError(error)) writeJson(FINISHED_KEY, [...readFinished().filter((x) => !sameFinished(x, f)), f]);
      continue;
    }
    const done = ((data ?? []) as { workout_exercise_id: string; weight: number | null; reps: number | null }[]).filter(
      (l) => Number(l.reps ?? 0) > 0,
    );
    if (!done.length) continue;
    const volume = done.reduce((sum, l) => sum + Number(l.weight ?? 0) * Number(l.reps ?? 0), 0);
    const payload: ActivityPayload = {
      ...f.activity.payload,
      sets: done.length,
      volume: Math.round(volume),
      exercises: new Set(done.map((l) => l.workout_exercise_id)).size,
    };
    await postActivity({ ...f.activity, payload }).catch(() => {});
  }
}

// ─── Versturen ───

let flushing = false;
let lastFlush = { sent: 0, failed: 0, dropped: 0, stalled: false };

/** Detail van SYNCED_EVENT na het versturen van de wachtrij. */
export type SyncedDetail = { sent: number; failed: number; dropped: number };

/**
 * Resultaat van de laatste verzendpoging: `stalled` = gestopt op netwerk- of sessieproblemen,
 * `dropped` = sets weggehaald omdat hun oefening niet meer bestaat.
 */
export function getLastFlush() {
  return lastFlush;
}

/** Staat er nog iets klaar om te versturen (sets of berichten voor de groepsfeed)? */
export function hasPendingWork(): boolean {
  return readQueue().length > 0 || readActivities().length > 0 || readFinished().length > 0;
}

/** Zorgt dat het toegangstoken geldig is (na lang offline zijn is het vaak verlopen). Geeft de gebruiker terug. */
async function ensureSession(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) return null;
    const expiresAt = (session.expires_at ?? 0) * 1000;
    if (expiresAt && expiresAt < Date.now() + 60_000) {
      // Verversen kan bij haperende wifi blijven hangen: dan deze ronde overslaan.
      const refreshed = await within(supabase.auth.refreshSession(), WRITE_TIMEOUT_MS, null);
      return refreshed && !refreshed.error && refreshed.data.session ? refreshed.data.session.user.id : null;
    }
    return session.user.id;
  } catch {
    return null;
  }
}

/** `dropped`: weggehaald omdat de oefening niet meer bestaat (zie sendOne). */
type SendResult = "sent" | "failed" | "stalled" | "skipped" | "dropped";

/** Verstuurt de actuele wachtende bewerking voor één set (aanroepen binnen het slot van die set). */
async function sendOne(key: SetKey, uid: string): Promise<SendResult> {
  // Opnieuw lezen: de set kan intussen online zijn opgeslagen (weg uit de wachtrij) of opnieuw ingevuld.
  const op = readQueue().find((o) => sameSet(keyOf(o), key));
  if (!op || !isOwnOp(op, uid)) return "skipped";
  const signal = writeTimeout();
  const { error, status } =
    op.kind === "upsert"
      ? await supabase.from("set_logs").upsert(op.row, { onConflict: "workout_exercise_id,user_id,set_number" }).abortSignal(signal)
      : await supabase
          .from("set_logs")
          .delete()
          .eq("workout_exercise_id", op.key.workout_exercise_id)
          .eq("user_id", op.key.user_id)
          .eq("set_number", op.key.set_number)
          .abortSignal(signal);
  const err = error ? { ...error, status } : null;
  if (err && isRetryableError(err)) {
    // Verlopen sessie: alvast verversen, zodat de volgende poging wel lukt.
    if (isAuthError(err)) await within(supabase.auth.refreshSession(), WRITE_TIMEOUT_MS, null);
    return "stalled";
  }
  // De oefening is er niet meer (de trainer haalde hem uit het plan of verwijderde de training,
  // bijv. terwijl je offline was, of je hebt geen toegang meer tot de groep): deze set kan nergens
  // meer heen, dus niet als "niet opgeslagen" bewaren. Eerst nagaan: dezelfde fout krijg je ook
  // als je de oefening nog wel ziet maar er niet voor deze persoon mag schrijven; die blijft staan.
  const gone = !!err && op.kind === "upsert" && isGoneTargetError(err) && (await wexGone(op.row.workout_exercise_id));
  // Alleen deze bewerking weghalen: is de set intussen opnieuw ingevuld, dan blijft die nieuwere staan.
  const raw = JSON.stringify(op);
  writeQueue(readQueue().filter((o) => JSON.stringify(o) !== raw));
  if (gone) return "dropped";
  if (err) {
    markFailed(op, err);
    return "failed";
  }
  return "sent";
}

/**
 * Fout die kan betekenen dat de oefening van een set niet meer bestaat: de RLS-controle faalt dan
 * (de oefening hoort bij geen groep meer, 42501) of de verwijzing (23503).
 */
export function isGoneTargetError(e: { code?: string } | null | undefined): boolean {
  return e?.code === "42501" || e?.code === "23503";
}

/**
 * Welke van deze oefeningen (workout_exercise-ids) zijn er volgens de server niet meer voor deze
 * gebruiker (verwijderd, of niet meer te zien)? Alleen bij een duidelijk antwoord met een geldige
 * sessie; bij twijfel (geen sessie, fout, time-out) een lege set, zodat er dan niets verloren gaat.
 */
export async function goneWex(wexIds: Iterable<string>): Promise<Set<string>> {
  const ids = [...new Set(wexIds)];
  if (!ids.length) return new Set();
  try {
    // Zonder sessie ziet de server niets en zou alles "weg" lijken.
    if (!(await ensureSession())) return new Set();
    const { data, error } = await supabase.from("workout_exercises").select("id").in("id", ids).abortSignal(writeTimeout());
    if (error || !data) return new Set();
    const present = new Set(data.map((r) => (r as { id: string }).id));
    return new Set(ids.filter((x) => !present.has(x)));
  } catch {
    return new Set();
  }
}

async function wexGone(wexId: string): Promise<boolean> {
  return (await goneWex([wexId])).has(wexId);
}

/**
 * Als dropForWex, maar alleen voor oefeningen die volgens de server echt weg zijn (zie goneWex).
 * Vraagt de server alleen iets als er voor deze oefeningen iets wacht of mislukte.
 */
export async function dropGoneWex(wexIds: Iterable<string>): Promise<number> {
  const ids = new Set(wexIds);
  const hasOps = (op: QueuedOp) => ids.has(keyOf(op).workout_exercise_id);
  const affected = new Set<string>();
  for (const op of readQueue()) if (hasOps(op)) affected.add(keyOf(op).workout_exercise_id);
  for (const f of readFailed()) if (hasOps(f.op)) affected.add(keyOf(f.op).workout_exercise_id);
  if (!affected.size) return 0;
  return dropForWex(await goneWex(affected));
}

/**
 * Verstuurt de wachtrij. Stopt bij de eerste netwerk-, sessie- of serverfout (die bewerkingen
 * blijven staan); echte fouten gaan naar de lijst met mislukte sets. Bewerkingen van een ander
 * account op dit toestel blijven staan. Elke bewerking heeft een time-out en loopt via het slot
 * van zijn set, zodat een hangend verzoek de wachtrij niet blokkeert en een oude wachtende
 * versie nooit een nieuwere opslag overschrijft. Geeft het aantal verstuurde sets terug.
 */
export async function flushQueue(): Promise<number> {
  if (flushing || typeof navigator === "undefined" || !navigator.onLine) return 0;
  if (!hasPendingWork()) {
    lastFlush = { sent: 0, failed: 0, dropped: 0, stalled: false };
    return 0;
  }
  flushing = true;
  let sent = 0;
  let failed = 0;
  let dropped = 0;
  let stalled = false;
  let uid: string | null = null;
  try {
    uid = await ensureSession();
    if (!uid) {
      stalled = true;
      return 0;
    }
    const me = uid;
    const keys = readQueue()
      .filter((o) => isOwnOp(o, me))
      .map(keyOf);
    for (const key of keys) {
      const res = await withSetLock(lockKeyOf(key), () => sendOne(key, me)).catch((): SendResult => "stalled");
      if (res === "stalled") {
        stalled = true;
        break;
      }
      if (res === "sent") sent++;
      else if (res === "failed") failed++;
      else if (res === "dropped") dropped++;
    }
  } finally {
    flushing = false;
    lastFlush = { sent, failed, dropped, stalled };
  }
  if (sent || failed || dropped) {
    window.dispatchEvent(new CustomEvent<SyncedDetail>(SYNCED_EVENT, { detail: { sent, failed, dropped } }));
  }
  if (!stalled && uid) {
    await flushActivities(uid).catch(() => {});
    await flushFinished(uid).catch(() => {});
  }
  return sent;
}

/** Zet mislukte sets terug in de wachtrij en probeert ze opnieuw te versturen. */
export async function retryFailed(): Promise<number> {
  const failed = readFailed();
  if (!failed.length) return flushQueue();
  writeJson(FAILED_KEY, []);
  const q = readQueue();
  // Een nieuwere bewerking op dezelfde set gaat voor.
  const add = failed.map((f) => f.op).filter((op) => !q.some((o) => sameSet(keyOf(o), keyOf(op))));
  writeQueue([...add, ...q]);
  return flushQueue();
}

export function clearFailed() {
  writeJson(FAILED_KEY, []);
  // De pagina toont de echte stand weer (mislukte sets stonden alleen lokaal).
  window.dispatchEvent(new Event(SYNCED_EVENT));
}

// ─── React: live meekijken met de wachtrij ───

function snapshotOf<T>(key: string, empty: T[]) {
  let raw: string | null = null;
  let snap: T[] = empty;
  return (): T[] => {
    let next: string | null = null;
    try {
      next = localStorage.getItem(key);
    } catch {
      next = null;
    }
    if (next !== raw) {
      raw = next;
      snap = next ? readJson<T>(key) : empty;
    }
    return snap;
  };
}

const EMPTY: QueuedOp[] = [];
const EMPTY_FAILED: FailedOp[] = [];
const queueSnapshot = snapshotOf<QueuedOp>(STORAGE_KEY, EMPTY);
const failedSnapshot = snapshotOf<FailedOp>(FAILED_KEY, EMPTY_FAILED);

function subscribeQueue(fn: () => void) {
  window.addEventListener(QUEUE_EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(QUEUE_EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}

/** De wachtende bewerkingen (werkt automatisch bij als er iets bij komt of verstuurd is). */
export function useQueue(): QueuedOp[] {
  return useSyncExternalStore(subscribeQueue, queueSnapshot, () => EMPTY);
}

/** Sets die definitief niet konden worden opgeslagen (om ze op de set zelf te tonen). */
export function useFailed(): FailedOp[] {
  return useSyncExternalStore(subscribeQueue, failedSnapshot, () => EMPTY_FAILED);
}
