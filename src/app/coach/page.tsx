"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AppShell } from "@/components/AppShell";
import { Sheet } from "@/components/Sheet";
import { timeAgo } from "@/lib/dates";
import { supabase } from "@/lib/supabase";
import { CheckIcon, SparkleIcon } from "@/components/Icons";

type ChatItem = { role: "user" | "assistant"; text: string; tools: string[] };
type Conversation = { id: string; title: string; updated_at: string };
type StoredBlock = { type: string; text?: string; name?: string };

const TOOL_LABELS: Record<string, string> = {
  search_exercises: "Oefeningen zoeken",
  get_exercise: "Oefening bekijken",
  analyze_plan: "Spieren analyseren",
  list_my_groups: "Groepen bekijken",
  list_workouts: "Trainingen bekijken",
  get_workout: "Training nakijken",
  get_training_log: "Trainingslog bekijken",
  get_exercise_history: "Progressie bekijken",
  list_templates: "Schema's bekijken",
  save_template: "Schema opslaan",
  plan_group_workout: "Training klaarzetten",
  get_strength_ranks: "Ranks bekijken",
  get_nutrition: "Voeding bekijken",
};

const STARTERS = [
  "Maak een push-dag schema voor me van ongeveer een uur",
  "Kijk mijn laatste training na",
  "Hoe gaat mijn progressie op de bench press?",
  "Welke spieren heb ik de afgelopen 2 weken te weinig getraind?",
  "Hoe kom ik het snelst naar een hogere rang op de bench press?",
  "Haal ik genoeg eiwit binnen voor mijn doel?",
];

export default function CoachPage() {
  return (
    <Suspense>
      <Coach />
    </Suspense>
  );
}

function Coach() {
  const params = useSearchParams();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState(params.get("q") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Laatste gesprek laden (tenzij er een nieuwe vraag via ?q= binnenkomt).
  useEffect(() => {
    if (params.get("q")) return;
    supabase
      .from("coach_conversations")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => data && openConversation(data.id));
  }, [params]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items]);

  async function openConversation(id: string) {
    const { data } = await supabase
      .from("coach_messages")
      .select("role, kind, content")
      .eq("conversation_id", id)
      .order("seq");
    const list: ChatItem[] = [];
    for (const m of data ?? []) {
      const blocks = m.content as StoredBlock[];
      if (m.kind === "text") {
        list.push({ role: "user", text: blocks.map((b) => b.text ?? "").join(""), tools: [] });
      } else if (m.kind === "assistant") {
        // Opeenvolgende assistent-berichten (tool-rondes) samenvoegen tot één antwoord.
        const prev = list.at(-1);
        const item = prev?.role === "assistant" ? prev : { role: "assistant" as const, text: "", tools: [] };
        if (item !== prev) list.push(item);
        for (const b of blocks) {
          if (b.type === "text" && b.text) item.text += (item.text ? "\n\n" : "") + b.text;
          if (b.type === "tool_use" && b.name) item.tools.push(TOOL_LABELS[b.name] ?? b.name);
        }
      }
    }
    setConversationId(id);
    setItems(list);
    setHistoryOpen(false);
  }

  function newConversation() {
    setConversationId(null);
    setItems([]);
    setError(null);
    setHistoryOpen(false);
  }

  async function loadConversations() {
    const { data } = await supabase
      .from("coach_conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false })
      .limit(30);
    setConversations(data ?? []);
    setHistoryOpen(true);
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    setItems((prev) => [...prev, { role: "user", text: message, tools: [] }, { role: "assistant", text: "", tools: [] }]);

    // Werkt het laatste (assistent-)bericht bij terwijl het binnenstroomt.
    const patch = (fn: (a: ChatItem) => ChatItem) =>
      setItems((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);

    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
        body: JSON.stringify({ conversationId, message }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Er ging iets mis." }));
        throw new Error(err.error);
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.t === "conversation") setConversationId(e.id);
          else if (e.t === "text") patch((a) => ({ ...a, text: a.text + e.d }));
          else if (e.t === "tool") patch((a) => ({ ...a, tools: [...a.tools, e.label] }));
          else if (e.t === "error") setError(e.message);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis.");
      // Leeg antwoord weghalen.
      setItems((prev) => (prev.at(-1)?.text ? prev : prev.slice(0, -1)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Coach"
      action={
        <div className="flex gap-1">
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={loadConversations}>
            Eerder
          </button>
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={newConversation} disabled={busy}>
            + Nieuw
          </button>
        </div>
      }
    >
      <div className="flex min-h-[calc(100dvh-13rem)] flex-col">
        {items.length === 0 ? (
          <div className="flex flex-1 flex-col justify-center space-y-5 py-6">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
                <SparkleIcon size={28} />
              </div>
              <h2 className="text-xl font-bold">Je AI-coach</h2>
              <p className="mt-1 text-sm text-muted">
                Maakt schema&apos;s, kijkt je trainingen na en volgt je progressie. Hij kan je trainingen, sets en schema&apos;s
                zien.
              </p>
            </div>
            <div className="grid gap-2">
              {STARTERS.map((s) => (
                <button key={s} onClick={() => send(s)} className="card p-3 text-left text-sm hover:border-accent">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-4 pb-4">
            {items.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="ml-10 rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-accent-ink">
                  <p className="whitespace-pre-wrap">{m.text}</p>
                </div>
              ) : (
                <div key={i} className="mr-4 space-y-2">
                  {m.tools.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {[...new Set(m.tools)].map((t) => (
                        <span key={t} className="chip gap-1">
                          <CheckIcon size={12} className="text-accent" /> {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.text ? (
                    <div className="coach-md rounded-2xl rounded-bl-md bg-surface px-4 py-3 text-sm">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ href, children }) =>
                            href?.startsWith("/") ? <Link href={href}>{children}</Link> : <a href={href} target="_blank" rel="noreferrer">{children}</a>,
                        }}
                      >
                        {m.text}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    busy &&
                    i === items.length - 1 && (
                      <div className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-3 text-sm text-muted">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                        {m.tools.length ? `${m.tools.at(-1)}…` : "Denkt na…"}
                      </div>
                    )
                  )}
                </div>
              ),
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {error && <p className="mb-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="sticky bottom-20 flex items-end gap-2 rounded-2xl border border-line bg-bg/95 p-2 backdrop-blur"
        >
          <textarea
            className="input max-h-40 min-h-11 flex-1 resize-none py-2.5"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Vraag iets aan je coach…"
            maxLength={4000}
          />
          <button className="btn-primary h-11" disabled={busy || !input.trim()}>
            {busy ? "…" : "Stuur"}
          </button>
        </form>
      </div>

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="Eerdere gesprekken">
        {conversations.length === 0 ? (
          <p className="text-sm text-muted">Nog geen gesprekken.</p>
        ) : (
          <ul className="divide-y divide-line">
            {conversations.map((c) => (
              <li key={c.id}>
                <button onClick={() => openConversation(c.id)} className="flex w-full items-baseline justify-between gap-3 py-3 text-left">
                  <span className={`truncate ${c.id === conversationId ? "text-accent" : ""}`}>{c.title}</span>
                  <span className="shrink-0 text-xs text-muted">{timeAgo(c.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </AppShell>
  );
}
