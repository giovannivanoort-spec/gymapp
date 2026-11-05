"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  memo,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AppShell } from "@/components/AppShell";
import { useUserId } from "@/components/AuthProvider";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  ClipboardIcon,
  ClockIcon,
  CloseIcon,
  PlusIcon,
  RefreshIcon,
  SparkleIcon,
} from "@/components/Icons";
import { Sheet } from "@/components/Sheet";
import { Stepper } from "@/components/planning/Stepper";
import { SwapSheet } from "@/components/planning/SwapSheet";
import { invalidate, useCached } from "@/lib/cache";
import {
  artifactFrom,
  followupsFor,
  formatShortDate,
  planGroupWorkout,
  proposalFrom,
  STOP_MARK,
  todayAmsterdam,
  toolLabel,
  WRITE_TOOLS,
  type Artifact,
  type ProposalExercise,
  type WorkoutProposal,
} from "@/lib/coach/shared";
import { timeAgo } from "@/lib/dates";
import { fetchMyGroups, myGroupsKey, type MyGroup } from "@/lib/groups";
import { supabase } from "@/lib/supabase";

// ───────── Types ─────────

type ToolChip = { id: string; name: string; label: string; state: "running" | "done" | "failed" | "stopped" };
/** Oefening in een voorstel, met optioneel startgewichten per groepslid. */
type ProposalEx = ProposalExercise & { targets?: { name: string; target: string }[] };
type Proposal = Omit<WorkoutProposal, "exercises"> & { exercises: ProposalEx[] };
/** Bewaard bij het tool-resultaat zodra de trainer het voorstel heeft klaargezet. */
type Planned = { workout_id: string; date: string; title?: string; exercises?: ProposalEx[] };
type ProposalItem = { proposal: Proposal; toolUseId?: string; planned?: Planned };
type ChatItem = {
  key: string;
  role: "user" | "assistant";
  text: string;
  tools: ToolChip[];
  artifacts: Artifact[];
  proposals: ProposalItem[];
  /** Voortgangsnotitie van de coach terwijl hij tools gebruikt. */
  status?: string;
  stopped?: boolean;
  /** Het antwoord loopt nog op de server (na een verbroken verbinding): wachtindicator tonen. */
  pending?: boolean;
  /** Lengte van `text` die al door de server is opgeslagen (begin van de lopende model-ronde). */
  roundStart?: number;
  /** Na een tool-ronde: de volgende tekst begint op een nieuwe alinea. */
  needsBreak?: boolean;
};
type Conversation = { id: string; title: string; updated_at: string };
type StoredBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  planned?: Planned;
};
type StoredRow = { seq: number; role: string; kind: string; content: unknown };
type Loaded = { items: ChatItem[]; open: boolean };
type Ctx = { workout_id?: string };
type Retry =
  /** Mislukt voordat de server iets opsloeg: de vraag opnieuw versturen. */
  | { kind: "resend"; userKey: string; text: string; ctx?: Ctx; replace?: boolean }
  /** Onderbroken antwoord: de server maakt het af zonder de vraag dubbel op te slaan. Zonder aKey: het laatste antwoord. */
  | { kind: "continue"; conversationId: string; aKey?: string }
  /** Nieuw antwoord op de laatste vraag laten maken. */
  | { kind: "regenerate" }
  /** Laden van een gesprek mislukt (zonder id: het laatste gesprek). */
  | { kind: "load"; id?: string };
type Failure = { message: string; retry?: Retry };
type Quota = { used: number; limit: number };
type Status = Quota & { running?: boolean };
type TurnOpts = { resend?: Retry; sentEvents?: string[]; reloadOnFail?: boolean; waited?: boolean };

/** Zo lang zonder enig teken van de server (ook geen hartslag) = verbinding weg. */
const STALL_MS = 20_000;
/** Zo lang wachten we na een verbroken verbinding hoogstens op het antwoord van de server. */
const WATCH_MAX_MS = 6 * 60_000;
const STILL_WORKING = "De coach werkt nog aan je antwoord…";

let keySeq = 0;
const nextKey = () => `m${++keySeq}`;
const emptyAssistant = (key: string): ChatItem => ({
  key,
  role: "assistant",
  text: "",
  tools: [],
  artifacts: [],
  proposals: [],
  roundStart: 0,
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Tot dit tijdstip komen scroll-events van ons eigen scrollen (niet van de gebruiker). */
let autoScrollUntil = 0;
function scrollToBottom(smooth: boolean) {
  const animate = smooth && !reducedMotion();
  autoScrollUntil = performance.now() + (animate ? 700 : 120);
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: animate ? "smooth" : "auto" });
}

/**
 * Op een telefoon: tabbalk weg zolang je typt, en het invoerveld precies op het toetsenbord.
 * iOS verkleint het layout-venster niet als het toetsenbord opent; --coach-kb (gemeten met
 * visualViewport) is hoeveel van de onderkant het toetsenbord bedekt.
 */
const COMPOSER_CSS = `@media (pointer: coarse) {
  body:has(#coach-input:focus) nav[aria-label="Hoofdmenu"] { display: none; }
  body:has(#coach-input:focus) main { padding-bottom: calc(var(--coach-kb, 0px) + 0.25rem); }
  body:has(#coach-input:focus) .coach-composer {
    bottom: var(--coach-kb, 0px);
    padding-bottom: var(--coach-pad, calc(env(safe-area-inset-bottom) + 0.5rem));
  }
}`;

// ───────── Helpers ─────────

/** Vraag uit een deeplink (?q=...). Een "(workout <id>)" erin gaat als onzichtbare context mee. */
function draftFrom(params: URLSearchParams): { text: string; ctx?: Ctx } {
  const q = params.get("q") ?? "";
  let workout = params.get("workout") ?? undefined;
  const m = q.match(/\s*\(workout ([0-9a-f-]{36})\)/i);
  if (m) workout ??= m[1];
  return { text: m ? q.replace(m[0], "") : q, ctx: workout ? { workout_id: workout } : undefined };
}

/** Na een opgeslagen schema of training: de lijsten elders in de app verversen. */
function invalidateFor(kind: Artifact["kind"]) {
  if (kind === "template") {
    invalidate("templates");
    return;
  }
  invalidate("home:workouts:");
  invalidate("group:");
  invalidate("group-today:");
  invalidate("history:");
  invalidate("feed:");
  invalidate("wo:workout:");
}

/** Markdown naar platte tekst voor de schermlezer-melding. */
function plain(md: string) {
  return md
    .replace(/[*_`#>|]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function asProposal(data: unknown): Proposal | null {
  return proposalFrom("propose_group_workout", { proposal: data }) as Proposal | null;
}

/** Zet opgeslagen API-berichten om naar chatberichten (tool-rondes worden één antwoord). */
function toItems(rows: StoredRow[], openTail: boolean): ChatItem[] {
  const list: ChatItem[] = [];
  const pending = new Map<string, { name: string; item: ChatItem }>();
  for (const m of rows) {
    const blocks = (Array.isArray(m.content) ? m.content : []) as StoredBlock[];
    if (m.kind === "text") {
      const text = blocks
        .filter((b) => b.type === "text" && b.text && !b.text.startsWith("<context>"))
        .map((b) => b.text)
        .join("\n\n");
      list.push({ key: `r${m.seq}`, role: "user", text, tools: [], artifacts: [], proposals: [] });
    } else if (m.kind === "assistant") {
      const prev = list.at(-1);
      const item: ChatItem = prev?.role === "assistant" ? prev : { ...emptyAssistant(`r${m.seq}`), roundStart: undefined };
      if (item !== prev) list.push(item);
      for (const b of blocks) {
        if (b.type === "text" && b.text) {
          let text = b.text;
          if (text.endsWith(STOP_MARK)) {
            item.stopped = true;
            text = text.slice(0, -STOP_MARK.length).trimEnd();
          }
          if (text) item.text += (item.text ? "\n\n" : "") + text;
        }
        if (b.type === "tool_use" && b.name && b.id) {
          item.tools.push({ id: b.id, name: b.name, label: toolLabel(b.name), state: "running" });
          pending.set(b.id, { name: b.name, item });
        }
      }
    } else if (m.kind === "tool_results") {
      for (const r of blocks) {
        const p = r.tool_use_id ? pending.get(r.tool_use_id) : undefined;
        if (!p) continue;
        pending.delete(r.tool_use_id!);
        p.item.tools = p.item.tools.map((t) => (t.id === r.tool_use_id ? { ...t, state: r.is_error ? "failed" : "done" } : t));
        if (r.is_error || typeof r.content !== "string") continue;
        try {
          const data = JSON.parse(r.content);
          const a = artifactFrom(p.name, data);
          if (a) p.item.artifacts.push(a);
          const proposal = proposalFrom(p.name, data) as Proposal | null;
          if (proposal) p.item.proposals.push({ proposal, toolUseId: r.tool_use_id, planned: r.planned });
        } catch {
          // geen JSON: geen kaartje
        }
      }
    }
  }
  // Tools zonder resultaat: nog bezig (antwoord loopt op de server) of onderbroken.
  for (const { item } of pending.values()) {
    item.tools = item.tools.map((t) => (t.state === "running" && !openTail ? { ...t, state: "stopped" } : t));
  }
  return list;
}

/** Is het laatste antwoord nog niet af (vraag zonder antwoord, of midden in een tool-ronde)? */
function isOpen(rows: StoredRow[]) {
  const last = rows.at(-1);
  if (!last) return false;
  if (last.kind !== "assistant") return true;
  return Array.isArray(last.content) && (last.content as StoredBlock[]).some((b) => b.type === "tool_use");
}

async function fetchConversation(id: string): Promise<Loaded> {
  const { data, error } = await supabase
    .from("coach_messages")
    .select("seq, role, kind, content")
    .eq("conversation_id", id)
    .order("seq");
  if (error) throw new Error("Gesprek laden mislukt. Controleer je verbinding en probeer het opnieuw.");
  const rows = (data ?? []) as StoredRow[];
  const open = isOpen(rows);
  return { items: toItems(rows, open), open };
}

/** Het laatst bijgewerkte gesprek (of null als er nog geen is). */
async function fetchLatest(): Promise<({ id: string } & Loaded) | null> {
  const { data, error } = await supabase
    .from("coach_conversations")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Je gesprekken konden niet worden geladen. Controleer je verbinding.");
  if (!data) return null;
  return { id: data.id as string, ...(await fetchConversation(data.id as string)) };
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
}

/** Daglimiet, en met een gesprek erbij: loopt daar nog een antwoord op de server? */
async function fetchStatus(conversationId?: string | null): Promise<Status | null> {
  const res = await fetch(`/api/coach${conversationId ? `?conversation=${encodeURIComponent(conversationId)}` : ""}`, {
    headers: await authHeader(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const s = (await res.json()) as Status;
  return typeof s.used === "number" ? s : null;
}

/** Vraagt de server het lopende antwoord in dit gesprek te stoppen (de Stop-knop). */
async function requestStop(conversationId: string) {
  try {
    await fetch("/api/coach", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({ conversationId, stop: true }),
    });
  } catch {
    // geen verbinding: de server maakt het antwoord dan af
  }
}

/** Wacht tot er in dit gesprek geen antwoord meer loopt (hoogstens een minuut). */
async function waitIdle(conversationId: string, signal: AbortSignal, onTick: () => void) {
  for (let i = 0; i < 50 && !signal.aborted; i++) {
    await sleep(1200);
    onTick();
    const s = await fetchStatus(conversationId).catch(() => null);
    if (s && !s.running) return true;
  }
  return false;
}

/**
 * Nieuwe lijst uit de database, maar met de sleutels (en objecten) van wat al op het scherm staat:
 * zo verspringt er niets en spelen de animaties niet opnieuw af.
 */
function adoptKeys(prev: ChatItem[], next: ChatItem[]): ChatItem[] {
  return next.map((it, i) => {
    const old = prev[i];
    if (!old || old.role !== it.role) return it;
    const adopted = old.key === it.key ? it : { ...it, key: old.key };
    return JSON.stringify(adopted) === JSON.stringify(old) ? old : adopted;
  });
}

/** Laatste antwoord als "loopt nog" markeren (of een wachtend antwoord toevoegen). */
function withPending(items: ChatItem[], status: string): ChatItem[] {
  const last = items.at(-1);
  if (last?.role === "assistant") return [...items.slice(0, -1), { ...last, pending: true, status }];
  return [...items, { ...emptyAssistant("pending"), pending: true, status }];
}

function trainerGroupOf(groups: MyGroup[] | undefined) {
  return groups?.find((g) => g.role === "trainer" && g.memberCount > 1) ?? groups?.find((g) => g.role === "trainer");
}

function startersFor(groups: MyGroup[] | undefined): string[] {
  const trainerOf = trainerGroupOf(groups);
  if (trainerOf) {
    return [
      `Stel de training van morgen voor ${trainerOf.name} voor, met startgewichten per persoon`,
      `Nabespreking: hoe ging de laatste training van ${trainerOf.name}?`,
      `Groepscheck: wie van ${trainerOf.name} loopt achter, en op welke spiergroepen?`,
      "Kijk mijn laatste training na",
      "Haal ik genoeg eiwit binnen voor mijn doel?",
    ];
  }
  return [
    "Kijk mijn laatste training na",
    "Hoe gaat mijn progressie op de bench press?",
    "Welke spieren heb ik de afgelopen 2 weken te weinig getraind?",
    "Hoe kom ik het snelst naar een hogere rang op de bench press?",
    "Haal ik genoeg eiwit binnen voor mijn doel?",
  ];
}

const MARKDOWN: Components = {
  a: ({ href, children }) =>
    href?.startsWith("/") ? (
      <Link href={href}>{children}</Link>
    ) : (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
};

// ───────── Pagina ─────────

export default function CoachPage() {
  return (
    <Suspense>
      <Coach />
    </Suspense>
  );
}

function Coach() {
  const params = useSearchParams();
  const userId = useUserId();
  const groups = useCached(userId ? myGroupsKey(userId) : null, () => fetchMyGroups(userId), { persist: true });

  const [draft] = useState(() => draftFrom(params));
  const [input, setInput] = useState(draft.text);
  const [pendingCtx, setPendingCtx] = useState<Ctx | undefined>(draft.ctx);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  // Zonder deeplink-vraag laden we eerst het laatste gesprek: tot die tijd skeletons i.p.v. een flitsend leeg scherm.
  const [loading, setLoading] = useState(() => !draft.text);
  const [busy, setBusy] = useState(false);
  /** Na een verbroken verbinding: we wachten op het antwoord dat op de server doorloopt. */
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  /** De laatste vraag wordt bewerkt (de tekst staat in het invoerveld). */
  const [editing, setEditing] = useState(false);
  /** Melding voor schermlezers zodra een antwoord klaar is (de chat zelf leest niet elk woord voor). */
  const [announcement, setAnnouncement] = useState("");

  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Tijdstip van het laatste teken van de lopende stream (voor de waakhond). */
  const pulseRef = useRef<{ last: number } | null>(null);
  /** Gesprek van de lopende stream (voor de Stop-knop). */
  const streamConvRef = useRef<string | null>(null);
  /** Stop gedrukt voordat de server het gesprek had doorgegeven. */
  const pendingStopRef = useRef(false);
  /** We wachten tot een vorig antwoord is afgerond; er loopt nog niets voor deze vraag. */
  const waitingRef = useRef(false);
  /** Stop gedrukt terwijl we een doorlopend antwoord afwachten. */
  const stoppingRef = useRef(false);
  /** Elke laad- of verstuuractie hoogt dit op; late antwoorden van een oudere actie worden genegeerd. */
  const loadRef = useRef(0);
  const atBottomRef = useRef(true);
  /** Wat de gebruiker sinds het vorige antwoord zelf deed (bijv. een voorstel klaargezet); gaat mee met de volgende vraag. */
  const eventsRef = useRef<string[]>([]);

  // De deeplink-vraag uit de adresbalk halen: na herladen of terug navigeren laadt dan gewoon het laatste gesprek.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", "/coach");
  }, []);

  /** Een geladen gesprek eindigt midden in een antwoord: loopt het nog, of is het onderbroken? */
  async function resumeOpen(id: string) {
    const token = loadRef.current;
    const s = await fetchStatus(id).catch(() => null);
    if (token !== loadRef.current) return;
    if (s?.running) {
      void watch(id);
    } else {
      setError({ message: "Het vorige antwoord werd onderbroken. Laat de coach het afmaken.", retry: { kind: "continue", conversationId: id } });
    }
  }
  const onLoadedOpen = useEffectEvent((id: string) => void resumeOpen(id));

  // Laatste gesprek laden (tenzij er een nieuwe vraag via ?q= binnenkomt).
  useEffect(() => {
    if (draft.text) return;
    const token = ++loadRef.current;
    fetchLatest()
      .then((latest) => {
        if (token !== loadRef.current) return;
        if (latest) {
          setConversationId(latest.id);
          setItems(latest.items);
          requestAnimationFrame(() => scrollToBottom(false));
          if (latest.open) onLoadedOpen(latest.id);
        }
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (token !== loadRef.current) return;
        setError({ message: e instanceof Error ? e.message : "Gesprek laden mislukt.", retry: { kind: "load" } });
        setLoading(false);
      });
  }, [draft]);

  // Hoeveel vragen er vandaag nog over zijn; opnieuw ophalen als de app weer in beeld komt (bijv. na middernacht).
  // Komt de app terug na een tijd op de achtergrond terwijl er een antwoord liep, dan de stream als verloren beschouwen.
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      fetchStatus()
        .then((q) => {
          if (!cancelled && q) setQuota({ used: q.used, limit: q.limit });
        })
        .catch(() => {});
    void refresh();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refresh();
      const pulse = pulseRef.current;
      if (pulse && Date.now() - pulse.last > 12_000) abortRef.current?.abort("lost");
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, []);

  // Alleen meescrollen als je onderaan staat; scroll je omhoog om te lezen, dan blijft het beeld staan.
  useEffect(() => {
    const onScroll = () => {
      // Tijdens ons eigen (vloeiende) scrollen niet de "naar beneden"-knop laten knipperen.
      if (performance.now() < autoScrollUntil) {
        atBottomRef.current = true;
        return;
      }
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120;
      atBottomRef.current = atBottom;
      setShowJump(!atBottom);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Toetsenbord op een telefoon: meten hoeveel het bedekt, zodat het invoerveld er precies op staat.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        root.style.setProperty("--coach-kb", `${inset}px`);
        // Toetsenbord open: de home-indicator valt erachter, dus geen extra ruimte daarvoor.
        root.style.setProperty("--coach-pad", inset > 0 ? "0.5rem" : "calc(env(safe-area-inset-bottom) + 0.5rem)");
        if (document.activeElement?.id === "coach-input" && atBottomRef.current) scrollToBottom(false);
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--coach-kb");
      root.style.removeProperty("--coach-pad");
    };
  }, []);

  useEffect(() => {
    if (atBottomRef.current) scrollToBottom(false);
  }, [items]);

  // Invoerveld groeit mee met de tekst (tot max-h-40).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // Pagina verlaten: alleen de stream loslaten. Het antwoord loopt op de server door en staat er bij terugkomst.
  useEffect(
    () => () => {
      loadRef.current++;
      abortRef.current?.abort("leave");
    },
    [],
  );

  /** Gesprek opnieuw uit de database halen (na een geweigerd of al afgerond verzoek). */
  async function reload(id: string) {
    try {
      const fresh = await fetchConversation(id);
      setItems((prev) => adoptKeys(prev, fresh.items));
    } catch {
      // laat staan wat er staat
    }
  }

  /**
   * Wacht op een antwoord dat op de server doorloopt nadat de verbinding wegviel (app op de
   * achtergrond, geen bereik). Haalt het gesprek telkens opnieuw op tot het antwoord af is.
   */
  async function watch(id: string, status = STILL_WORKING) {
    const token = ++loadRef.current;
    stoppingRef.current = false;
    setBusy(true);
    setWatching(true);
    setError(null);
    setItems((prev) => withPending(prev, status));
    const started = Date.now();
    try {
      for (;;) {
        let running = false;
        try {
          const [s, fresh] = await Promise.all([fetchStatus(id), fetchConversation(id)]);
          if (token !== loadRef.current) return;
          if (s) setQuota({ used: s.used, limit: s.limit });
          running = !!s?.running;
          const note = stoppingRef.current ? "Stoppen…" : STILL_WORKING;
          setItems((prev) => adoptKeys(prev, running ? withPending(fresh.items, note) : fresh.items));
          if (!running) {
            if (fresh.open) {
              setError({ message: "Het antwoord werd onderbroken. Laat de coach het afmaken.", retry: { kind: "continue", conversationId: id } });
            } else {
              const last = fresh.items.at(-1);
              const text = last?.role === "assistant" ? plain(last.text) : "";
              setAnnouncement(text ? `Antwoord van de coach: ${text.slice(0, 600)}` : "De coach is klaar.");
            }
            return;
          }
        } catch {
          if (token !== loadRef.current) return;
          setItems((prev) => withPending(prev, "Geen verbinding. Je antwoord loopt op de server door…"));
        }
        if (Date.now() - started > WATCH_MAX_MS) {
          setError({ message: "De coach reageert niet meer. Probeer het antwoord af te maken.", retry: { kind: "continue", conversationId: id } });
          return;
        }
        await sleep(running ? 1500 : 3000);
        if (token !== loadRef.current) return;
      }
    } finally {
      if (token === loadRef.current) {
        setItems((prev) => prev.filter((it) => !(it.pending && !it.text && !it.tools.length)).map((it) => (it.pending ? { ...it, pending: false, status: undefined } : it)));
        setBusy(false);
        setWatching(false);
      }
    }
  }

  /**
   * Leest de NDJSON-stream van de coach in het assistent-bericht `aKey`.
   * `resend`: hoe opnieuw te proberen als het misgaat voordat de server iets heeft opgeslagen.
   */
  async function runTurn(aKey: string, body: Record<string, unknown>, opts: TurnOpts = {}): Promise<void> {
    const { resend, sentEvents = [] } = opts;
    setBusy(true);
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    pendingStopRef.current = false;
    const pulse = { last: Date.now() };
    pulseRef.current = pulse;
    // Waakhond: geen hartslag meer van de server = verbinding weg (het antwoord loopt daar door).
    const dog = setInterval(() => {
      if (Date.now() - pulse.last > STALL_MS) ac.abort("lost");
    }, 4000);
    const bodyConv = typeof body.conversationId === "string" ? body.conversationId : null;

    const patch = (fn: (a: ChatItem) => ChatItem) => setItems((prev) => prev.map((it) => (it.key === aKey ? fn(it) : it)));
    const dropIfEmpty = () =>
      setItems((prev) =>
        prev.filter((it) => it.key !== aKey || it.text || it.tools.length || it.artifacts.length || it.proposals.length),
      );

    // Tekst bundelen per animatieframe: niet per woord opnieuw renderen (scheelt veel op een telefoon).
    let pendingText = "";
    let raf = 0;
    const flush = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (!pendingText) return;
      const d = pendingText;
      pendingText = "";
      patch((a) => {
        const sep = a.needsBreak && a.text && !a.text.endsWith("\n\n") ? "\n\n" : "";
        return { ...a, text: a.text + sep + d, needsBreak: false, status: undefined };
      });
    };
    const queueText = (d: string) => {
      pendingText += d;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    /** Gesprek waarvoor de server deze beurt al heeft opgeslagen (dan: afmaken i.p.v. opnieuw vragen). */
    let streamConv: string | null = null;
    let finished = false;
    let stoppedByServer = false;
    let failure: string | null = null;
    /** Verbinding weg terwijl de server al bezig was: het antwoord afwachten. */
    let recover: string | null = null;
    /** Het verzoek is na even wachten opnieuw gedaan (dat verzoek regelt de afronding zelf). */
    let handedOver = false;
    /** Opslaande tools die nog bezig zijn (na Stop maakt de server ze af). */
    const writing = new Set<string>();
    let answer = "";
    let answerCommitted = 0;
    const retryAfterStart = (): Retry | undefined =>
      streamConv ? { kind: "continue", conversationId: streamConv, aKey } : resend;
    /** Na een fout: niet-opgeslagen tekst van de lopende ronde weghalen, lopende tools als mislukt tonen. */
    const rollback = () =>
      patch((a) => ({
        ...a,
        text: a.text.slice(0, a.roundStart ?? a.text.length),
        status: undefined,
        needsBreak: false,
        tools: a.tools.map((t) => (t.state === "running" ? { ...t, state: "failed" } : t)),
      }));
    const markStopped = () => {
      patch((a) => ({
        ...a,
        stopped: true,
        status: undefined,
        tools: a.tools.map((t) => (t.state === "running" ? { ...t, state: "stopped" } : t)),
      }));
      // Een schema of training kan alsnog zijn opgeslagen (de server maakt een tool-ronde af): lijsten later verversen.
      if (writing.size) {
        setTimeout(() => {
          invalidateFor("template");
          invalidateFor("workout");
        }, 2000);
      }
    };

    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        signal: ac.signal,
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify(body),
      });
      pulse.last = Date.now();
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => null)) as { error?: string; busy?: boolean; complete?: boolean } | null;
        finished = true;
        if (res.status === 409 && err?.busy && bodyConv && !opts.waited) {
          // Het vorige antwoord rondt nog af (bijv. net gestopt): even wachten en dan alsnog versturen.
          patch((a) => ({ ...a, status: "Wacht tot het vorige antwoord is afgerond…" }));
          waitingRef.current = true;
          const idle = await waitIdle(bodyConv, ac.signal, () => (pulse.last = Date.now())).finally(() => {
            waitingRef.current = false;
          });
          if (ac.signal.aborted) {
            dropIfEmpty();
            return;
          }
          if (idle) {
            handedOver = true;
            clearInterval(dog);
            return await runTurn(aKey, body, { ...opts, waited: true });
          }
        }
        if (res.status === 409 && err?.complete && bodyConv) {
          // Het antwoord was al af (bijv. op de achtergrond afgerond): gewoon tonen.
          dropIfEmpty();
          await reload(bodyConv);
          return;
        }
        dropIfEmpty();
        if (opts.reloadOnFail && bodyConv) await reload(bodyConv);
        failure =
          err?.error ?? (res.status >= 500 ? "De coach is even niet bereikbaar. Probeer het zo opnieuw." : "Er ging iets mis.");
        // Bij de daglimiet of een niet meer bestaand gesprek heeft opnieuw proberen geen zin.
        const final = res.status === 429 || res.status === 409 || res.status === 404;
        setError({ message: failure, retry: final ? undefined : resend });
        if (res.status === 429) setQuota((q) => (q ? { ...q, used: q.limit } : q));
        return;
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pulse.last = Date.now();
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let e: Record<string, unknown> & { t?: string };
          try {
            e = JSON.parse(line);
          } catch {
            continue;
          }
          if (e.t === "ping") continue;
          if (e.t === "text") {
            answer += e.d as string;
            queueText(e.d as string);
            continue;
          }
          // Andere events pas na de tekst die al binnen is, zodat de volgorde klopt.
          flush();
          switch (e.t) {
            case "conversation":
              streamConv = e.id as string;
              streamConvRef.current = streamConv;
              setConversationId(streamConv);
              // De meegestuurde gebeurtenissen staan nu in de vraag; alleen nieuwere bewaren.
              eventsRef.current = eventsRef.current.filter((x) => !sentEvents.includes(x));
              if (pendingStopRef.current) {
                pendingStopRef.current = false;
                void requestStop(streamConv);
                ac.abort("user");
              }
              break;
            case "quota":
              setQuota({ used: e.used as number, limit: e.limit as number });
              break;
            case "round":
              patch((a) => ({ ...a, roundStart: a.text.length, needsBreak: a.text.length > 0 }));
              break;
            case "commit":
              answerCommitted = answer.length;
              patch((a) => ({ ...a, roundStart: a.text.length }));
              break;
            case "reset_round":
              answer = answer.slice(0, answerCommitted);
              patch((a) => {
                const start = a.roundStart ?? 0;
                return {
                  ...a,
                  text: a.text.slice(0, start),
                  needsBreak: start > 0,
                  tools: a.tools.filter((t) => t.state !== "running"),
                };
              });
              break;
            case "status":
              patch((a) => ({ ...a, status: e.d as string }));
              break;
            case "tool":
              if (WRITE_TOOLS.has(e.name as string)) writing.add(e.id as string);
              patch((a) => ({
                ...a,
                tools: [...a.tools, { id: e.id as string, name: e.name as string, label: toolLabel(e.name as string), state: "running" }],
              }));
              break;
            case "tool_done":
              writing.delete(e.id as string);
              patch((a) => ({
                ...a,
                tools: a.tools.map((t) => (t.id === e.id ? { ...t, state: e.ok ? "done" : "failed" } : t)),
              }));
              break;
            case "artifact": {
              const art: Artifact = {
                kind: e.kind === "workout" ? "workout" : "template",
                link: e.link as string,
                title: e.title as string,
                detail: (e.detail as string) ?? "",
              };
              invalidateFor(art.kind);
              patch((a) => ({ ...a, artifacts: [...a.artifacts, art] }));
              break;
            }
            case "proposal": {
              const p = asProposal(e.data);
              const toolUseId = typeof e.id === "string" ? e.id : undefined;
              if (p) patch((a) => ({ ...a, proposals: [...a.proposals, { proposal: p, toolUseId }] }));
              break;
            }
            case "done":
              finished = true;
              break;
            case "stopped":
              finished = true;
              stoppedByServer = true;
              break;
            case "error":
              finished = true;
              failure = (e.message as string) || "Er ging iets mis.";
              break;
          }
        }
      }
      flush();
      if (stoppedByServer) {
        markStopped();
      } else if (failure) {
        rollback();
        dropIfEmpty();
        setError({ message: failure, retry: retryAfterStart() });
      } else if (!finished) {
        // Stream afgebroken zonder einde: het antwoord loopt op de server door.
        if (streamConv) recover = streamConv;
        else {
          rollback();
          dropIfEmpty();
          setError({ message: "De verbinding werd verbroken voordat het antwoord klaar was.", retry: resend });
        }
      } else {
        const text = plain(answer);
        setAnnouncement(text ? `Antwoord van de coach: ${text.slice(0, 600)}` : "De coach is klaar.");
      }
    } catch (err) {
      flush();
      const reason = ac.signal.aborted ? ac.signal.reason : null;
      if (reason === "user") {
        markStopped();
      } else if (reason === "leave") {
        // pagina verlaten: niets meer bijwerken
      } else if (streamConv) {
        recover = streamConv;
      } else {
        rollback();
        dropIfEmpty();
        setError({
          message:
            err instanceof TypeError || reason === "lost"
              ? "Geen verbinding. Controleer je internet en probeer het opnieuw."
              : "Er ging iets mis.",
          retry: resend,
        });
      }
    } finally {
      clearInterval(dog);
      if (raf) cancelAnimationFrame(raf);
      if (!handedOver) {
        if (!recover) {
          patch((a) => ({
            ...a,
            status: undefined,
            needsBreak: false,
            tools: a.tools.map((t) =>
              t.state === "running" ? { ...t, state: ac.signal.reason === "user" ? "stopped" : "failed" } : t,
            ),
          }));
        }
        if (abortRef.current === ac) abortRef.current = null;
        if (pulseRef.current === pulse) pulseRef.current = null;
        streamConvRef.current = null;
        setBusy(false);
      }
    }
    if (recover) await watch(recover);
  }

  /**
   * Verstuurt een vraag. `ctx`: weglaten = de context uit de deeplink, `null` = zonder context (bijv. een startvraag).
   * `replace`: de laatste vraag (en het antwoord) vervangen door deze.
   */
  function submit(raw: string, ctxArg?: Ctx | null, replace = false) {
    const message = raw.trim();
    if (!message || busy) return;
    const ctx = ctxArg === undefined ? pendingCtx : (ctxArg ?? undefined);
    const replacing = replace && !!conversationId;
    loadRef.current++;
    setLoading(false);
    setInput("");
    setPendingCtx(undefined);
    setEditing(false);

    const userKey = nextKey();
    const aKey = nextKey();
    setItems((prev) => {
      const cut = replacing ? prev.findLastIndex((it) => it.role === "user") : -1;
      const base = cut >= 0 ? prev.slice(0, cut) : prev;
      return [...base, { key: userKey, role: "user", text: message, tools: [], artifacts: [], proposals: [] }, emptyAssistant(aKey)];
    });
    atBottomRef.current = true;
    setShowJump(false);
    requestAnimationFrame(() => scrollToBottom(true));

    const events = eventsRef.current;
    void runTurn(
      aKey,
      {
        conversationId,
        message,
        context: { ...ctx, ...(events.length > 0 && { events }) },
        ...(replacing && { replace: "question" }),
      },
      { resend: { kind: "resend", userKey, text: message, ctx, replace: replacing }, sentEvents: events, reloadOnFail: replacing },
    );
  }

  function send(raw: string, ctxArg?: Ctx | null) {
    submit(raw, ctxArg, editing);
  }

  /** Nieuw antwoord op de laatste vraag (telt als vraag). */
  function regenerate() {
    if (busy || !conversationId) return;
    loadRef.current++;
    const aKey = nextKey();
    setItems((prev) => {
      const q = prev.findLastIndex((it) => it.role === "user");
      return [...prev.slice(0, q + 1), emptyAssistant(aKey)];
    });
    atBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom(true));
    void runTurn(aKey, { conversationId, replace: "answer" }, { resend: { kind: "regenerate" }, reloadOnFail: true });
  }

  function startEdit() {
    const last = items.findLast((it) => it.role === "user");
    if (!last || busy) return;
    setEditing(true);
    setInput(last.text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  function cancelEdit() {
    setEditing(false);
    setInput("");
  }

  function retryLast() {
    const r = error?.retry;
    if (!r || busy) return;
    if (r.kind === "load") {
      void openConversation(r.id);
    } else if (r.kind === "regenerate") {
      regenerate();
    } else if (r.kind === "resend") {
      // De mislukte vraag weghalen; submit() zet hem er opnieuw neer.
      setItems((prev) => prev.filter((it) => it.key !== r.userKey));
      submit(r.text, r.ctx ?? null, !!r.replace);
    } else {
      // Afmaken: de vraag staat al opgeslagen, dus niet opnieuw versturen. Zonder aKey: verder in het laatste antwoord.
      const last = items.at(-1);
      const aKey = r.aKey ?? (last?.role === "assistant" ? last.key : nextKey());
      setItems((prev) =>
        prev.some((it) => it.key === aKey)
          ? prev.map((it) =>
              it.key === aKey ? { ...it, stopped: false, roundStart: it.text.length, needsBreak: it.text.length > 0 } : it,
            )
          : [...prev, emptyAssistant(aKey)],
      );
      atBottomRef.current = true;
      requestAnimationFrame(() => scrollToBottom(true));
      void runTurn(aKey, { conversationId: r.conversationId, retry: true });
    }
  }

  function stop() {
    if (watching) {
      // Het antwoord loopt op de server: daar stoppen; het afwachten toont daarna het gestopte antwoord.
      if (conversationId) void requestStop(conversationId);
      stoppingRef.current = true;
      setItems((prev) => withPending(prev, "Stoppen…"));
      return;
    }
    const conv = streamConvRef.current;
    if (waitingRef.current) {
      abortRef.current?.abort("user");
      return;
    }
    if (conv) {
      void requestStop(conv);
      abortRef.current?.abort("user");
      return;
    }
    // De server heeft het gesprek nog niet doorgegeven: stoppen zodra dat binnenkomt (of uiterlijk na 4 s).
    pendingStopRef.current = true;
    const ac = abortRef.current;
    setTimeout(() => {
      if (pendingStopRef.current && abortRef.current === ac) {
        pendingStopRef.current = false;
        ac?.abort("user");
      }
    }, 4000);
  }

  /** Stopt het afwachten van een antwoord (bij wisselen van gesprek); het antwoord loopt op de server door. */
  function leaveWatch() {
    if (!watching) return;
    setWatching(false);
    setBusy(false);
  }

  /** Opent een gesprek; zonder id het laatst bijgewerkte. */
  async function openConversation(id?: string) {
    if (busy && !watching) return;
    const token = ++loadRef.current;
    leaveWatch();
    setHistoryOpen(false);
    setLoading(true);
    setError(null);
    if (editing) cancelEdit();
    eventsRef.current = [];
    try {
      const result = id ? { id, ...(await fetchConversation(id)) } : await fetchLatest();
      if (token !== loadRef.current) return;
      setConversationId(result?.id ?? null);
      setItems(result?.items ?? []);
      atBottomRef.current = true;
      requestAnimationFrame(() => scrollToBottom(false));
      setLoading(false);
      if (result?.open) void resumeOpen(result.id);
    } catch (e) {
      if (token !== loadRef.current) return;
      setError({ message: e instanceof Error ? e.message : "Gesprek laden mislukt.", retry: { kind: "load", id } });
      setLoading(false);
    }
  }

  function newConversation() {
    if (busy && !watching) return;
    loadRef.current++;
    leaveWatch();
    eventsRef.current = [];
    setConversationId(null);
    setItems([]);
    setError(null);
    if (editing) cancelEdit();
    setLoading(false);
    setPendingCtx(undefined);
    setHistoryOpen(false);
    textareaRef.current?.focus();
  }

  async function loadConversations() {
    setHistoryOpen(true);
    setHistoryError(null);
    setConfirmDelete(null);
    const { data, error: err } = await supabase
      .from("coach_conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (err) setHistoryError("Gesprekken laden mislukt. Probeer het opnieuw.");
    setConversations(data ?? []);
  }

  async function deleteConversation(id: string) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setConfirmDelete(null);
    const { error: err } = await supabase.from("coach_conversations").delete().eq("id", id);
    if (err) {
      setHistoryError("Verwijderen mislukt. Probeer het opnieuw.");
      return;
    }
    setConversations((prev) => prev?.filter((c) => c.id !== id) ?? null);
    if (id === conversationId) {
      loadRef.current++;
      leaveWatch();
      eventsRef.current = [];
      setConversationId(null);
      setItems([]);
      setError(null);
    }
  }

  // Stabiele callbacks, zodat oude berichten niet opnieuw renderen terwijl er een antwoord binnenstroomt.
  const copy = useCallback((key: string, text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(key);
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
      })
      .catch(() => {});
  }, []);
  const onPlanned = useCallback((note: string) => {
    eventsRef.current = [...eventsRef.current, note].slice(-5);
    setAnnouncement(note);
  }, []);

  const remaining = quota ? Math.max(0, quota.limit - quota.used) : null;
  const starters = startersFor(groups);
  const trainerGroup = trainerGroupOf(groups);
  const isTrainer = !!trainerGroup;

  const lastItem = items.at(-1);
  const lastUserIndex = items.findLastIndex((it) => it.role === "user");
  const canEdit = !busy && !!conversationId && lastUserIndex >= 0 && remaining !== 0;
  const followups = useMemo(() => {
    if (!lastItem || lastItem.role !== "assistant" || lastItem.stopped || !lastItem.text) return [];
    return followupsFor(
      lastItem.tools.filter((t) => t.state === "done").map((t) => t.name),
      {
        hasTemplate: lastItem.artifacts.some((a) => a.kind === "template"),
        hasWorkout: lastItem.artifacts.some((a) => a.kind === "workout"),
        hasProposal: lastItem.proposals.length > 0,
        trainerGroup: trainerGroup?.name,
      },
    );
  }, [lastItem, trainerGroup?.name]);

  return (
    <AppShell
      title="Coach"
      back="/"
      action={
        <div className="-my-1.5 flex gap-1">
          <button className="btn-ghost min-h-11 gap-1.5 px-2.5 text-xs" onClick={loadConversations} aria-label="Eerdere gesprekken">
            <ClockIcon size={14} /> Gesprekken
          </button>
          <button
            className="btn-ghost min-h-11 gap-1 px-2.5 text-xs"
            onClick={newConversation}
            disabled={(busy && !watching) || (items.length === 0 && !conversationId)}
            aria-label="Nieuw gesprek"
          >
            <PlusIcon size={14} /> Nieuw
          </button>
        </div>
      }
    >
      <style>{COMPOSER_CSS}</style>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <div className="flex min-h-[calc(100dvh-13rem)] flex-col">
        {loading ? (
          <div className="flex-1 space-y-4 pb-4" aria-busy="true" aria-label="Gesprek laden">
            <div className="skeleton ml-auto h-10 w-2/3 rounded-2xl" />
            <div className="space-y-2">
              <div className="skeleton h-5 w-20" />
              <div className="skeleton h-28 w-11/12 rounded-2xl" />
            </div>
            <div className="skeleton ml-auto h-10 w-1/2 rounded-2xl" />
            <div className="skeleton h-20 w-10/12 rounded-2xl" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col justify-center space-y-5 py-6">
            <div className="animate-fade-up text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
                <SparkleIcon size={28} />
              </div>
              <h2 className="text-xl font-bold">Je AI-coach</h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
                {isTrainer
                  ? "Stelt groepstrainingen voor met startgewichten per persoon, die jij met één tik klaarzet. Checkt ook hoe je vrienden ervoor staan."
                  : "Maakt schema's, kijkt je trainingen na en volgt je progressie op basis van je echte sets."}{" "}
                Je voeding blijft privé.
              </p>
              {remaining != null && quota && (
                <p className="mt-2 text-xs text-muted">
                  {remaining} van {quota.limit} vragen over vandaag
                </p>
              )}
            </div>
            <div className="grid gap-2">
              {starters.map((s, i) => (
                <button
                  key={s}
                  onClick={() => submit(s, null)}
                  disabled={busy || remaining === 0}
                  style={{ "--i": i + 1 } as React.CSSProperties}
                  className="card animate-fade-up flex min-h-12 items-center gap-3 p-3 text-left text-sm transition-colors hover:border-accent active:scale-[0.99] disabled:opacity-50"
                >
                  <span className="flex-1">{s}</span>
                  <ChevronRightIcon size={16} className="shrink-0 text-muted" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-5 pb-4" role="log" aria-label="Gesprek met de coach" aria-live="off">
            {items.map((m, i) =>
              m.role === "user" ? (
                <div key={m.key} className="animate-fade-up flex flex-col items-end gap-0.5">
                  <div
                    className={`w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-accent-ink transition-opacity ${
                      editing && i === lastUserIndex ? "opacity-50" : ""
                    }`}
                  >
                    <span className="sr-only">Jij: </span>
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  </div>
                  {i === lastUserIndex && canEdit && !editing && (
                    <button
                      onClick={startEdit}
                      className="-mb-2 inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 text-xs text-muted hover:text-ink"
                      aria-label="Laatste vraag bewerken"
                    >
                      <PencilIcon /> Bewerken
                    </button>
                  )}
                </div>
              ) : (
                <AssistantMessage
                  key={m.key}
                  item={m}
                  live={busy && i === items.length - 1}
                  copied={copied === m.key}
                  conversationId={conversationId}
                  onCopy={copy}
                  onPlanned={onPlanned}
                  onRegenerate={i === items.length - 1 && canEdit && lastUserIndex === i - 1 ? regenerate : undefined}
                />
              ),
            )}
            {!busy && followups.length > 0 && (
              <div className="flex flex-wrap gap-2" aria-label="Vervolgvragen">
                {followups.map((f, i) => (
                  <button
                    key={f}
                    onClick={() => submit(f, null)}
                    disabled={remaining === 0}
                    style={{ "--i": i + 1 } as React.CSSProperties}
                    className="animate-fade-up inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-left text-[13px] leading-snug transition-colors hover:border-accent active:scale-[0.98] disabled:opacity-50"
                  >
                    <span>{f}</span>
                    <ChevronRightIcon size={13} className="shrink-0 text-muted" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="animate-fade-in mb-2 flex items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            <p className="flex-1">{error.message}</p>
            {error.retry && (
              <button
                onClick={retryLast}
                disabled={busy}
                className="-my-1 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 font-semibold hover:bg-danger/10"
              >
                <RefreshIcon size={14} />
                {error.retry.kind === "continue" ? "Verder gaan" : error.retry.kind === "load" ? "Opnieuw laden" : "Opnieuw"}
              </button>
            )}
          </div>
        )}

        <div className="coach-composer sticky bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] z-10 -mx-4 bg-bg px-4 pb-2 pt-1 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-4 before:bg-gradient-to-t before:from-bg before:to-transparent after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-6 after:bg-bg">
          {showJump && items.length > 0 && (
            <button
              onClick={() => {
                atBottomRef.current = true;
                setShowJump(false);
                scrollToBottom(true);
              }}
              className="animate-scale-in absolute -top-13 left-1/2 z-10 flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-xs font-medium shadow-lg"
            >
              <ArrowDownIcon size={14} /> Naar beneden
            </button>
          )}
          {editing && (
            <div className="animate-fade-in flex items-center gap-2 px-1 pb-1 text-xs text-muted">
              <PencilIcon />
              <span className="flex-1">Vraag bewerken. Het oude antwoord wordt vervangen.</span>
              <button onClick={cancelEdit} className="-my-2 min-h-11 rounded-md px-2 font-semibold text-ink hover:bg-surface">
                Annuleren
              </button>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className={`flex items-end gap-2 rounded-2xl border bg-surface/60 p-1.5 pl-3 transition-colors focus-within:border-accent/60 ${
              editing ? "border-accent/50" : "border-line"
            }`}
          >
            <label htmlFor="coach-input" className="sr-only">
              {editing ? "Bewerkte vraag aan coach" : "Bericht aan coach"}
            </label>
            <textarea
              id="coach-input"
              ref={textareaRef}
              className="max-h-40 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-base text-ink outline-none placeholder:text-muted/70"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => {
                if (atBottomRef.current) requestAnimationFrame(() => scrollToBottom(false));
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && editing) {
                  e.preventDefault();
                  cancelEdit();
                  return;
                }
                // Op een toetsenbord met muis verstuurt Enter; op een telefoon geeft Enter een nieuwe regel.
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  window.matchMedia("(pointer: fine)").matches
                ) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={
                editing ? "Pas je vraag aan…" : pendingCtx?.workout_id ? "Vraag iets over deze training…" : "Vraag iets aan je coach…"
              }
              maxLength={4000}
              enterKeyHint="enter"
            />
            {busy ? (
              <button
                type="button"
                onClick={stop}
                className="btn-ghost h-11 w-11 shrink-0 p-0"
                aria-label="Antwoord stoppen"
                title="Stoppen"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
                  <rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                className="btn-primary h-11 w-11 shrink-0 p-0"
                disabled={!input.trim() || remaining === 0}
                aria-label={editing ? "Bewerkte vraag versturen" : "Versturen"}
                title="Versturen"
              >
                {editing ? <CheckIcon size={18} strokeWidth={2.4} /> : <ArrowUpIcon size={18} strokeWidth={2.4} />}
              </button>
            )}
          </form>
          {remaining != null && remaining <= 10 && items.length > 0 && (
            <p className="mt-1 text-center text-[11px] text-muted" aria-live="polite">
              {remaining === 0 ? "Je vragen voor vandaag zijn op" : `${remaining} van ${quota?.limit} vragen over vandaag`}
            </p>
          )}
        </div>
      </div>

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="Eerdere gesprekken">
        {historyError && (
          <div className="mb-3 flex items-center gap-3 text-sm text-danger" role="alert">
            <p className="flex-1">{historyError}</p>
            <button onClick={loadConversations} className="min-h-11 shrink-0 px-2 font-semibold underline underline-offset-2">
              Opnieuw
            </button>
          </div>
        )}
        {conversations === null ? (
          <ul className="space-y-3" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <div className="skeleton h-5 flex-1" />
                <div className="skeleton h-4 w-14" />
              </li>
            ))}
          </ul>
        ) : conversations.length === 0 ? (
          !historyError && (
            <div className="py-6 text-center text-sm text-muted">
              Nog geen gesprekken. Stel je eerste vraag aan de coach.
            </div>
          )
        ) : (
          <ul className="divide-y divide-line">
            {conversations.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <button
                  onClick={() => openConversation(c.id)}
                  disabled={busy && !watching}
                  className="flex min-h-12 min-w-0 flex-1 items-baseline justify-between gap-3 py-3 text-left disabled:opacity-50"
                  aria-current={c.id === conversationId ? "true" : undefined}
                >
                  <span className={`truncate ${c.id === conversationId ? "font-semibold text-accent" : ""}`}>{c.title}</span>
                  <span className="shrink-0 text-xs text-muted">{timeAgo(c.updated_at)}</span>
                </button>
                <button
                  onClick={() => deleteConversation(c.id)}
                  disabled={busy && c.id === conversationId}
                  className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg px-2 text-xs transition-colors ${
                    confirmDelete === c.id ? "bg-danger/15 font-semibold text-danger" : "text-muted hover:text-danger"
                  }`}
                  aria-label={confirmDelete === c.id ? `Definitief verwijderen: ${c.title}` : `Verwijder gesprek: ${c.title}`}
                >
                  {confirmDelete === c.id ? "Verwijderen?" : <TrashIcon />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </AppShell>
  );
}

// ───────── Onderdelen ─────────

/** Markdown apart gememoized: alleen opnieuw parsen als de tekst echt verandert. */
const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN}>
      {text}
    </ReactMarkdown>
  );
});

const AssistantMessage = memo(function AssistantMessage({
  item,
  live,
  copied,
  conversationId,
  onCopy,
  onPlanned,
  onRegenerate,
}: {
  item: ChatItem;
  live: boolean;
  copied: boolean;
  conversationId: string | null;
  onCopy: (key: string, text: string) => void;
  onPlanned: (note: string) => void;
  /** Alleen bij het laatste antwoord: een nieuw antwoord laten maken. */
  onRegenerate?: () => void;
}) {
  // Gelijke tools samenvoegen ("Progressie bekijken ×3").
  const chips = new Map<string, { count: number; running: boolean; failed: boolean; stopped: boolean }>();
  for (const t of item.tools) {
    const c = chips.get(t.label) ?? { count: 0, running: false, failed: true, stopped: false };
    chips.set(t.label, {
      count: c.count + 1,
      running: c.running || t.state === "running",
      failed: c.failed && t.state === "failed",
      stopped: c.stopped || t.state === "stopped",
    });
  }
  const runningTool = item.tools.find((t) => t.state === "running");
  const waiting = live && (!!item.pending || !item.text || !!item.needsBreak || !!runningTool);
  const statusText = item.status ?? (runningTool ? `${runningTool.label}…` : item.text ? "Even verder kijken…" : "Denkt na…");

  return (
    <div className="animate-fade-up space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-accent" aria-hidden>
          <SparkleIcon size={13} />
        </span>
        Coach
      </div>

      {chips.size > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {[...chips].map(([label, c]) => (
            <span key={label} className="chip animate-fade-in gap-1.5">
              {c.running ? (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
              ) : c.failed ? (
                <CloseIcon size={12} className="text-warn" />
              ) : c.stopped ? (
                <span className="h-0.5 w-2 rounded-full bg-muted" aria-hidden />
              ) : (
                <CheckIcon size={12} className="text-accent" />
              )}
              {label}
              {c.count > 1 && <span className="text-muted">×{c.count}</span>}
              <span className="sr-only">
                {c.running ? "(bezig)" : c.failed ? "(mislukt)" : c.stopped ? "(gestopt)" : "(klaar)"}
              </span>
            </span>
          ))}
        </div>
      )}

      {item.text && (
        <div className="coach-md break-words rounded-2xl rounded-tl-md bg-surface px-4 py-3 text-sm">
          <Markdown text={item.text} />
        </div>
      )}

      {waiting && (
        <div className="flex items-center gap-2.5 px-1 text-sm text-muted" role="status">
          <span className="flex gap-1" aria-hidden>
            {[0, 1, 2].map((d) => (
              <span
                key={d}
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
                style={{ animationDelay: `${d * 160}ms` }}
              />
            ))}
          </span>
          <span className="line-clamp-2">{statusText}</span>
        </div>
      )}

      {item.proposals.map((p, i) => (
        <ProposalCard
          key={p.toolUseId ?? `${p.proposal.group_id}:${p.proposal.date}:${p.proposal.title}:${i}`}
          item={p}
          conversationId={conversationId}
          onPlanned={onPlanned}
        />
      ))}

      {item.artifacts.map((a) => (
        <Link
          key={a.link}
          href={a.link}
          className="card animate-scale-in flex items-center gap-3 p-3 transition-colors hover:border-accent active:scale-[0.99]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
            {a.kind === "template" ? <ClipboardIcon size={20} /> : <CalendarIcon size={20} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted">{a.kind === "template" ? "Schema opgeslagen" : "Training klaargezet"}</span>
            <span className="block truncate font-semibold">{a.title}</span>
            {a.detail && <span className="block truncate text-xs text-muted">{a.detail}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-accent">
            Openen <ChevronRightIcon size={14} />
          </span>
        </Link>
      ))}

      {!live && (item.stopped || item.text || onRegenerate) && (
        <div className="flex items-center gap-3 px-1 text-xs text-muted">
          {item.stopped && <span>Gestopt</span>}
          {item.text && (
            <button
              onClick={() => onCopy(item.key, item.text)}
              className="-my-2.5 -ml-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 hover:text-ink"
              aria-label={copied ? "Antwoord gekopieerd" : "Antwoord kopiëren"}
            >
              {copied ? <CheckIcon size={13} className="text-accent" /> : <CopyIcon />}
              {copied ? "Gekopieerd" : "Kopieer"}
            </button>
          )}
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className="-my-2.5 inline-flex min-h-11 items-center gap-1 rounded-md px-1 hover:text-ink"
              aria-label="Nieuw antwoord laten maken (telt als vraag)"
              title="Nieuw antwoord (telt als vraag)"
            >
              <RefreshIcon size={13} /> Opnieuw
            </button>
          )}
        </div>
      )}
    </div>
  );
});

/** Notitie per oefening voor de groep: tip van de coach plus de startgewichten per persoon. */
function exerciseNotes(e: ProposalEx) {
  const start = e.targets?.length ? `Start: ${e.targets.map((t) => `${t.name} ${t.target}`).join(", ")}` : "";
  return [e.notes, start].filter(Boolean).join(" · ") || undefined;
}

/**
 * Bewaart bij het tool-resultaat in het gesprek dat dit voorstel is klaargezet (en hoe), zodat de kaart
 * dat na herladen precies weet. Het resultaat kan nog niet opgeslagen zijn als je tijdens het antwoord
 * al klaarzet; dan even later nog eens proberen.
 */
async function persistPlanned(conversationId: string, toolUseId: string, planned: Planned) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await supabase
      .from("coach_messages")
      .select("seq, content")
      .eq("conversation_id", conversationId)
      .eq("kind", "tool_results")
      // jsonb-bevat: als JSON-tekst meegeven (een array zou als Postgres-array worden verstuurd).
      .contains("content", JSON.stringify([{ tool_use_id: toolUseId }]))
      .limit(1);
    const row = data?.[0];
    if (!error && row && Array.isArray(row.content)) {
      const content = (row.content as StoredBlock[]).map((b) => (b.tool_use_id === toolUseId ? { ...b, planned } : b));
      await supabase.from("coach_messages").update({ content }).eq("seq", row.seq);
      return;
    }
    await sleep(2500);
  }
}

type CardState =
  | { s: "idle" }
  | { s: "saving" }
  | { s: "done"; workoutId: string; date: string; existing: boolean }
  | { s: "error"; message: string };

/**
 * Voorstel voor een groepstraining. Niets staat klaar tot de trainer zelf op de knop drukt. Datum,
 * titel, oefeningen, sets en reps zijn nog aan te passen; de startgewichten per persoon gaan als
 * notitie mee naar de training. De klaargezette staat wordt bij het voorstel bewaard.
 */
function ProposalCard({
  item,
  conversationId,
  onPlanned,
}: {
  item: ProposalItem;
  conversationId: string | null;
  onPlanned: (note: string) => void;
}) {
  const { proposal, planned, toolUseId } = item;
  const today = todayAmsterdam();
  const [date, setDate] = useState(() => (proposal.date < today ? today : proposal.date));
  const [title, setTitle] = useState(() => planned?.title ?? proposal.title);
  const [exercises, setExercises] = useState<ProposalEx[]>(() => planned?.exercises ?? proposal.exercises);
  const [editing, setEditing] = useState(false);
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  const [state, setState] = useState<CardState>(() =>
    planned ? { s: "done", workoutId: planned.workout_id, date: planned.date, existing: true } : { s: "idle" },
  );

  // Klaargezet op een ander apparaat of in een eerdere sessie (komt binnen bij herladen van het gesprek).
  const [seenPlanned, setSeenPlanned] = useState(planned?.workout_id);
  if (planned?.workout_id !== seenPlanned) {
    setSeenPlanned(planned?.workout_id);
    if (planned && state.s !== "done") {
      setState({ s: "done", workoutId: planned.workout_id, date: planned.date, existing: true });
      if (planned.title) setTitle(planned.title);
      if (planned.exercises) setExercises(planned.exercises);
    }
  }

  // Oudere gesprekken (zonder bewaarde staat): alleen een training met precies dezelfde groep, datum,
  // titel en oefeningen telt als "al klaargezet". Een wekelijkse "Benen" van vorige week dus niet.
  const plannedId = planned?.workout_id;
  const { group_id: groupId, title: proposedTitle, date: proposedDate } = proposal;
  const slugs = proposal.exercises.map((e) => e.slug).join(",");
  useEffect(() => {
    if (plannedId) return;
    let cancelled = false;
    supabase
      .from("workouts")
      .select("id, date, workout_exercises(exercise_slug, position)")
      .eq("group_id", groupId)
      .eq("title", proposedTitle)
      .eq("date", proposedDate)
      .limit(3)
      .then(({ data }) => {
        if (cancelled) return;
        const match = (data ?? []).find(
          (w) =>
            [...((w.workout_exercises ?? []) as { exercise_slug: string; position: number }[])]
              .sort((a, b) => a.position - b.position)
              .map((x) => x.exercise_slug)
              .join(",") === slugs,
        );
        if (match) {
          setState((s) => (s.s === "idle" ? { s: "done", workoutId: match.id as string, date: match.date as string, existing: true } : s));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [plannedId, groupId, proposedTitle, proposedDate, slugs]);

  const changed = title !== proposal.title || JSON.stringify(exercises) !== JSON.stringify(proposal.exercises);
  const valid = title.trim().length > 0 && exercises.length > 0 && exercises.every((e) => e.reps.trim().length > 0);

  function update(i: number, patch: Partial<ProposalEx>) {
    setExercises((list) => list.map((e, j) => (j === i ? { ...e, ...patch } : e)));
    if (state.s === "error") setState({ s: "idle" });
  }

  async function plan() {
    setState({ s: "saving" });
    setEditing(false);
    const finalTitle = title.trim();
    const r = await planGroupWorkout(supabase, {
      group_id: proposal.group_id,
      date,
      title: finalTitle,
      notes: proposal.notes,
      exercises: exercises.map((e) => ({ slug: e.slug, sets: e.sets, reps: e.reps.trim(), notes: exerciseNotes(e) })),
    });
    if ("error" in r) {
      setState({ s: "error", message: r.error });
      return;
    }
    invalidateFor("workout");
    setState({ s: "done", workoutId: r.workout_id, date: r.date, existing: !!r.existing });
    if (conversationId && toolUseId) {
      void persistPlanned(conversationId, toolUseId, {
        workout_id: r.workout_id,
        date: r.date,
        ...(changed && { title: finalTitle, exercises }),
      });
    }
    onPlanned(
      `De trainer heeft je voorstel "${r.title}" voor ${r.group} op ${r.date} klaargezet via de kaart in de chat` +
        `${changed ? " (zelf aangepast)" : ""} (workout_id ${r.workout_id}).`,
    );
  }

  const totalSets = exercises.reduce((n, e) => n + e.sets, 0);
  const done = state.s === "done";
  const saving = state.s === "saving";

  return (
    <section
      className={`card animate-scale-in overflow-hidden p-0 transition-colors ${done ? "border-accent/50" : editing ? "border-accent/40" : ""}`}
      aria-label={`Voorstel: ${title} voor ${proposal.group}`}
    >
      <div className="flex items-start gap-3 p-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <CalendarIcon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">
            {done ? "Training klaargezet" : "Voorstel groepstraining"}
            {changed && <span className="ml-1.5 rounded-full bg-accent/15 px-1.5 py-px text-[10px] font-semibold text-accent">Aangepast</span>}
          </p>
          {editing ? (
            <label className="mt-1 block">
              <span className="sr-only">Titel</span>
              <input className="input min-h-11 py-2 font-semibold" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
            </label>
          ) : (
            <p className="truncate font-semibold">{title}</p>
          )}
          <p className="truncate text-xs text-muted">
            {proposal.group} · {exercises.length} oefeningen · {totalSets} sets
          </p>
        </div>
        {!done && (
          <button
            onClick={() => setEditing((v) => !v)}
            disabled={saving}
            className={`-mr-1 -mt-1 min-h-11 shrink-0 rounded-lg px-2.5 text-xs font-semibold transition-colors ${
              editing ? "bg-accent text-accent-ink" : "text-accent hover:bg-accent/10"
            }`}
            aria-expanded={editing}
          >
            {editing ? "Klaar" : "Aanpassen"}
          </button>
        )}
      </div>

      <ol className="divide-y divide-line border-y border-line bg-surface-2/40 text-sm">
        {exercises.map((e, i) =>
          editing ? (
            <li key={`${e.slug}:${i}`} className="animate-fade-in space-y-2 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{e.name}</span>
                <button
                  onClick={() => setSwapIndex(i)}
                  className="-my-1 min-h-11 shrink-0 rounded-lg px-2 text-xs font-semibold text-accent hover:bg-accent/10"
                  aria-label={`Wissel ${e.name}`}
                >
                  Wissel
                </button>
                <button
                  onClick={() => setExercises((list) => list.filter((_, j) => j !== i))}
                  disabled={exercises.length <= 1}
                  className="-my-1 -mr-1 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:text-danger disabled:opacity-30"
                  aria-label={`Verwijder ${e.name}`}
                >
                  <CloseIcon size={16} />
                </button>
              </div>
              <div className="flex items-center gap-2 pl-6">
                <div className="w-36 shrink-0">
                  <Stepper value={e.sets} onChange={(v) => update(i, { sets: v })} min={1} max={10} label={`Sets voor ${e.name}`} suffix="sets" />
                </div>
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Reps voor {e.name}</span>
                  <input
                    className="input min-h-11 py-2 text-center"
                    value={e.reps}
                    maxLength={20}
                    placeholder="reps"
                    aria-invalid={!e.reps.trim() || undefined}
                    onChange={(ev) => update(i, { reps: ev.target.value })}
                  />
                </label>
              </div>
            </li>
          ) : (
            <li key={`${e.slug}:${i}`} className="flex items-baseline gap-3 px-3 py-2">
              <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{e.name}</span>
                {e.notes && <span className="block text-xs text-muted">{e.notes}</span>}
                {!!e.targets?.length && (
                  <span className="mt-1 flex flex-wrap gap-1" aria-label={`Startgewichten voor ${e.name}`}>
                    {e.targets.map((t) => (
                      <span key={t.name} className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] tabular-nums text-muted">
                        <span className="font-medium text-ink">{t.name}</span> {t.target}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs font-medium tabular-nums text-muted">
                {e.sets} × {e.reps}
              </span>
            </li>
          ),
        )}
      </ol>
      {editing && changed && (
        <div className="flex justify-end px-3 pt-1.5">
          <button
            onClick={() => {
              setTitle(proposal.title);
              setExercises(proposal.exercises);
            }}
            className="min-h-11 rounded-lg px-2 text-xs text-muted hover:text-ink"
          >
            Origineel herstellen
          </button>
        </div>
      )}
      {proposal.notes && !editing && <p className="px-3 pt-2.5 text-xs text-muted">{proposal.notes}</p>}

      <div className="p-3">
        {done ? (
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 animate-pop items-center justify-center rounded-full bg-accent text-accent-ink">
              <CheckIcon size={15} strokeWidth={2.6} />
            </span>
            <p className="min-w-0 flex-1 text-[13px] leading-snug">
              {state.existing ? "Staat klaar" : "Klaargezet"} voor <span className="font-semibold">{formatShortDate(state.date)}</span>
            </p>
            <Link
              href={`/groups/${proposal.group_id}/plan?edit=${state.workoutId}`}
              className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-xs font-semibold text-muted hover:text-ink"
            >
              Bewerken
            </Link>
            <Link href={`/workouts/${state.workoutId}`} className="btn-ghost min-h-11 shrink-0 gap-1 px-3 text-xs">
              Openen <ChevronRightIcon size={14} />
            </Link>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="label">Datum</span>
              <input
                type="date"
                className="input min-h-11"
                value={date}
                min={today}
                onChange={(e) => {
                  setDate(e.target.value);
                  if (state.s === "error") setState({ s: "idle" });
                }}
                disabled={saving}
              />
            </label>
            <button onClick={plan} disabled={saving || !date || date < today || !valid} className="btn-primary min-h-11 shrink-0 px-4">
              {saving ? "Bezig…" : "Klaarzetten"}
            </button>
          </div>
        )}
        {state.s === "error" && (
          <p className="animate-fade-in mt-2 text-xs text-danger" role="alert">
            {state.message}
          </p>
        )}
        {state.s === "idle" && (
          <p className="mt-2 text-[11px] text-muted">
            {exercises.some((e) => e.targets?.length)
              ? "De startgewichten gaan als notitie mee. Pas na Klaarzetten zien je vrienden de training."
              : "Pas na Klaarzetten zien je vrienden de training."}
          </p>
        )}
      </div>

      <SwapSheet
        slug={swapIndex != null ? (exercises[swapIndex]?.slug ?? null) : null}
        onClose={() => setSwapIndex(null)}
        onPick={(ex) => {
          if (swapIndex != null) update(swapIndex, { slug: ex.slug, name: ex.name, targets: undefined, notes: undefined });
          setSwapIndex(null);
        }}
      />
    </section>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 012-2h9" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </svg>
  );
}
