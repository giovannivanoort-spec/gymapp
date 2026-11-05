"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { Avatar } from "@/components/Avatar";
import { FriendRow } from "@/components/FriendCard";
import { CheckIcon, CloseIcon, ShareIcon, UserPlusIcon } from "@/components/Icons";
import { useCached } from "@/lib/cache";
import {
  friendLink,
  REQUEST_MESSAGES,
  requestFriend,
  requestFriendByCode,
  respondFriend,
  useFriends,
  type FriendProfile,
} from "@/lib/friends";
import { errorMessage, supabase } from "@/lib/supabase";

export default function FriendsPage() {
  const userId = useUserId();
  const { profile } = useAuth();
  const data = useFriends(userId);
  const code = (profile as FriendProfile | null)?.friend_code;
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // Mensen uit je groepen die nog geen vriend zijn: met één tik toevoegen.
  const groupmates = useCached(
    `groupmates:${userId}`,
    async () => {
      const { data } = await supabase.from("group_members").select("user_id, profiles(*)").neq("user_id", userId);
      const seen = new Map<string, FriendProfile>();
      for (const m of (data ?? []) as unknown as { user_id: string; profiles: FriendProfile | null }[]) {
        if (m.profiles) seen.set(m.user_id, m.profiles);
      }
      return [...seen.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
    },
    { persist: true },
  );
  const suggestions = useMemo(() => {
    if (!groupmates || !data) return [];
    const known = new Set([...data.friends, ...data.incoming, ...data.outgoing].map((p) => p.id));
    return groupmates.filter((p) => !known.has(p.id));
  }, [groupmates, data]);

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ text });
    } catch (err) {
      setMessage({ text: errorMessage(err), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    if (!code) return;
    const url = friendLink(code);
    const text = `Voeg me toe als vriend in GymApp: ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "GymApp", text, url });
      } catch {
        /* geannuleerd */
      }
    } else {
      await navigator.clipboard.writeText(url);
      setMessage({ text: "Link gekopieerd" });
    }
  }

  return (
    <AppShell title="Vrienden" back>
      <div className="space-y-7">
        <section className="card animate-scale-in relative space-y-4 overflow-hidden">
          <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-accent/15 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <UserPlusIcon size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Vrienden toevoegen</p>
              <p className="text-xs text-muted">Vrienden zien elkaars trainingen, ranks en progressie. Voeding blijft privé.</p>
            </div>
          </div>

          <div className="relative flex items-center gap-2 rounded-xl border border-line bg-surface-2 p-1.5 pl-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Jouw code</p>
              <p className="font-mono text-lg font-bold tracking-widest">{code ?? "…"}</p>
            </div>
            <button className="btn-primary px-3 py-2 text-xs" onClick={share} disabled={!code}>
              <ShareIcon size={14} /> Deel link
            </button>
          </div>

          <form
            className="relative flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const c = input.trim().split("/").pop() ?? "";
              if (!c) return;
              run("code", async () => {
                const res = await requestFriendByCode(c);
                setInput("");
                return REQUEST_MESSAGES[res];
              });
            }}
          >
            <input
              className="input flex-1"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Code of link van een vriend"
              autoCapitalize="off"
              autoCorrect="off"
            />
            <button className="btn-ghost shrink-0" disabled={!input.trim() || busy === "code"}>
              {busy === "code" ? "…" : "Toevoegen"}
            </button>
          </form>
          {message && <p className={`relative text-sm ${message.error ? "text-danger" : "text-accent"}`}>{message.text}</p>}
        </section>

        {data && data.incoming.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Verzoeken</h2>
            {data.incoming.map((p, i) => (
              <div key={p.id} className="card animate-fade-up flex items-center gap-3 p-3" style={{ "--i": i } as React.CSSProperties}>
                <Avatar id={p.id} name={p.display_name} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.display_name}</p>
                  <p className="text-xs text-muted">wil je vriend worden</p>
                </div>
                <button
                  className="btn-ghost h-9 w-9 p-0"
                  aria-label="Weigeren"
                  disabled={busy === p.id}
                  onClick={() => run(p.id, () => respondFriend(p.id, false))}
                >
                  <CloseIcon size={16} />
                </button>
                <button
                  className="btn-primary h-9 px-3 text-xs"
                  disabled={busy === p.id}
                  onClick={() => run(p.id, () => respondFriend(p.id, true))}
                >
                  <CheckIcon size={14} /> Accepteren
                </button>
              </div>
            ))}
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Mijn vrienden{data && data.friends.length > 0 ? ` · ${data.friends.length}` : ""}
          </h2>
          {!data ? (
            <div className="space-y-2">
              <div className="skeleton h-[70px]" />
              <div className="skeleton h-[70px]" />
            </div>
          ) : data.friends.length === 0 ? (
            <div className="card text-sm text-muted">
              Nog geen vrienden. Deel je link of voeg iemand uit je groep toe.
            </div>
          ) : (
            <div className="space-y-2">
              {data.friends.map((f, i) => (
                <FriendRow key={f.id} friend={f} index={i} />
              ))}
            </div>
          )}
        </section>

        {suggestions.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Uit je groepen</h2>
            {suggestions.map((p, i) => (
              <div key={p.id} className="card animate-fade-up flex items-center gap-3 p-3" style={{ "--i": i } as React.CSSProperties}>
                <Avatar id={p.id} name={p.display_name} size={40} />
                <p className="min-w-0 flex-1 truncate font-semibold">{p.display_name}</p>
                <button
                  className="btn-ghost h-9 px-3 text-xs"
                  disabled={busy === p.id}
                  onClick={() => run(p.id, async () => REQUEST_MESSAGES[await requestFriend(p.id)])}
                >
                  <UserPlusIcon size={14} /> Toevoegen
                </button>
              </div>
            ))}
          </section>
        )}

        {data && data.outgoing.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Verstuurd</h2>
            {data.outgoing.map((p) => (
              <div key={p.id} className="card flex items-center gap-3 p-3 opacity-80">
                <Avatar id={p.id} name={p.display_name} size={36} />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold">{p.display_name}</p>
                <span className="text-xs text-muted">Wacht op reactie</span>
              </div>
            ))}
          </section>
        )}
      </div>
    </AppShell>
  );
}
