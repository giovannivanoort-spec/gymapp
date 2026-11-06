import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { COACH_SYSTEM, coachContext, type ContextGroup } from "@/lib/coach/prompt";
import { artifactFrom, asksDeleteConfirmation, fetchMyProfile, proposalFrom, STOP_MARK, type Artifact } from "@/lib/coach/shared";
import { runTool, TOOL_DEFINITIONS, toolLabel } from "@/lib/coach/tools";

// Een antwoord met meerdere tool-rondes kan even duren.
export const maxDuration = 300;

const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 12;
/** Hoe vaak een ronde opnieuw mag na onleesbare tool-invoer (telt niet mee als tool-ronde). */
const MAX_JSON_RETRIES = 2;
/** Maximaal aantal vragen per persoon per dag, zodat je API-tegoed niet ongemerkt opgaat. */
const DAILY_LIMIT = Number(process.env.COACH_DAILY_LIMIT ?? 40);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Zo lang mag een onderbroken antwoord gratis worden afgemaakt (daarna telt het als nieuwe vraag). */
const FREE_CONTINUE_MS = 15 * 60 * 1000;
/** Zo vaak mag één vraag gratis worden afgemaakt (met upgrade-coach.sql); daarna telt afmaken als vraag. */
const MAX_FREE_CONTINUES = 2;
/** Meer berichten na één vraag dan dit kan niet uit één (of een paar afgemaakte) antwoorden komen. */
const MAX_TAIL = 2 * MAX_TOOL_ROUNDS + 6;

/**
 * Sleutel waarmee de server zijn eigen vragen ondertekent. Zo kan "afmaken" (gratis) alleen voor een
 * vraag die de server zelf heeft opgeslagen en geteld, en niet voor een zelf ingevoegd bericht.
 */
const SIGN_KEY = `spotter-coach:${process.env.COACH_SECRET ?? process.env.SUPABASE_SECRET_KEY ?? process.env.ANTHROPIC_API_KEY ?? ""}`;

type Block = Anthropic.Beta.BetaContentBlock;
type Param = Anthropic.Beta.BetaMessageParam;
/** Regels in de NDJSON-stream naar de chat. */
type Event =
  | { t: "conversation"; id: string }
  | { t: "quota"; used: number; limit: number }
  /** Er begint een nieuwe model-ronde (na tool-resultaten). */
  | { t: "round" }
  /** De huidige ronde wordt opnieuw gedaan: tekst en lopende tools van deze ronde weggooien. */
  | { t: "reset_round" }
  /** De ronde is opgeslagen: tekst tot hier blijft ook na een fout of herstart bewaard. */
  | { t: "commit" }
  | { t: "text"; d: string }
  /** Korte voortgangsnotitie van de coach tussen tool-aanroepen. */
  | { t: "status"; d: string }
  | { t: "tool"; id: string; name: string; label: string }
  | { t: "tool_done"; id: string; ok: boolean }
  | ({ t: "artifact" } & Artifact)
  | { t: "proposal"; data: unknown; id: string }
  /** delete_template vroeg om bevestiging: de chat biedt dan ja/nee aan. */
  | { t: "confirm"; id: string }
  /** Hartslag: zo ziet de chat het verschil tussen "denkt lang na" en "verbinding weg". */
  | { t: "ping" }
  | { t: "done" }
  | { t: "stopped" }
  | { t: "error"; message: string };

/** Fout met een tekst die zo aan de gebruiker getoond mag worden. */
class CoachError extends Error {}

// ───────── Lopende antwoorden ─────────

/**
 * Antwoorden die nog bezig zijn, per gesprek. Een antwoord loopt door als de verbinding wegvalt
 * (app naar de achtergrond, geen bereik in de sportschool); alleen een expliciete Stop breekt het af.
 * Op globalThis zodat het tijdens het ontwikkelen een hot reload overleeft.
 *
 * Met upgrade-coach.sql staat de bezetting ook in de database (coach_conversations.answer_run /
 * answer_until / answer_stop), zodat een verzoek dat op een andere serverinstantie binnenkomt
 * (Vercel) ziet dat er al een antwoord loopt en een Stop daar ook aankomt. Zonder die kolommen
 * valt dit terug op alleen dit geheugen.
 */
type Job = {
  stop: AbortController;
  finished: Promise<void>;
  /** Bezetting verlengen en kijken of er (op een andere instantie) op Stop is gedrukt. */
  beat: () => Promise<void>;
  /** De bezetting in de database is kwijt (verlopen en door een ander verzoek overgenomen). */
  lost: boolean;
};
const store = globalThis as typeof globalThis & { __coachJobs?: Map<string, Job> };
const jobs = (store.__coachJobs ??= new Map<string, Job>());

/** Zo lang geldt de bezetting in de database zonder hartslag (een gecrasht antwoord blokkeert niet lang). */
const LEASE_MS = 60_000;
const leaseEnd = () => new Date(Date.now() + LEASE_MS).toISOString();

const missingColumn = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "PGRST204" || error.code === "42703" || /answer_(run|until|stop)/.test(error.message ?? ""));

let warnedLock = false;
function warnLock() {
  if (warnedLock) return;
  warnedLock = true;
  console.warn("[coach] coach_conversations.answer_run ontbreekt: bezetting alleen per serverinstantie (draai supabase/upgrade-coach.sql).");
}

/**
 * Reserveert een gesprek voor één antwoord tegelijk. Geeft null als er al een antwoord loopt
 * (hier of op een andere instantie), of "error" als de database niet te bereiken is.
 * `release` geeft het gesprek weer vrij.
 */
async function claim(sb: SupabaseClient, conversationId: string) {
  if (jobs.has(conversationId)) return null;
  const runId = randomUUID();
  let db = false;
  let release = async () => {};
  const finished = new Promise<void>((resolve) => {
    release = async () => {
      if (jobs.get(conversationId) !== job) return resolve();
      jobs.delete(conversationId);
      if (db && !job.lost) {
        await sb
          .from("coach_conversations")
          .update({ answer_run: null, answer_until: null, answer_stop: false })
          .eq("id", conversationId)
          .eq("answer_run", runId)
          .then(
            () => {},
            () => {},
          );
      }
      resolve();
    };
  });
  const job: Job = {
    stop: new AbortController(),
    finished,
    lost: false,
    beat: async () => {
      if (!db || job.lost) return;
      const { data, error } = await sb
        .from("coach_conversations")
        .update({ answer_until: leaseEnd() })
        .eq("id", conversationId)
        .eq("answer_run", runId)
        .select("answer_stop");
      if (error) return; // even geen verbinding met de database: volgende keer opnieuw
      if (!data?.length) {
        job.lost = true;
        job.stop.abort();
      } else if ((data[0] as { answer_stop?: boolean }).answer_stop) {
        job.stop.abort();
      }
    },
  };
  // Eerst in het geheugen (synchroon), zodat twee verzoeken op deze instantie niet allebei doorgaan.
  jobs.set(conversationId, job);
  const { data, error } = await sb
    .from("coach_conversations")
    .update({ answer_run: runId, answer_until: leaseEnd(), answer_stop: false })
    .eq("id", conversationId)
    .or(`answer_until.is.null,answer_until.lt.${new Date().toISOString()}`)
    .select("id");
  if (error && missingColumn(error)) {
    warnLock();
  } else if (error) {
    jobs.delete(conversationId);
    return "error" as const;
  } else if (!data?.length) {
    jobs.delete(conversationId);
    return null;
  } else {
    db = true;
  }
  return { job, release };
}

type Lock = NonNullable<Exclude<Awaited<ReturnType<typeof claim>>, "error">>;

/** Loopt er (volgens de database) nog een antwoord in dit gesprek? */
const runningInDb = (row: Record<string, unknown> | null | undefined) =>
  typeof row?.answer_until === "string" && Date.parse(row.answer_until) > Date.now();

const busyResponse = () =>
  Response.json({ error: "De coach is nog bezig met het vorige antwoord.", busy: true }, { status: 409 });

// ───────── Inloggen en daglimiet ─────────

/** Supabase-client als de ingelogde gebruiker: alle databasetoegang loopt via RLS. */
async function authenticate(req: Request): Promise<{ sb: SupabaseClient; userId: string } | Response> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Niet ingelogd." }, { status: 401 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await sb.auth.getUser(token);
  if (!auth.user) return Response.json({ error: "Sessie verlopen, log opnieuw in." }, { status: 401 });
  return { sb, userId: auth.user.id };
}

/** Middernacht van vandaag in Nederlandse tijd (de daglimiet gaat om 00:00 in Amsterdam opnieuw in). */
function startOfDayAmsterdam(now = new Date()) {
  const day = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
  const wall = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
  const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(Date.parse(`${day}T00:00:00Z`) - (wall.getTime() - utc.getTime()));
}

let warnedLegacy = false;
function warnLegacy() {
  if (warnedLegacy) return;
  warnedLegacy = true;
  console.warn("[coach] coach_usage / coach_take_question ontbreekt: de daglimiet telt nu berichten (draai supabase/upgrade-coach.sql).");
}

/**
 * Oude telling (zonder upgrade-coach.sql): vragen in de eigen gesprekken van vandaag, plus hoe vaak
 * een vraag opnieuw is beantwoord (`spotter.r` op het eerste blok, zie countAgainLegacy).
 */
async function legacyCount(sb: SupabaseClient, since: string) {
  warnLegacy();
  const rows = await sb
    .from("coach_messages")
    .select("seq, again:content->0->spotter->r")
    .eq("kind", "text")
    .gte("created_at", since);
  if (!rows.error && Array.isArray(rows.data)) {
    return (rows.data as { again?: unknown }[]).reduce((n, r) => n + 1 + Math.max(0, Math.floor(Number(r.again) || 0)), 0);
  }
  const { count } = await sb
    .from("coach_messages")
    .select("seq", { count: "exact", head: true })
    .eq("kind", "text")
    .gte("created_at", since);
  return count ?? 0;
}

/** Hoeveel vragen er vandaag zijn gesteld. Gebruikt coach_usage (niet te wissen) als die tabel bestaat. */
async function questionsToday(sb: SupabaseClient) {
  const since = startOfDayAmsterdam().toISOString();
  const { count, error } = await sb.from("coach_usage").select("id", { count: "exact", head: true }).gte("created_at", since);
  if (!error && count != null) return count;
  return legacyCount(sb, since);
}

/**
 * Controleert de daglimiet en boekt de vraag. Met upgrade-coach.sql gebeurt dat atomair in de database
 * (twee gelijktijdige verzoeken kunnen niet allebei door de controle); anders valt dit terug op tellen.
 * `savedText`: de vraag staat al als bericht opgeslagen (telt in de oude telling dan al mee).
 */
async function takeQuestion(sb: SupabaseClient, savedText = false): Promise<{ ok: boolean; used: number; legacy: boolean }> {
  const since = startOfDayAmsterdam().toISOString();
  const { data, error } = await sb.rpc("coach_take_question", { p_since: since, p_limit: DAILY_LIMIT });
  if (!error && typeof data === "number") {
    return data < 0 ? { ok: false, used: DAILY_LIMIT, legacy: false } : { ok: true, used: data, legacy: false };
  }
  const before = Math.max(0, (await legacyCount(sb, since)) - (savedText ? 1 : 0));
  return before >= DAILY_LIMIT ? { ok: false, used: before, legacy: true } : { ok: true, used: before + 1, legacy: true };
}

/**
 * Oude telling: een nieuw antwoord op een bestaande vraag (opnieuw genereren, of afmaken dat als
 * vraag telt) voegt geen vraag-bericht toe. Daarom op de vraag zelf bijhouden hoe vaak dat gebeurde.
 */
async function countAgainLegacy(sb: SupabaseClient, row: Row) {
  const blocks = Array.isArray(row.content) ? [...(row.content as Record<string, unknown>[])] : [];
  const first = blocks[0];
  if (!first || typeof first !== "object") return;
  const spotter = (first.spotter && typeof first.spotter === "object" ? first.spotter : {}) as Record<string, unknown>;
  blocks[0] = { ...first, spotter: { ...spotter, r: Math.max(0, Math.floor(Number(spotter.r) || 0)) + 1 } };
  const { error } = await sb.from("coach_messages").update({ content: blocks }).eq("seq", row.seq);
  if (!error) row.content = blocks;
}

/**
 * Boekt één gratis keer afmaken voor deze (ondertekende) vraag. "missing": upgrade-coach.sql is
 * (nog) niet gedraaid of de database is niet bereikbaar; dan telt afmaken zoals een vraag.
 */
async function takeContinuation(sb: SupabaseClient, nonce: string): Promise<"ok" | "used" | "missing"> {
  const { data, error } = await sb.rpc("coach_take_continuation", { p_nonce: nonce, p_max: MAX_FREE_CONTINUES });
  if (!error && typeof data === "boolean") return data ? "ok" : "used";
  return "missing";
}

const limitReached = () =>
  Response.json(
    { error: `Je hebt vandaag al ${DAILY_LIMIT} vragen gesteld. Na middernacht kun je weer verder.` },
    { status: 429 },
  );

/** Bestaat dit gesprek en is het van de gebruiker (RLS)? */
async function ownConversation(sb: SupabaseClient, id: string | null | undefined) {
  if (!id || !UUID.test(id)) return { id: undefined, row: null, error: null };
  // "*": met upgrade-coach.sql zit daar ook de bezetting (answer_until) bij, zonder werkt het ook.
  const { data, error } = await sb.from("coach_conversations").select("*").eq("id", id).maybeSingle();
  const row = data as Record<string, unknown> | null;
  return { id: row ? (row.id as string) : undefined, row, error };
}

/**
 * Daglimiet voor de teller in de chat. Met ?conversation=<id> ook of daar nog een antwoord loopt
 * (de chat gebruikt dat na een verbroken verbinding om het antwoord af te wachten).
 */
export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const conv = new URL(req.url).searchParams.get("conversation");
  const [used, own] = await Promise.all([questionsToday(auth.sb), conv ? ownConversation(auth.sb, conv) : null]);
  return Response.json(
    { used, limit: DAILY_LIMIT, ...(own && { running: !!own.id && (jobs.has(own.id) || runningInDb(own.row)) }) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ───────── Ondertekende vragen ─────────

type Row = { seq: number; role: string; kind: string; content: unknown };
type StoredText = { type: string; text?: string; spotter?: { n?: string; t?: number; s?: string } };

const questionText = (blocks: StoredText[]) =>
  blocks
    .filter((b) => b.type === "text" && typeof b.text === "string" && !b.text.startsWith("<context>"))
    .map((b) => b.text)
    .join("\n");

function sign(conversationId: string, nonce: string, time: number, text: string) {
  return createHmac("sha256", SIGN_KEY).update(`${conversationId}\n${nonce}\n${time}\n${text}`).digest("base64url");
}

/**
 * Klopt de handtekening van deze (door de server opgeslagen) vraag, is hij recent en niet gekopieerd?
 * Geeft dan het nonce van de vraag terug (om het aantal keer gratis afmaken te tellen), anders null.
 */
function verifiedQuestion(conversationId: string, rows: Row[], index: number): string | null {
  const blocks = (Array.isArray(rows[index].content) ? rows[index].content : []) as StoredText[];
  const sig = blocks.find((b) => b.type === "text" && b.spotter)?.spotter;
  if (!sig?.n || typeof sig.t !== "number" || !sig.s) return null;
  if (Date.now() - sig.t > FREE_CONTINUE_MS || sig.t > Date.now() + 60_000) return null;
  const expected = Buffer.from(sign(conversationId, sig.n, sig.t, questionText(blocks)));
  const given = Buffer.from(sig.s);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const copied = rows.some(
    (r, i) =>
      i !== index &&
      r.kind === "text" &&
      Array.isArray(r.content) &&
      (r.content as StoredText[]).some((b) => b.spotter?.n === sig.n),
  );
  return copied ? null : sig.n;
}

const openToolUse = (row: Row | undefined) =>
  row?.kind === "assistant" && Array.isArray(row.content) && (row.content as Block[]).some((b) => b.type === "tool_use");

/** Zoals de server ze zelf wegschrijft: antwoorden van de coach en alleen tool-resultaten. */
function wellFormedTail(tail: Row[]) {
  return (
    tail.length <= MAX_TAIL &&
    tail.every((r) =>
      r.kind === "assistant"
        ? r.role === "assistant"
        : r.kind === "tool_results" &&
          r.role === "user" &&
          Array.isArray(r.content) &&
          (r.content as { type?: string }[]).every((b) => b.type === "tool_result"),
    )
  );
}

/**
 * Tools die gezondheidsgegevens teruggeven (AVG art. 9: stappen, kcal, slaap). Hun uitkomst gaat alleen
 * mee in het antwoord waarin de tool draait en wordt NIET in coach_messages bewaard: anders zou een oud
 * gesprek die gegevens bij elke volgende vraag opnieuw naar Anthropic sturen, ook nadat de gebruiker
 * "Gebruiken door de AI-coach" (of slaap voor de coach) heeft uitgezet of zijn toestemming heeft
 * ingetrokken, en zouden ze in het gesprek blijven staan nadat alles "direct verwijderd" is.
 * Rijen van vóór deze regel worden bij het terugsturen ook afgeschermd (toParams) en in de database
 * opgeschoond bij intrekken (supabase/upgrade-health-coach-redact.sql).
 */
const HEALTH_TOOLS = new Set(["get_activity", "get_sleep"]);
const HEALTH_REDACTED =
  "Gegevens niet bewaard: gezondheidsgegevens worden alleen gebruikt in het antwoord waarin ze zijn opgehaald. Roep de tool opnieuw aan als je ze weer nodig hebt.";

/** Tool-resultaten zoals ze worden opgeslagen: uitkomsten van gezondheidstools vervangen door een melding. */
function storableResults<T extends { tool_use_id: string; content: string; is_error?: boolean }>(
  results: T[],
  toolUses: { id: string; name: string }[],
): T[] {
  const health = new Set(toolUses.filter((tu) => HEALTH_TOOLS.has(tu.name)).map((tu) => tu.id));
  return results.map((r) => (health.has(r.tool_use_id) && !r.is_error ? { ...r, content: HEALTH_REDACTED } : r));
}

/** Opgeslagen berichten terug naar de vorm voor de API (zie toParam), met gezondheidsuitkomsten afgeschermd. */
function toParams(rows: Row[]): Param[] {
  const healthIds = new Set<string>();
  for (const r of rows) {
    if (r.kind !== "assistant" || !Array.isArray(r.content)) continue;
    for (const b of r.content as { type?: string; id?: string; name?: string }[]) {
      if (b.type === "tool_use" && b.id && b.name && HEALTH_TOOLS.has(b.name)) healthIds.add(b.id);
    }
  }
  return rows.map((r) => toParam(r, healthIds));
}

/**
 * Opgeslagen bericht terug naar de vorm voor de API. Extra velden die de app zelf bijhoudt
 * (handtekening, "klaargezet" op een voorstel) gaan niet mee. Uitkomsten van tools in `healthIds`
 * (gezondheidsgegevens, zie HEALTH_TOOLS) gaan nooit opnieuw mee.
 */
function toParam(row: Row, healthIds: ReadonlySet<string> = new Set()): Param {
  const blocks = Array.isArray(row.content) ? (row.content as Record<string, unknown>[]) : [];
  if (row.kind === "text") {
    return {
      role: "user",
      content: blocks
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => ({ type: "text" as const, text: b.text as string })),
    };
  }
  if (row.kind === "tool_results") {
    return {
      role: "user",
      content: blocks
        .filter((b) => b.type === "tool_result")
        .map((b) => ({
          type: "tool_result" as const,
          tool_use_id: b.tool_use_id as string,
          content: healthIds.has(b.tool_use_id as string) && b.is_error !== true ? HEALTH_REDACTED : (b.content as string),
          ...(typeof b.is_error === "boolean" && { is_error: b.is_error }),
        })),
    };
  }
  return { role: "assistant", content: row.content } as Param;
}

// ───────── Verzoek ─────────

type Body = {
  conversationId?: string;
  message?: string;
  /** true = het vorige, onderbroken antwoord afmaken zonder de vraag opnieuw op te slaan. */
  retry?: boolean;
  /** true = het lopende antwoord in dit gesprek stoppen (de Stop-knop). */
  stop?: boolean;
  /** "answer" = laatste antwoord opnieuw laten maken; "question" = laatste vraag vervangen door `message`. */
  replace?: "answer" | "question";
  context?: { workout_id?: string; events?: unknown };
};

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "De coach is nog niet ingesteld (ANTHROPIC_API_KEY ontbreekt)." }, { status: 500 });
  }
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const { sb, userId } = auth;

  const body = (await req.json().catch(() => null)) as Body | null;
  const own = await ownConversation(sb, body?.conversationId);
  if (own.error) return Response.json({ error: "Gesprek laden mislukt. Probeer het opnieuw." }, { status: 503 });
  let conversationId = own.id;

  // ── Stop ──
  if (body?.stop) {
    const job = conversationId ? jobs.get(conversationId) : undefined;
    job?.stop.abort();
    let stopped = !!job;
    // Loopt het antwoord op een andere instantie: die ziet de Stop bij zijn volgende hartslag.
    if (conversationId && !job && runningInDb(own.row)) {
      const { data, error } = await sb
        .from("coach_conversations")
        .update({ answer_stop: true })
        .eq("id", conversationId)
        .gt("answer_until", new Date().toISOString())
        .select("id");
      if (!error && data?.length) stopped = true;
    }
    return Response.json({ stopped });
  }

  const replace = body?.replace === "answer" || body?.replace === "question" ? body.replace : undefined;
  const regenerate = replace === "answer";
  const continuing = body?.retry === true || regenerate;
  const message = body?.message?.trim() ?? "";
  if (!continuing && (!message || message.length > 4000)) {
    return Response.json({ error: "Stuur een bericht van maximaal 4000 tekens." }, { status: 400 });
  }
  if ((continuing || replace) && !conversationId) {
    return Response.json({ error: "Dit gesprek bestaat niet meer. Stel je vraag opnieuw." }, { status: 404 });
  }
  if (conversationId && (jobs.has(conversationId) || runningInDb(own.row))) return busyResponse();
  const workoutId = body?.context?.workout_id && UUID.test(body.context.workout_id) ? body.context.workout_id : null;
  const events = Array.isArray(body?.context?.events)
    ? body.context.events
        .filter((e): e is string => typeof e === "string")
        .slice(0, 5)
        .map((e) => e.replace(/[<>]/g, "").slice(0, 300))
    : [];

  // Vanaf hier is het gesprek bezet, zodat twee verzoeken niet door elkaar heen schrijven
  // (ook niet als ze op verschillende serverinstanties binnenkomen).
  let lock: Lock | null = null;
  if (conversationId) {
    const claimed = await claim(sb, conversationId);
    if (claimed === "error") return Response.json({ error: "Gesprek laden mislukt. Probeer het opnieuw." }, { status: 503 });
    if (!claimed) return busyResponse();
    lock = claimed;
  }
  let handedOff = false;
  try {
    // Snelle controle vooraf, zodat een volle dag niets opslaat. Het echte boeken volgt hieronder.
    if (!continuing && (await questionsToday(sb)) >= DAILY_LIMIT) return limitReached();

    const [history, profile, memberships] = await Promise.all([
      conversationId
        ? sb.from("coach_messages").select("seq, role, kind, content").eq("conversation_id", conversationId).order("seq")
        : Promise.resolve({ data: [] as Row[], error: null }),
      fetchMyProfile(sb, userId),
      sb.from("group_members").select("role, groups(id, name)").eq("user_id", userId),
    ]);
    // Zonder geschiedenis zou de coach antwoorden alsof het gesprek nieuw is en de draad stukmaken.
    if (history.error || memberships.error) {
      return Response.json({ error: "Gesprek laden mislukt. Probeer het opnieuw." }, { status: 503 });
    }
    let rows = (history.data ?? []) as Row[];
    let used: number | null = null;
    /** Bij "vraag bewerken": vanaf dit volgnummer verdwijnen de oude vraag en het antwoord. */
    let replaceFrom: number | null = null;

    // ── Laatste beurt vervangen (opnieuw genereren / vraag bewerken) ──
    if (replace) {
      const qi = rows.findLastIndex((r) => r.kind === "text");
      if (qi < 0) return Response.json({ error: "Er is geen vraag om te vervangen." }, { status: 409 });
      if (regenerate) {
        const q = await takeQuestion(sb);
        if (!q.ok) return limitReached();
        used = q.used;
        if (q.legacy) await countAgainLegacy(sb, rows[qi]);
        const { error } = await sb
          .from("coach_messages")
          .delete()
          .eq("conversation_id", conversationId!)
          .gt("seq", rows[qi].seq);
        if (error) return Response.json({ error: "Het vorige antwoord kon niet worden vervangen. Probeer het opnieuw." }, { status: 503 });
        rows = rows.slice(0, qi + 1);
      } else {
        // Vraag bewerken: de oude vraag en het antwoord verdwijnen pas als de nieuwe vraag is opgeslagen,
        // zodat een mislukte poging niets kwijtraakt.
        replaceFrom = rows[qi].seq;
        rows = rows.slice(0, qi);
      }
    } else if (continuing) {
      // ── Afmaken: alleen gratis voor een recente, door de server opgeslagen vraag ──
      const last = rows.at(-1);
      if (!last) return Response.json({ error: "Dit gesprek is leeg. Stel je vraag opnieuw." }, { status: 409 });
      if (last.kind === "assistant" && !openToolUse(last)) {
        return Response.json({ error: "Dit antwoord is al compleet.", complete: true }, { status: 409 });
      }
      // Gratis afmaken kan maar een paar keer per vraag (in de database bijgehouden), anders zou je
      // na het wissen van het antwoord steeds opnieuw een volledig antwoord kunnen laten maken.
      const qi = rows.findLastIndex((r) => r.kind === "text");
      const nonce = qi >= 0 ? verifiedQuestion(conversationId!, rows, qi) : null;
      const free = nonce && wellFormedTail(rows.slice(qi + 1)) ? await takeContinuation(sb, nonce) : "used";
      if (free !== "ok") {
        // Zonder bijhouden ("missing") telt afmaken als vraag; de vraag zelf staat al opgeslagen.
        const q = await takeQuestion(sb, free === "missing");
        if (!q.ok) return limitReached();
        used = q.used;
        if (q.legacy && free === "used" && qi >= 0) await countAgainLegacy(sb, rows[qi]);
      }
    }

    const newConversation = !conversationId;
    if (!conversationId) {
      const { data, error } = await sb.from("coach_conversations").insert({ title: titleFrom(message) }).select("id").single();
      if (error) return Response.json({ error: "Gesprek starten mislukt. Probeer het opnieuw." }, { status: 500 });
      conversationId = data.id as string;
      const claimed = await claim(sb, conversationId);
      if (!claimed || claimed === "error") {
        await sb.from("coach_conversations").delete().eq("id", conversationId).then(() => {}, () => {});
        return Response.json({ error: "Gesprek starten mislukt. Probeer het opnieuw." }, { status: 500 });
      }
      lock = claimed;
    }
    const convId = conversationId;

    // De inhoud komt precies zo uit de database als hij eerder naar/van de API ging.
    // Uitkomsten van gezondheidstools gaan niet opnieuw mee (zie HEALTH_TOOLS).
    const messages = toParams(rows);
    const groups: ContextGroup[] = (memberships.data ?? [])
      .map((m) => {
        const g = m.groups as unknown as { id: string; name: string } | null;
        return g && { id: g.id, name: g.name, role: m.role as string };
      })
      .filter((g): g is ContextGroup => !!g);

    try {
      // Werd een vorig antwoord afgebroken na een tool-aanroep, dan ontbreken de tool-resultaten;
      // vul ze aan (de geschiedenis zelf passen we niet aan, we voegen alleen toe).
      if (openToolUse(rows.at(-1))) {
        const open = (rows.at(-1)!.content as Block[]).filter((b) => b.type === "tool_use") as Anthropic.Beta.BetaToolUseBlock[];
        const results = open.map((tu) => ({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: "Onderbroken; niet uitgevoerd.",
          is_error: true,
        }));
        messages.push({ role: "user", content: results });
        await save(sb, convId, "user", "tool_results", results);
      }

      if (!continuing) {
        // Context (datum, profiel, groepen) gaat mee in de vraag zelf, zodat de systeemprompt per gesprek gelijk blijft.
        const context = coachContext(profile, userId, groups, workoutId, events);
        messages.push({ role: "user", content: [{ type: "text", text: context }, { type: "text", text: message }] });
        // Opgeslagen met een handtekening: alleen deze vraag mag later gratis worden afgemaakt.
        const nonce = randomUUID();
        const time = Date.now();
        const seq = await save(sb, convId, "user", "text", [
          { type: "text", text: context, spotter: { n: nonce, t: time, s: sign(convId, nonce, time, message) } },
          { type: "text", text: message },
        ]);
        // Pas boeken als de vraag echt is opgeslagen: een mislukte poging kost dan geen vraag.
        const q = await takeQuestion(sb, true);
        if (!q.ok) {
          await sb.from("coach_messages").delete().eq("seq", seq);
          if (newConversation) await sb.from("coach_conversations").delete().eq("id", convId);
          return limitReached();
        }
        used = q.used;
        if (replaceFrom != null) {
          const { error } = await sb
            .from("coach_messages")
            .delete()
            .eq("conversation_id", convId)
            .gte("seq", replaceFrom)
            .lt("seq", seq);
          if (error) {
            await sb.from("coach_messages").delete().eq("seq", seq);
            throw new CoachError("Je vraag kon niet worden vervangen. Probeer het opnieuw.");
          }
        }
      }
    } catch (err) {
      // Geen lege gesprekken achterlaten in "Gesprekken".
      if (newConversation) await sb.from("coach_conversations").delete().eq("id", convId).then(() => {}, () => {});
      return Response.json({ error: describeError(err) }, { status: 500 });
    }

    const response = startAnswer({ sb, userId, convId, messages, used, job: lock!.job, release: lock!.release });
    handedOff = true;
    return response;
  } finally {
    if (!handedOff) await lock?.release();
  }
}

// ───────── Antwoord ─────────

function startAnswer({
  sb,
  userId,
  convId,
  messages,
  used,
  job,
  release,
}: {
  sb: SupabaseClient;
  userId: string;
  convId: string;
  messages: Param[];
  used: number | null;
  job: Job;
  release: () => Promise<void>;
}) {
  const client = new Anthropic();
  const encoder = new TextEncoder();
  const abort = job.stop;
  /** De chat leest niet meer mee (verbinding weg); het antwoord loopt wel door en wordt opgeslagen. */
  let closed = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  const send = (e: Event) => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
    } catch {
      closed = true;
    }
  };
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      controller?.close();
    } catch {
      // al gesloten
    }
  };

  async function run() {
    send({ t: "conversation", id: convId });
    if (used != null) send({ t: "quota", used, limit: DAILY_LIMIT });
    const beat = setInterval(() => {
      send({ t: "ping" });
      // Bezetting in de database verlengen (en een Stop van een andere instantie oppikken).
      void job.beat().catch(() => {});
    }, 5000);

    /** Tekst van de lopende ronde die nog niet is opgeslagen (voor een gestopt antwoord). */
    let roundText = "";
    /** Het laatst opgeslagen bericht is een afgerond antwoord van de coach. */
    let answered = false;

    try {
      let jsonRetries = 0;
      for (let round = 0; round < MAX_TOOL_ROUNDS; ) {
        if (abort.signal.aborted) break;
        if (round > 0) send({ t: "round" });
        roundText = "";
        let lastStatus = "";
        /** Tools waarvan de chip al getoond is terwijl het model de invoer nog schrijft. */
        const announced = new Set<string>();

        const response = client.beta.messages.stream(
          {
            model: MODEL,
            max_tokens: 32000,
            // display "updates": korte voortgangsnotities tussen tool-aanroepen, als status in de chat.
            // drop_block: past de geschiedenis ooit niet meer (bijv. oude gesprekken), dan vallen alleen
            // de oude thinking-blokken weg in plaats van dat het verzoek mislukt.
            thinking: { type: "adaptive", display: "updates", block_binding: { prefix_mismatch_behavior: "drop_block" } },
            output_config: { effort: "medium" },
            system: [{ type: "text", text: COACH_SYSTEM }],
            tools: TOOL_DEFINITIONS,
            messages,
            // Cachet de hele prefix (tools + system + geschiedenis) automatisch.
            cache_control: { type: "ephemeral" },
            // Lange gesprekken: oude tool-resultaten (grote trainingslogs) ruimt de API zelf op.
            context_management: {
              edits: [
                {
                  type: "clear_tool_uses_20250919",
                  trigger: { type: "input_tokens", value: 60000 },
                  keep: { type: "tool_uses", value: 6 },
                  clear_at_least: { type: "input_tokens", value: 15000 },
                },
              ],
            },
            betas: [
              "server-side-fallback-2026-07-01",
              "context-management-2025-06-27",
              "thinking-binding-controls-2026-08-01",
              "thinking-display-updates-2026-08-18",
            ],
            // Weigert het model een vraag, dan probeert de API het zelf op een ander model.
            fallbacks: "default",
          },
          { signal: abort.signal },
        );
        response.on("text", (delta) => {
          roundText += delta;
          send({ t: "text", d: delta });
        });
        response.on("thinking", (_delta, snapshot) => {
          // Alleen de nieuwste notitie: een blok kan er meerdere bevatten.
          const note = snapshot.trim().split(/\n+/).at(-1)?.trim() ?? "";
          if (!note || note === lastStatus) return;
          lastStatus = note;
          send({ t: "status", d: note.length > 140 ? `${note.slice(0, 139)}…` : note });
        });
        // Chip meteen tonen zodra het model aan een tool begint: het schrijven van een groot schema
        // als tool-invoer kan even duren, en zo ziet de gebruiker wat er gebeurt.
        response.on("streamEvent", (ev) => {
          if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
            const { id, name } = ev.content_block;
            announced.add(id);
            send({ t: "tool", id, name, label: toolLabel(name) });
          }
        });

        let final: Anthropic.Beta.BetaMessage;
        try {
          final = await response.finalMessage();
        } catch (err) {
          // Alleen een onleesbare tool-invoer (eager streaming) opnieuw proberen; API-fouten en Stop gaan door.
          if (err instanceof Anthropic.APIError || abort.signal.aborted || jsonRetries++ >= MAX_JSON_RETRIES) throw err;
          roundText = "";
          send({ t: "reset_round" });
          continue;
        }
        jsonRetries = 0;

        if (final.stop_reason === "refusal") {
          const text = `${roundText.trim() ? `${roundText.trim()}\n\n` : ""}_Hier kan ik je helaas niet mee helpen._`;
          send({ t: "text", d: "\n\n_Hier kan ik je helaas niet mee helpen._" });
          await save(sb, convId, "assistant", "assistant", [{ type: "text", text }]);
          roundText = "";
          answered = true;
          for (const id of announced) send({ t: "tool_done", id, ok: false });
          break;
        }

        const content = replayable(final.content);
        messages.push({ role: "assistant", content });
        await save(sb, convId, "assistant", "assistant", content);
        roundText = "";
        send({ t: "commit" });

        const toolUses = content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        const tooLong = final.stop_reason === "max_tokens" || final.stop_reason === "model_context_window_exceeded";
        const lastRound = round === MAX_TOOL_ROUNDS - 1;
        const willRun = !tooLong && !lastRound && final.stop_reason === "tool_use" && toolUses.length > 0;
        // Chips van tools die toch niet draaien (bijv. afgekapt antwoord) niet als bezig laten staan.
        for (const id of announced) {
          if (!willRun || !toolUses.some((tu) => tu.id === id)) send({ t: "tool_done", id, ok: false });
        }

        if (tooLong) {
          answered = toolUses.length === 0;
          send({ t: "text", d: "\n\n_Het antwoord werd te lang en is afgebroken. Vraag gerust om de rest._" });
          break;
        }
        if (!willRun) {
          answered = toolUses.length === 0;
          if (lastRound && toolUses.length) {
            send({ t: "text", d: "\n\n_Dit werd te complex voor één antwoord; stel je vraag iets specifieker._" });
          }
          break;
        }

        // Alle tool-resultaten samen in één bericht terug (zodat parallelle tool-calls blijven werken).
        // Deze ronde maken we altijd af en slaan we op, ook na Stop: een opgeslagen schema hoort in de geschiedenis.
        const results = await Promise.all(
          toolUses.map(async (tu) => {
            if (!announced.has(tu.id)) send({ t: "tool", id: tu.id, name: tu.name, label: toolLabel(tu.name) });
            // history: delete_template controleert daarmee of de gebruiker het verwijderen heeft bevestigd.
            const r = await runTool(tu.name, tu.input, { sb, userId, history: messages });
            send({ t: "tool_done", id: tu.id, ok: !r.isError });
            if (!r.isError) {
              const artifact = artifactFrom(tu.name, r.data);
              if (artifact) send({ t: "artifact", ...artifact });
              const proposal = proposalFrom(tu.name, r.data);
              if (proposal) send({ t: "proposal", data: proposal, id: tu.id });
              if (asksDeleteConfirmation(tu.name, r.data)) send({ t: "confirm", id: tu.id });
            }
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: r.content,
              is_error: r.isError,
            };
          }),
        );
        // De coach ziet de volledige uitkomst in dit antwoord; opgeslagen wordt hij zonder gezondheidsgegevens.
        messages.push({ role: "user", content: results });
        await save(sb, convId, "user", "tool_results", storableResults(results, toolUses));
        round++;
      }

      send(abort.signal.aborted ? { t: "stopped" } : { t: "done" });
    } catch (err) {
      if (abort.signal.aborted) {
        send({ t: "stopped" });
      } else {
        if (!(err instanceof CoachError) && !(err instanceof Anthropic.APIError)) console.error("[coach]", err);
        send({ t: "error", message: describeError(err) });
      }
    } finally {
      // Gestopt: bewaar wat er al stond (met een markering), zodat het antwoord na herladen niet verdwijnt
      // en de coach bij de volgende vraag weet dat dit antwoord is afgebroken.
      // Bezetting kwijt: dan schrijft er intussen een ander verzoek in dit gesprek, niets meer toevoegen.
      if (abort.signal.aborted && !answered && !job.lost) {
        const partial = roundText.trim();
        await save(sb, convId, "assistant", "assistant", [
          { type: "text", text: partial ? `${partial}\n\n${STOP_MARK}` : STOP_MARK },
        ]).catch(() => {});
      }
      await sb
        .from("coach_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", convId)
        .then(
          () => {},
          () => {},
        );
      clearInterval(beat);
      await release();
      close();
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      const finished = run();
      // Valt de verbinding weg, dan loopt het antwoord door tot het klaar en opgeslagen is.
      after(() => finished);
    },
    cancel() {
      // Bewust geen abort: alleen de Stop-knop (POST {stop}) breekt een antwoord af.
      closed = true;
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Titel voor de gesprekkenlijst: de vraag op één regel, afgekapt op een woordgrens. */
function titleFrom(message: string) {
  const line = message.replace(/\s+/g, " ").trim();
  if (line.length <= 60) return line;
  const cut = line.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s,.:;-]+$/, "")}…`;
}

/**
 * Inhoud die terug mag in de geschiedenis. Na een fallback halverwege een antwoord horen de
 * thinking- en tool_use-blokken vóór het laatste fallback-blok niet meer mee te gaan.
 */
function replayable(content: Block[]): Block[] {
  const lastFallback = content.map((b) => b.type).lastIndexOf("fallback");
  if (lastFallback < 0) return content;
  return content.filter(
    (b, i) => i > lastFallback || !["thinking", "redacted_thinking", "tool_use"].includes(b.type),
  );
}

/** Slaat een bericht op en geeft het volgnummer terug. */
async function save(
  sb: SupabaseClient,
  conversationId: string,
  role: "user" | "assistant",
  kind: "text" | "assistant" | "tool_results",
  content: unknown,
): Promise<number> {
  const { data, error } = await sb
    .from("coach_messages")
    .insert({ conversation_id: conversationId, role, kind, content })
    .select("seq")
    .single();
  if (error || !data) {
    console.error("[coach] opslaan mislukt", error);
    throw new CoachError("Het gesprek kon niet worden opgeslagen. Probeer het opnieuw.");
  }
  return data.seq as number;
}

/** Nederlandse foutmelding voor de chat; technische details gaan alleen naar de serverlog. */
function describeError(err: unknown): string {
  if (err instanceof CoachError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "De coach kan niet inloggen bij de AI (API-key klopt niet).";
  if (err instanceof Anthropic.PermissionDeniedError) return "De coach heeft geen toegang tot de AI met deze API-key.";
  if (err instanceof Anthropic.RateLimitError) return "Even te veel verzoeken tegelijk. Probeer het zo opnieuw.";
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit|balance/i.test(err.message)) return "Het API-tegoed is op.";
    if (/too long|context window|context length|maximum context/i.test(err.message)) {
      return "Dit gesprek is te lang geworden. Begin een nieuw gesprek.";
    }
    return "De AI kon deze vraag niet verwerken. Probeer het anders te formuleren of begin een nieuw gesprek.";
  }
  if (err instanceof Anthropic.APIConnectionError) return "Geen verbinding met de AI. Probeer het zo opnieuw.";
  if (err instanceof Anthropic.APIError) return `De AI is even niet bereikbaar (${err.status ?? "netwerk"}). Probeer het zo opnieuw.`;
  return "Er ging iets mis bij de coach. Probeer het opnieuw.";
}
