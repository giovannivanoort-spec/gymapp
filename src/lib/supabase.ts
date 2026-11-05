import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BASE_PROFILE_COLUMNS, PUBLIC_PROFILE_COLUMNS, type OwnProfile, type Profile, type PublicProfile } from "./types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && key);

// ─────────── Offline kopieën van de service worker herkennen ───────────

/**
 * De service worker geeft zonder netwerk een bewaarde kopie van Supabase-data terug en zet daar
 * de header `x-sw-cache: hit` bij. Zo'n antwoord lijkt voor supabase-js een gewone 200, maar is
 * oud: de cache-laag (cache.ts) mag het niet als vers opslaan. Daarom tellen we zulke antwoorden,
 * per ophaalactie (trackStaleResponses) en voor de hele app (staleResponseCount).
 */
let staleHits = 0;
let staleCachedAt = 0;

/** Aantal antwoorden dat sinds het opstarten uit de offline kopie van de service worker kwam. */
export function staleResponseCount(): number {
  return staleHits;
}

/** Tijdstip (ms) waarop de laatst getoonde offline kopie oorspronkelijk is opgehaald, 0 als onbekend. */
export function lastStaleCachedAt(): number {
  return staleCachedAt;
}

/**
 * Eén ophaalactie (een fetcher van de cache). Verzoeken die de fetcher meteen bij het starten
 * opbouwt, worden er exact aan gekoppeld (via hun AbortSignal). Verzoeken van na een `await`
 * kunnen we niet koppelen; die tellen alleen mee voor acties die al een eigen antwoord binnen
 * hebben of geen gekoppeld verzoek hebben (dus mogelijk al verder zijn), niet voor een actie die
 * nog op zijn eigen verzoek wacht. Zo maakt een offline kopie van het ene verzoek de verse data
 * van een ander, gelijktijdig verzoek niet "oud".
 */
type StaleTracker = { builders: number; completed: number; hits: number; cachedAt: number };
let currentTracker: StaleTracker | null = null;
const activeTrackers = new Set<StaleTracker>();
const signalOwner = new WeakMap<AbortSignal, StaleTracker>();

/**
 * Voert `fn` uit en houdt bij of een van zijn antwoorden uit de offline kopie van de service
 * worker kwam. `cachedAt`: wanneer die kopie oorspronkelijk is opgehaald (ms), 0 als onbekend.
 */
export function trackStaleResponses<T>(fn: () => Promise<T>): Promise<{ data: T; stale: boolean; cachedAt: number }> {
  const t: StaleTracker = { builders: 0, completed: 0, hits: 0, cachedAt: 0 };
  activeTrackers.add(t);
  const prev = currentTracker;
  currentTracker = t;
  let p: Promise<T>;
  try {
    p = fn();
  } catch (err) {
    p = Promise.reject(err);
  } finally {
    currentTracker = prev;
  }
  return p
    .finally(() => activeTrackers.delete(t))
    .then((data) => ({ data, stale: t.hits > 0, cachedAt: t.cachedAt }));
}

/** Koppelt een query die nu (synchroon in een fetcher) wordt opgebouwd aan die ophaalactie. */
function tagBuilder<B>(builder: B): B {
  const t = currentTracker;
  const b = builder as unknown as { fetch?: unknown };
  if (!t || !b || typeof b.fetch !== "function") return builder;
  const inner = b.fetch as typeof fetch;
  t.builders++;
  b.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? new AbortController().signal;
    if (!signalOwner.has(signal)) signalOwner.set(signal, t);
    return inner(input, { ...init, signal });
  }) as typeof fetch;
  return builder;
}

/** Data kwam uit de offline kopie van de service worker (geen verbinding). */
export class StaleDataError extends Error {
  /** Wanneer die kopie oorspronkelijk is opgehaald (ms), 0 als onbekend. */
  cachedAt: number;
  constructor(cachedAt = 0) {
    super("Geen verbinding, offline kopie getoond.");
    this.name = "StaleDataError";
    this.cachedAt = cachedAt;
  }
}

/** Een leesverzoek dat langer duurt, geldt als "geen verbinding" (de vorige data blijft staan). */
const READ_TIMEOUT_MS = 20_000;

function requestInfo(input: RequestInfo | URL, init?: RequestInit): { url: string; method: string } {
  if (typeof input === "string") return { url: input, method: (init?.method ?? "GET").toUpperCase() };
  if (input instanceof URL) return { url: input.href, method: (init?.method ?? "GET").toUpperCase() };
  return { url: input.url, method: (init?.method ?? input.method ?? "GET").toUpperCase() };
}

/** Combineert het signaal van de aanroeper met een time-out (zonder AbortSignal.any als dat ontbreekt). */
function withReadTimeout(init: RequestInit | undefined): { init: RequestInit; done: () => void } {
  const controller = new AbortController();
  const outer = init?.signal;
  const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), READ_TIMEOUT_MS);
  const onAbort = () => controller.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener("abort", onAbort, { once: true });
  }
  return {
    init: { ...init, signal: controller.signal },
    done: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * fetch voor supabase-js: leesverzoeken naar de database krijgen een time-out (zwak bereik in de
 * sportschool mag een scherm niet eindeloos laten laden) en offline kopieën van de service worker
 * worden geteld. Schrijfacties, inloggen, opslag en realtime gaan ongewijzigd door.
 */
const trackedFetch: typeof fetch = async (input, init) => {
  const { url: reqUrl, method } = requestInfo(input, init);
  const isRead = method === "GET" && reqUrl.includes("/rest/v1/");
  if (!isRead || typeof window === "undefined") return fetch(input, init);
  // Bij welke ophaalactie(s) hoort dit verzoek? Zie StaleTracker.
  const owner = init?.signal ? signalOwner.get(init.signal) : undefined;
  const owners = owner ? [owner] : [...activeTrackers].filter((a) => a.completed > 0 || a.builders === 0);
  const t = withReadTimeout(init);
  try {
    const res = await fetch(input, t.init);
    if (res.headers.get("x-sw-cache") === "hit") {
      const cachedAt = Number(res.headers.get("x-sw-cached-at")) || 0;
      staleHits++;
      staleCachedAt = cachedAt;
      for (const o of owners) {
        o.hits++;
        o.cachedAt = cachedAt;
      }
    }
    return res;
  } finally {
    t.done();
    if (owner) owner.completed++;
  }
};

// Placeholder zodat de app kan builden zonder .env.local; de UI toont dan een setup-scherm.
export const supabase: SupabaseClient = createClient(url || "https://placeholder.supabase.co", key || "placeholder-key", {
  global: { fetch: trackedFetch },
});

// Queries die een fetcher van de cache opbouwt, koppelen aan die ophaalactie (zie trackStaleResponses).
{
  const client = supabase as unknown as { from: (...args: unknown[]) => unknown; rpc: (...args: unknown[]) => unknown };
  const from = client.from.bind(supabase);
  const rpc = client.rpc.bind(supabase);
  client.from = (...args: unknown[]) => tagBuilder(from(...args));
  client.rpc = (...args: unknown[]) => tagBuilder(rpc(...args));
}

// ─────────── Profielen (voeding blijft privé) ───────────

/** Kolom, tabel of functie ontbreekt in de database (een SQL-script is nog niet gedraaid). */
export function isMissingSchemaError(err: unknown): boolean {
  const { msg, code } = parts(err);
  return ["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(code) || /does not exist|schema cache/i.test(msg);
}

/**
 * Andermans profiel, alleen met de kolommen die vrienden mogen zien (zonder voedingsdoelen).
 * `null` als het profiel niet bestaat of niet zichtbaar is; gooit bij een fout. Ontbreekt een
 * optionele kolom nog in de database, dan komen alleen naam en id terug (de rest is null).
 */
export async function fetchPublicProfile(id: string): Promise<PublicProfile | null> {
  const full = await supabase.from("profiles").select(PUBLIC_PROFILE_COLUMNS).eq("id", id).maybeSingle();
  if (!full.error) return (full.data as PublicProfile | null) ?? null;
  if (!isMissingSchemaError(full.error)) throw full.error;
  const base = await supabase.from("profiles").select(BASE_PROFILE_COLUMNS).eq("id", id).maybeSingle();
  if (base.error) throw base.error;
  if (!base.data) return null;
  return { bodyweight_kg: null, sex: null, height_cm: null, birth_date: null, weekly_goal: null, ...(base.data as Pick<Profile, "id" | "display_name">) };
}

/**
 * Je eigen volledige profiel (met voedingsdoelen). Via de functie get_my_profile (zie
 * supabase/upgrade-platform.sql), zodat dit ook werkt als andermans voedingskolommen zijn
 * afgeschermd; zonder die functie gewoon via de tabel. `null` als er (nog) geen profiel is.
 */
export async function fetchOwnProfile(userId: string): Promise<OwnProfile | null> {
  const rpc = await supabase.rpc("get_my_profile");
  if (!rpc.error) {
    const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as OwnProfile | null | undefined;
    if (row && row.id === userId) return row;
    if (!row) return null;
  } else if (!isMissingSchemaError(rpc.error)) {
    throw rpc.error;
  }
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data as OwnProfile | null) ?? null;
}

type ErrorLike = { message?: unknown; code?: unknown; status?: unknown; statusCode?: unknown; name?: unknown };

function parts(err: unknown): { msg: string; code: string; status: number } {
  if (typeof err === "string") return { msg: err, code: "", status: 0 };
  if (!err || typeof err !== "object") return { msg: "", code: "", status: 0 };
  const e = err as ErrorLike;
  return {
    msg: typeof e.message === "string" ? e.message : "",
    code: typeof e.code === "string" ? e.code : "",
    status: Number(e.status ?? e.statusCode) || 0,
  };
}

const NETWORK_RE = /failed to fetch|networkerror|network error|load failed|network request failed|fetch failed|err_internet|the internet connection appears to be offline|timed? ?out|aborterror|the operation was aborted/i;
const AUTH_RE = /jwt expired|invalid jwt|jwt.*(malformed|invalid)|refresh token|auth session missing|session.*(expired|missing|not found)|not authenticated/i;

/** Geen verbinding (offline, time-out, wegvallend netwerk) in plaats van een echte fout van de database. */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (err instanceof StaleDataError) return true;
  if (err && typeof err === "object" && ((err as ErrorLike).name === "TimeoutError" || (err as ErrorLike).name === "AbortError")) return true;
  const { msg, code } = parts(err);
  return NETWORK_RE.test(msg) || NETWORK_RE.test(code);
}

/** Sessie verlopen of ontbreekt: na opnieuw inloggen / token verversen kan het wel lukken. */
export function isAuthError(err: unknown): boolean {
  const { msg, code, status } = parts(err);
  return code === "PGRST301" || code === "PGRST302" || status === 401 || AUTH_RE.test(msg);
}

/**
 * Is het zinvol om dit later opnieuw te proberen? Ja bij netwerk-, sessie- en serverfouten;
 * nee bij echte fouten in de data (bijv. een ongeldige waarde of ontbrekende rechten).
 */
export function isRetryableError(err: unknown): boolean {
  if (isNetworkError(err) || isAuthError(err)) return true;
  const { status, code } = parts(err);
  return status === 408 || status === 429 || status >= 500 || code === "57014";
}

/** Zet een fout om in een korte Nederlandse melding voor in de app. */
export function errorMessage(err: unknown): string {
  const { msg, code, status } = parts(err);

  if (isNetworkError(err)) return "Geen verbinding. Controleer je internet en probeer het opnieuw.";
  if (isAuthError(err)) return "Je sessie is verlopen. Log opnieuw in.";

  // Inloggen en registreren
  if (/invalid login credentials/i.test(msg)) return "E-mailadres of wachtwoord klopt niet.";
  if (/email not confirmed/i.test(msg)) return "Bevestig eerst je e-mailadres via de link in je mail.";
  if (/user already registered|already been registered/i.test(msg)) return "Er bestaat al een account met dit e-mailadres.";
  if (/password should be at least/i.test(msg)) return "Je wachtwoord is te kort (minimaal 6 tekens).";
  if (/unable to validate email|invalid email/i.test(msg)) return "Dit e-mailadres lijkt niet te kloppen.";

  // Database (Postgres / PostgREST)
  if (code === "42501" || /row-level security|permission denied/i.test(msg)) return "Je hebt hier geen toegang toe.";
  if (code === "23505" || /duplicate key/i.test(msg)) return "Dit bestaat al.";
  if (code === "23503") return "Dit hoort bij iets dat niet meer bestaat. Ververs de pagina en probeer het opnieuw.";
  if (code === "23502" || code === "23514" || code === "22P02" || code === "22003") return "Een van de ingevulde waarden is niet geldig.";
  if (code === "PGRST116") return "Niet gevonden. Misschien is het verwijderd.";
  if (code === "42P01" || code === "42703" || code === "42883" || code === "PGRST202" || code === "PGRST204" || code === "PGRST205")
    return "Deze functie is nog niet ingesteld in de database.";
  if (code === "57014") return "Dit duurde te lang. Probeer het opnieuw.";
  if (status === 429 || /rate limit|too many requests/i.test(msg)) return "Even te veel verzoeken. Probeer het zo opnieuw.";
  if (status >= 500) return "De server reageert niet goed. Probeer het later opnieuw.";

  // Eigen (al Nederlandse) meldingen uit de app gaan ongewijzigd door.
  if (msg) return msg;
  return "Er ging iets mis.";
}
