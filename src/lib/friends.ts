"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getCached, invalidate, setCached, useCached } from "./cache";
import { sessionsBySlug, type HistorySet } from "./history";
import { isWeighted, sessionRecords } from "./progress/records";
import { errorMessage, isMissingSchemaError, supabase } from "./supabase";
import { PUBLIC_PROFILE_COLUMNS, PUBLIC_PROFILE_COLUMNS_NO_PHOTO, type Profile } from "./types";

export type FriendProfile = Profile & { friend_code?: string | null };

/**
 * Kolommen van andermans profiel die de app mag ophalen. Nooit `*`: daar zitten ook voedingsdoelen
 * en (in oudere databases) de vriendcode in, en die blijven privé. Eén definitie in ./types;
 * hier opnieuw geëxporteerd zodat bestaande imports blijven werken.
 */
export { PUBLIC_PROFILE_COLUMNS } from "./types";

/** RPC bestaat (nog) niet: het upgrade-script is niet gedraaid. */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return ["PGRST202", "42883"].includes(error.code ?? "") || /could not find the function|does not exist/i.test(error.message ?? "");
}

export type FriendsState = {
  /** Geaccepteerde vrienden. */
  friends: FriendProfile[];
  /** Verzoeken die jij nog moet beantwoorden. */
  incoming: FriendProfile[];
  /** Verzoeken die jij hebt gestuurd. */
  outgoing: FriendProfile[];
};

type Row = {
  requester: string;
  addressee: string;
  status: "pending" | "accepted";
  req: FriendProfile | null;
  adr: FriendProfile | null;
};

/**
 * Haalt alle vriendschappen op. Gooit een fout als het verzoek mislukt, zodat de cache de laatste
 * goede stand houdt in plaats van een lege lijst op te slaan.
 */
export async function fetchFriends(userId: string): Promise<FriendsState> {
  const query = (cols: string) =>
    supabase
      .from("friendships")
      .select(`requester, addressee, status, req:profiles!friendships_requester_fkey(${cols}), adr:profiles!friendships_addressee_fkey(${cols})`)
      .order("created_at");
  let { data, error } = await query(PUBLIC_PROFILE_COLUMNS);
  // upgrade-avatars.sql nog niet gedraaid: zonder profielfoto opnieuw.
  if (error && isMissingSchemaError(error)) ({ data, error } = await query(PUBLIC_PROFILE_COLUMNS_NO_PHOTO));
  if (error) throw error;
  const out: FriendsState = { friends: [], incoming: [], outgoing: [] };
  for (const r of (data ?? []) as unknown as Row[]) {
    const mine = r.requester === userId;
    const other = mine ? r.adr : r.req;
    if (!other) continue;
    if (r.status === "accepted") out.friends.push(other);
    else (mine ? out.outgoing : out.incoming).push(other);
  }
  out.friends.sort((a, b) => a.display_name.localeCompare(b.display_name));
  return out;
}

// ─────────────── Laadstatus (bezig / mislukt) per gebruiker ───────────────

type LoadStatus = {
  loading: boolean;
  error: boolean;
  /**
   * In deze sessie minstens één keer van de server gehaald. Tot dan kan de bewaarde lijst verouderd
   * zijn (bijv. iemand voegde je net toe via je code), dus nog geen "geen vrienden" tonen.
   */
  verified: boolean;
};
const IDLE: LoadStatus = { loading: false, error: false, verified: false };
const status = new Map<string, LoadStatus>();
const statusListeners = new Set<() => void>();

function setStatus(userId: string, next: Partial<LoadStatus>) {
  status.set(userId, { ...(status.get(userId) ?? IDLE), ...next });
  statusListeners.forEach((fn) => fn());
}

function subscribeStatus(fn: () => void) {
  statusListeners.add(fn);
  return () => {
    statusListeners.delete(fn);
  };
}

const friendsKey = (userId: string) => `friends:${userId}`;

/** Telt wijzigingen; een ophaalactie die tijdens een wijziging liep, haalt daarna opnieuw op. */
let changeGen = 0;

/** fetchFriends met bijgehouden laadstatus. */
async function loadFriends(userId: string): Promise<FriendsState> {
  setStatus(userId, { loading: true });
  const gen = changeGen;
  try {
    let data = await fetchFriends(userId);
    // Tussendoor iets gewijzigd (bijv. vriend toegevoegd)? Dan is dit resultaat al verouderd.
    if (gen !== changeGen) data = await fetchFriends(userId);
    setStatus(userId, { loading: false, error: false, verified: true });
    return data;
  } catch (err) {
    setStatus(userId, { loading: false, error: true });
    throw err;
  }
}

export function useFriends(userId: string | null): FriendsState | undefined {
  return useCached(userId ? friendsKey(userId) : null, () => loadFriends(userId!), { persist: true, maxAge: 15_000 });
}

/** Of de vriendenlijst nu ververst wordt en of de laatste poging mislukte. */
export function useFriendsStatus(userId: string | null): LoadStatus {
  return useSyncExternalStore(
    subscribeStatus,
    () => (userId ? (status.get(userId) ?? IDLE) : IDLE),
    () => IDLE,
  );
}

/** Vriendenlijst direct opnieuw ophalen en in de cache zetten. */
export async function refreshFriends(userId?: string): Promise<FriendsState | undefined> {
  const uid = userId ?? (await currentUserId());
  if (!uid) return undefined;
  const data = await loadFriends(uid);
  setCached(friendsKey(uid), data, true);
  return data;
}

// ─────────────── Live bijwerken ───────────────

/** Eén gedeeld realtime-kanaal per gebruiker, ook als meerdere schermen het tegelijk gebruiken. */
const live = new Map<string, { count: number; stop: () => void }>();
let liveSeq = 0;

function startLive(userId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Meerdere events kort na elkaar (bijv. verwijderen + toevoegen bij een code) tot één ophaalactie bundelen.
  const refresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      changeGen++;
      refreshFriends(userId).catch(() => invalidate(friendsKey(userId)));
    }, 250);
  };
  // Niet naar friendships zelf luisteren: verwijderingen daarvan kunnen niet gefilterd worden en
  // zouden iedereens (ont)vriendingen naar elke gebruiker sturen. upgrade-social.sql houdt per
  // gebruiker een eigen "ping"-rij bij (alleen zelf leesbaar) die bij elke wijziging aan jouw
  // vriendschappen wordt toegevoegd of bijgewerkt, ook bij verwijderen.
  // Zonder de upgrade-SQL (tabel bestaat niet) komen er gewoon geen events; dan blijft verversen
  // bij terugkeren naar de app en na 15 s werken.
  const table = { schema: "public", table: "friendship_pings", filter: `user_id=eq.${userId}` } as const;
  const channel = supabase
    .channel(`friendships-${userId}-${++liveSeq}`)
    .on("postgres_changes", { ...table, event: "INSERT" }, refresh)
    .on("postgres_changes", { ...table, event: "UPDATE" }, refresh)
    .subscribe();
  const onVisible = () => {
    if (document.visibilityState === "visible") refreshFriends(userId).catch(() => {});
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    supabase.removeChannel(channel);
  };
}

/**
 * Houdt de vriendenlijst live bij: nieuwe verzoeken, geaccepteerde verzoeken en vrienden die je via
 * je code toevoegen verschijnen meteen. Ververst ook als de app weer in beeld komt, en haalt de lijst
 * één keer vers op als de bewaarde stand nog niet in deze sessie gecontroleerd is.
 */
export function useFriendsRealtime(userId: string | null) {
  useEffect(() => {
    if (!userId) return;
    const entry = live.get(userId);
    if (entry) entry.count++;
    else live.set(userId, { count: 1, stop: startLive(userId) });

    // Bewaarde lijst die nog "vers" lijkt (dus niet automatisch ververst wordt): toch één keer controleren.
    const check = setTimeout(() => {
      const s = status.get(userId);
      if (!s?.verified && !s?.loading) refreshFriends(userId).catch(() => {});
    }, 300);

    return () => {
      clearTimeout(check);
      const e = live.get(userId);
      if (!e) return;
      e.count--;
      if (e.count <= 0) {
        e.stop();
        live.delete(userId);
      }
    };
  }, [userId]);
}

/** Na een wijziging: cache meteen bijwerken, zodat de volgende pagina geen oude stand toont. */
async function syncAfterChange() {
  changeGen++;
  try {
    await refreshFriends();
  } catch {
    // Netwerkfout: dan in elk geval als verouderd markeren zodat het later opnieuw geprobeerd wordt.
    invalidate("friends:");
  }
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Optimistisch de lokale stand aanpassen (bijv. direct iemand weghalen). */
async function patchFriends(fn: (s: FriendsState) => FriendsState) {
  changeGen++;
  const uid = await currentUserId();
  if (!uid) return;
  const current = getCached<FriendsState>(friendsKey(uid));
  if (current) setCached(friendsKey(uid), fn(current), true);
}

export type RequestResult = "requested" | "accepted" | "already" | "self";

/**
 * Pushmelding naar de ander ("wil je vriend worden" / "heeft je verzoek geaccepteerd"). Wacht er
 * niet op en faalt stil: de vriendschap zelf is dan al geregeld.
 */
function notifyFriend(target: string, event: "request" | "accepted") {
  if (typeof window === "undefined") return;
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      await fetch("/api/friends/notify", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ target, event }),
        keepalive: true,
      });
    } catch {
      // Geen melding is geen probleem.
    }
  })();
}

export async function requestFriend(target: string): Promise<RequestResult> {
  const { data, error } = await supabase.rpc("request_friend", { target });
  if (error) throw error;
  const res = data as RequestResult;
  if (res === "requested") notifyFriend(target, "request");
  if (res === "accepted") notifyFriend(target, "accepted");
  await syncAfterChange();
  return res;
}

/**
 * Vriend worden met iemands code. Geef `targetId` mee als je al weet wie het is (uitnodigingspagina);
 * anders wordt de nieuwe vriend afgeleid uit de verversde lijst (voor de melding aan hem).
 */
export async function requestFriendByCode(code: string, targetId?: string): Promise<RequestResult> {
  const uid = await currentUserId();
  const known = uid ? getCached<FriendsState>(friendsKey(uid)) : undefined;
  const before = new Set(known?.friends.map((p) => p.id) ?? []);
  const { data, error } = await supabase.rpc("request_friend_by_code", { code });
  if (error) throw error;
  const res = data as RequestResult;
  changeGen++;
  let after: FriendsState | undefined;
  try {
    after = uid ? await refreshFriends(uid) : undefined;
  } catch {
    invalidate("friends:");
  }
  if (res === "accepted") {
    // Zonder eerdere lijst valt niet te zeggen wie er nieuw is: dan geen melding.
    const target = targetId ?? (known && after ? after.friends.find((p) => !before.has(p.id))?.id : undefined);
    if (target) notifyFriend(target, "accepted");
  }
  return res;
}

/** Het verzoek bestond niet meer (ingetrokken, of al beantwoord op een ander apparaat). */
export class RequestGoneError extends Error {
  constructor() {
    super("Dit verzoek is intussen ingetrokken.");
    this.name = "RequestGoneError";
  }
}

export async function respondFriend(requesterId: string, accept: boolean) {
  const { data, error } = await supabase.rpc("respond_friend", { requester_id: requesterId, accept });
  if (error) throw error;
  // Een bijgewerkte database geeft terug of er iets veranderde; een oudere geeft niets (null).
  const gone = data === false;
  await patchFriends((s) => {
    const person = s.incoming.find((p) => p.id === requesterId);
    const friends =
      accept && person && !gone ? [...s.friends, person].sort((a, b) => a.display_name.localeCompare(b.display_name)) : s.friends;
    return { ...s, friends, incoming: s.incoming.filter((p) => p.id !== requesterId) };
  });
  await syncAfterChange();
  if (gone) throw new RequestGoneError();
  if (accept) notifyFriend(requesterId, "accepted");
}

/** Vriendschap verbreken, of een (verstuurd of ontvangen) verzoek intrekken. */
export async function removeFriend(other: string) {
  const { error } = await supabase.rpc("remove_friend", { other });
  if (error) throw error;
  await patchFriends((s) => ({
    friends: s.friends.filter((p) => p.id !== other),
    incoming: s.incoming.filter((p) => p.id !== other),
    outgoing: s.outgoing.filter((p) => p.id !== other),
  }));
  await syncAfterChange();
}

// ─────────────── Melding na wegnavigeren (bijv. na "verwijderen als vriend") ───────────────

let pendingFlash: { text: string; at: number } | null = null;

/** Melding die de vriendenpagina toont zodra je daar terechtkomt. */
export function setFriendsFlash(text: string) {
  pendingFlash = { text, at: Date.now() };
}

/** Lezen zonder te wissen (veilig in een useState-initializer); wissen met clearFriendsFlash. */
export function peekFriendsFlash(): string | null {
  return pendingFlash && Date.now() - pendingFlash.at < 5000 ? pendingFlash.text : null;
}

export function clearFriendsFlash() {
  pendingFlash = null;
}

// ─────────────── Eigen vriendcode ───────────────

type MyCode = { code: string | null; legacy: boolean };
const codeKey = (userId: string) => `friend-code:${userId}`;

async function fetchMyCode(): Promise<MyCode> {
  const { data, error } = await supabase.rpc("my_friend_code");
  if (error) {
    // Database nog zonder privé codes: dan staat de code nog in het eigen profiel.
    if (isMissingFunction(error)) return { code: null, legacy: true };
    throw error;
  }
  return { code: typeof data === "string" ? data : null, legacy: false };
}

/**
 * Je eigen vriendcode. Komt uit een eigen, afgeschermde tabel; op een database zonder het
 * upgrade-script valt hij terug op de code in je profiel (`profileCode`).
 */
export function useMyFriendCode(userId: string | null, profileCode?: string | null): string | undefined {
  const r = useCached(userId ? codeKey(userId) : null, fetchMyCode, { persist: true, maxAge: 5 * 60_000 });
  if (!r) return undefined;
  return (r.legacy ? profileCode : r.code) ?? undefined;
}

export function friendLink(code: string) {
  return `${typeof window !== "undefined" ? window.location.origin : ""}/friend/${code}`;
}

/**
 * Haalt een vriendcode uit een code of geplakte link (ook met / of ?query erachter). Spaties tellen
 * niet mee ("3f9a 0c1d"), maar een code van 9 tekens wordt niet stilletjes ingekort.
 */
export function parseFriendCode(input: string): string | null {
  const m = input.replace(/\s+/g, "").match(/(?:^|\/)([a-f0-9]{8})\/?(?:[?#].*)?$/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Nieuwe vriendcode maken. De oude code, link en QR-code werken daarna niet meer; bestaande
 * vriendschappen blijven. Geeft de nieuwe code terug.
 */
export async function regenerateFriendCode(userId: string): Promise<string> {
  const { data, error } = await supabase.rpc("regenerate_friend_code");
  if (!error && typeof data === "string") {
    setCached(codeKey(userId), { code: data, legacy: false } satisfies MyCode, true);
    return data;
  }
  if (error && !isMissingFunction(error)) throw error;
  // Oudere database: de code staat nog in het profiel.
  for (let attempt = 0; attempt < 3; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const code = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data: rows, error: upError } = await supabase.from("profiles").update({ friend_code: code }).eq("id", userId).select("id");
    if (!upError) {
      if (!rows?.length) throw new Error("Je profiel kon niet worden bijgewerkt. Log opnieuw in en probeer het nog eens.");
      return code;
    }
    // Code bestaat toevallig al: nog een keer met een andere.
    if (upError.code !== "23505") throw upError;
  }
  throw new Error("Kon geen nieuwe code maken. Probeer het opnieuw.");
}

/** Foutmeldingen rond vriendschappen in gewone taal. */
export function friendErrorMessage(err: unknown): string {
  const raw = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err ?? "");
  if (/onbekende vriendcode/i.test(raw)) return "Deze code bestaat niet (meer). Controleer hem of vraag om een nieuwe link.";
  if (/gebruiker niet gevonden/i.test(raw)) return "Dit account bestaat niet meer.";
  if (err instanceof RequestGoneError) return "Dit verzoek is intussen ingetrokken.";
  if (/niet ingelogd/i.test(raw)) return "Je bent niet meer ingelogd. Log opnieuw in.";
  return errorMessage(err);
}

/** Tekst kopiëren; geeft false als het klembord niet beschikbaar is (bijv. geen https). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // val terug op de oude methode
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return ok;
  } catch {
    return false;
  }
}

export const APP_NAME = "Spotter";

/** Deelt je vriendlink via het deelmenu, of kopieert hem. */
export async function shareFriendLink(code: string): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const url = friendLink(code);
  const text = `Voeg me toe als vriend in ${APP_NAME}, dan zien we elkaars trainingen en ranks.`;
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title: APP_NAME, text, url });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // Delen mislukt (bijv. niet toegestaan): dan kopiëren.
    }
  }
  return (await copyText(url)) ? "copied" : "failed";
}

export const REQUEST_MESSAGES: Record<RequestResult, string> = {
  requested: "Verzoek verstuurd",
  accepted: "Jullie zijn nu vrienden",
  already: "Jullie zijn al vrienden",
  self: "Dit is je eigen code",
};

// ─────────────── Records en recente trainingen (afgeleid uit de geschiedenis) ───────────────

export type PersonalRecord = {
  slug: string;
  date: string;
  workoutId: string;
  /**
   * "e1rm": hogere geschatte 1RM (zonder gewicht: meer reps of seconden). "rep": zwaarder dan ooit
   * voor minstens `reps` herhalingen (rep-record), zonder dat de geschatte 1RM steeg.
   */
  kind: "e1rm" | "rep";
  /** Bij een rep-record: het herhalingsaantal (bijv. 8 voor een 8RM-record). */
  reps?: number;
  /** Bij een rep-record van een lichaamsgewicht-oefening: `value` en `previous` zijn extra gewicht. */
  added?: boolean;
  unit: "kg" | "reps";
  /** Geschatte 1RM (kg), gewicht van het rep-record (kg) of aantal reps. */
  value: number;
  /** Vorige beste waarde. */
  previous: number;
  /** De set waarmee het record gezet is. */
  set: HistorySet;
};

/**
 * Persoonlijke records: sessies waarin iemand zijn eerdere beste prestatie op een oefening verbeterde.
 * Zelfde regels als de eigen voortgangspagina (sessionRecords): een hogere geschatte 1RM (zonder
 * gewicht: meer reps of seconden), of anders een rep-record. De eerste keer telt niet als record.
 * Nieuwste eerst.
 */
export function personalRecords(history: HistorySet[]): PersonalRecord[] {
  const out: PersonalRecord[] = [];
  for (const [slug, sessions] of sessionsBySlug(history.filter((s) => (s.reps ?? 0) > 0))) {
    const weighted = isWeighted(sessions);
    sessionRecords(slug, sessions, weighted).forEach((r, i) => {
      if (!r) return;
      const base = { slug, date: sessions[i].date, workoutId: sessions[i].workoutId, previous: r.previous, set: r.set };
      if (r.kind === "e1rm") out.push({ ...base, kind: "e1rm", unit: weighted ? "kg" : "reps", value: r.value });
      else out.push({ ...base, kind: "rep", reps: r.reps, added: r.added, unit: "kg", value: r.weight });
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export type RecentWorkout = {
  workoutId: string;
  date: string;
  title: string;
  groupName: string | null;
  sets: number;
  /** Per oefening (in volgorde van het schema) de beste set. */
  exercises: { slug: string; workoutExerciseId: string; sets: HistorySet[]; top: HistorySet }[];
};

/** De laatste `limit` trainingen van iemand, nieuwste eerst. */
export function recentWorkouts(history: HistorySet[], limit = 5): RecentWorkout[] {
  const byWorkout = new Map<string, HistorySet[]>();
  for (const s of history) {
    if ((s.reps ?? 0) <= 0) continue;
    byWorkout.set(s.workoutId, [...(byWorkout.get(s.workoutId) ?? []), s]);
  }
  const list = [...byWorkout.values()].sort((a, b) => b[0].date.localeCompare(a[0].date)).slice(0, limit);
  return list.map((sets) => {
    const byEx = new Map<string, HistorySet[]>();
    for (const s of sets) byEx.set(s.workoutExerciseId, [...(byEx.get(s.workoutExerciseId) ?? []), s]);
    const exercises = [...byEx.values()]
      .sort((a, b) => a[0].position - b[0].position)
      .map((ex) => {
        const sorted = [...ex].sort((a, b) => a.setNumber - b.setNumber);
        const top = sorted.reduce((a, b) => {
          const wa = a.weight ?? 0;
          const wb = b.weight ?? 0;
          return wb > wa || (wb === wa && (b.reps ?? 0) > (a.reps ?? 0)) ? b : a;
        });
        return { slug: sorted[0].slug, workoutExerciseId: sorted[0].workoutExerciseId, sets: sorted, top };
      });
    return {
      workoutId: sets[0].workoutId,
      date: sets[0].date,
      title: sets[0].workoutTitle,
      groupName: sets[0].groupName,
      sets: sets.length,
      exercises,
    };
  });
}

/** Aantal dagen tussen een datum (YYYY-MM-DD) en vandaag. */
export function daysAgo(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const then = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((today - then) / 86_400_000);
}
