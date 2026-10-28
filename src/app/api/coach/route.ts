import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { COACH_SYSTEM, coachContext } from "@/lib/coach/prompt";
import { runTool, TOOL_DEFINITIONS, toolLabel } from "@/lib/coach/tools";

// Een antwoord met meerdere tool-rondes kan even duren.
export const maxDuration = 300;

const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 12;
/** Maximaal aantal vragen per persoon per dag, zodat je API-tegoed niet ongemerkt opgaat. */
const DAILY_LIMIT = Number(process.env.COACH_DAILY_LIMIT ?? 40);

type Block = Anthropic.Beta.BetaContentBlock;
type Event =
  | { t: "conversation"; id: string }
  | { t: "text"; d: string }
  | { t: "tool"; name: string; label: string }
  | { t: "done" }
  | { t: "error"; message: string };

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY ontbreekt in .env.local." }, { status: 500 });
  }

  // ── Inloggen: Supabase-token van de gebruiker; alle databasetoegang loopt via RLS als deze gebruiker. ──
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Niet ingelogd." }, { status: 401 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await sb.auth.getUser(token);
  if (!auth.user) return Response.json({ error: "Sessie verlopen, log opnieuw in." }, { status: 401 });
  const userId = auth.user.id;

  const body = (await req.json().catch(() => null)) as { conversationId?: string; message?: string } | null;
  const message = body?.message?.trim();
  if (!message || message.length > 4000) {
    return Response.json({ error: "Stuur een bericht van maximaal 4000 tekens." }, { status: 400 });
  }

  // ── Daglimiet ──
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count } = await sb
    .from("coach_messages")
    .select("seq", { count: "exact", head: true })
    .eq("kind", "text")
    .gte("created_at", startOfDay.toISOString());
  if ((count ?? 0) >= DAILY_LIMIT) {
    return Response.json({ error: `Je hebt vandaag al ${DAILY_LIMIT} vragen gesteld. Morgen weer!` }, { status: 429 });
  }

  // ── Gesprek ophalen of aanmaken ──
  let conversationId = body?.conversationId;
  if (conversationId) {
    const { data } = await sb.from("coach_conversations").select("id").eq("id", conversationId).maybeSingle();
    if (!data) conversationId = undefined;
  }
  if (!conversationId) {
    const { data, error } = await sb
      .from("coach_conversations")
      .insert({ title: message.slice(0, 60) })
      .select("id")
      .single();
    if (error) return Response.json({ error: `Gesprek aanmaken mislukt: ${error.message}` }, { status: 500 });
    conversationId = data.id as string;
  }

  const { data: history } = await sb
    .from("coach_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("seq");
  const messages: Anthropic.Beta.BetaMessageParam[] = (history ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Werd een vorig antwoord afgebroken na een tool-aanroep, dan ontbreken de tool-resultaten;
  // vul ze aan (de geschiedenis zelf passen we niet aan, we voegen alleen toe).
  const last = messages.at(-1);
  if (last?.role === "assistant" && Array.isArray(last.content)) {
    const open = (last.content as Block[]).filter((b) => b.type === "tool_use") as Anthropic.Beta.BetaToolUseBlock[];
    if (open.length) {
      const results = open.map((tu) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: "Onderbroken; niet uitgevoerd.",
        is_error: true,
      }));
      messages.push({ role: "user", content: results });
      await save(sb, conversationId, "user", "tool_results", results);
    }
  }

  const userTurn: Anthropic.Beta.BetaMessageParam = { role: "user", content: [{ type: "text", text: message }] };
  messages.push(userTurn);
  await save(sb, conversationId, "user", "text", userTurn.content);

  const { data: profile } = await sb.from("profiles").select("*").eq("id", userId).single();
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    // Vaste prompt eerst (cachebaar), daarna de per-gebruiker/per-dag context.
    { type: "text", text: COACH_SYSTEM },
    { type: "text", text: coachContext(profile, userId) },
  ];

  const client = new Anthropic();
  const encoder = new TextEncoder();
  const convId = conversationId;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: Event) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      send({ t: "conversation", id: convId });

      try {
        let jsonRetries = 0;
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const response = client.beta.messages.stream({
            model: MODEL,
            max_tokens: 32000,
            output_config: { effort: "medium" },
            system,
            tools: TOOL_DEFINITIONS,
            messages,
            // Cachet de hele prefix (tools + system + geschiedenis) automatisch.
            cache_control: { type: "ephemeral" },
            // Weigert het model een vraag, dan probeert de API het zelf op een ander model.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          });
          response.on("text", (delta) => send({ t: "text", d: delta }));

          let final: Anthropic.Beta.BetaMessage;
          try {
            final = await response.finalMessage();
            jsonRetries = 0;
          } catch (err) {
            // Alleen een onleesbare tool-invoer (eager streaming) opnieuw proberen; API-fouten gaan door.
            if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
            continue;
          }

          if (final.stop_reason === "refusal") {
            send({ t: "text", d: "\n\n_Hier kan ik je helaas niet mee helpen._" });
            break;
          }

          const content = replayable(final.content);
          messages.push({ role: "assistant", content });
          await save(sb, convId, "assistant", "assistant", content);

          const toolUses = content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
          if (final.stop_reason !== "tool_use" || toolUses.length === 0) break;
          if (final.stop_reason === "tool_use" && round === MAX_TOOL_ROUNDS - 1) {
            send({ t: "text", d: "\n\n_Dit werd te complex voor één antwoord; stel je vraag iets specifieker._" });
            break;
          }

          // Alle tool-resultaten samen in één bericht terug (zodat parallelle tool-calls blijven werken).
          const results = await Promise.all(
            toolUses.map(async (tu) => {
              send({ t: "tool", name: tu.name, label: toolLabel(tu.name) });
              const r = await runTool(tu.name, tu.input, { sb, userId });
              return {
                type: "tool_result" as const,
                tool_use_id: tu.id,
                content: r.content,
                is_error: r.isError,
              };
            }),
          );
          messages.push({ role: "user", content: results });
          await save(sb, convId, "user", "tool_results", results);
        }

        await sb.from("coach_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
        send({ t: "done" });
      } catch (err) {
        send({ t: "error", message: describeError(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
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

async function save(
  sb: SupabaseClient,
  conversationId: string,
  role: "user" | "assistant",
  kind: "text" | "assistant" | "tool_results",
  content: unknown,
) {
  const { error } = await sb.from("coach_messages").insert({ conversation_id: conversationId, role, kind, content });
  if (error) throw new Error(`Opslaan mislukt: ${error.message}`);
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "De API-key klopt niet. Check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.PermissionDeniedError) return "Geen toegang met deze API-key.";
  if (err instanceof Anthropic.RateLimitError) return "Even te veel verzoeken tegelijk. Probeer het zo opnieuw.";
  if (err instanceof Anthropic.BadRequestError) {
    return err.message.includes("credit") ? "Je API-tegoed is op." : `Ongeldig verzoek: ${err.message}`;
  }
  if (err instanceof Anthropic.APIError) return `De AI is even niet bereikbaar (${err.status ?? "netwerk"}).`;
  return err instanceof Error ? err.message : "Er ging iets mis.";
}
