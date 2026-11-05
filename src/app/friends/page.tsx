"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { Avatar } from "@/components/Avatar";
import { FriendRow, WithSummaries, type PersonSummary } from "@/components/FriendCard";
import { CheckIcon, CloseIcon, ShareIcon, UserPlusIcon, UsersIcon } from "@/components/Icons";
import { FriendCode, showFlashToast, useFlash } from "@/components/social/FriendCode";
import { RetryIcon } from "@/components/social/icons";
import { toast } from "@/components/ui/Toast";
import { useCached } from "@/lib/cache";
import { toISODate } from "@/lib/dates";
import {
  clearFriendsFlash,
  friendErrorMessage,
  parseFriendCode,
  peekFriendsFlash,
  PUBLIC_PROFILE_COLUMNS,
  refreshFriends,
  removeFriend,
  REQUEST_MESSAGES,
  RequestGoneError,
  requestFriend,
  requestFriendByCode,
  respondFriend,
  shareFriendLink,
  useFriends,
  useFriendsRealtime,
  useFriendsStatus,
  useMyFriendCode,
  type FriendProfile,
} from "@/lib/friends";
import { isMissingSchemaError, supabase } from "@/lib/supabase";
import { PUBLIC_PROFILE_COLUMNS_NO_PHOTO } from "@/lib/types";

type RowError = { id: string; text: string };

export default function FriendsPage() {
  const userId = useUserId();
  const { profile } = useAuth();
  const me = profile as FriendProfile | null;
  const data = useFriends(userId);
  const status = useFriendsStatus(userId);
  useFriendsRealtime(userId);
  const code = useMyFriendCode(userId, me?.friend_code);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<RowError | null>(null);
  // Meldingen bij het invoeren van een code staan bij het invoerveld; de rest als toast onderin.
  const [message, showMessage] = useFlash(3200);
  // Melding van de vorige pagina (bijv. "Je bent geen vrienden meer met ...").
  useEffect(() => {
    const arrival = peekFriendsFlash();
    if (arrival) toast.success(arrival);
    clearFriendsFlash();
  }, []);

  // Mensen uit je groepen die nog geen vriend zijn: met één tik toevoegen.
  const groupmates = useCached(
    userId ? `groupmates:${userId}` : null,
    async () => {
      const query = (cols: string) => supabase.from("group_members").select(`user_id, profiles(${cols})`).neq("user_id", userId);
      let { data, error } = await query(PUBLIC_PROFILE_COLUMNS);
      // upgrade-avatars.sql nog niet gedraaid: zonder profielfoto opnieuw.
      if (error && isMissingSchemaError(error)) ({ data, error } = await query(PUBLIC_PROFILE_COLUMNS_NO_PHOTO));
      if (error) throw error;
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

  /** Actie op een rij: bezig-status op die rij, fout onder de naam en een toast bij succes. */
  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setRowError(null);
    try {
      const text = await fn();
      if (text) showFlashToast({ text });
    } catch (err) {
      // Verzoek bestond niet meer: de rij verdwijnt, dus dan als melding onderin.
      if (err instanceof RequestGoneError) showFlashToast({ text: friendErrorMessage(err), error: true });
      else setRowError({ id: key, text: friendErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function shareLink() {
    if (!code) return;
    const res = await shareFriendLink(code);
    if (res === "copied") showFlashToast({ text: "Link gekopieerd. Plak hem in een chat met je vriend." });
    if (res === "failed") showFlashToast({ text: "Delen lukte niet. Tik bovenaan op je code om hem te kopiëren.", error: true });
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    const c = parseFriendCode(input);
    if (!c) {
      setInputError("Dat is geen geldige code. Een vriendcode heeft 8 tekens, bijvoorbeeld 3f9a0c1d.");
      return;
    }
    if (c === code) {
      setInputError("Dit is je eigen code. Stuur hem naar een vriend zodat die jou kan toevoegen.");
      return;
    }
    setInputError(null);
    showMessage(null);
    setBusy("code");
    try {
      const res = await requestFriendByCode(c);
      if (res === "self") {
        setInputError("Dit is je eigen code. Stuur hem naar een vriend zodat die jou kan toevoegen.");
        return;
      }
      setInput("");
      showMessage({ text: REQUEST_MESSAGES[res] });
    } catch (err) {
      setInputError(friendErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const errorFor = (id: string) =>
    rowError?.id === id ? (
      <p role="alert" className="animate-fade-in mt-0.5 text-xs text-danger">
        {rowError.text}
      </p>
    ) : null;

  const suggestionsSection = suggestions.length > 0 && (
    <section className="space-y-3" aria-labelledby="suggestions-h">
      <h2 id="suggestions-h" className="text-sm font-semibold uppercase tracking-wide text-muted">
        Uit je groepen
      </h2>
      {suggestions.map((p, i) => (
        <div key={p.id} className="card animate-fade-up flex items-center gap-3 p-3" style={{ "--i": i } as React.CSSProperties}>
          <Avatar id={p.id} name={p.display_name} src={p.avatar_url} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{p.display_name}</p>
            {errorFor(p.id) ?? <p className="text-xs text-muted">Zit in een groep met je</p>}
          </div>
          <button
            className="btn-ghost h-9 shrink-0 px-3 text-xs"
            disabled={busy === p.id}
            aria-busy={busy === p.id}
            aria-label={`${p.display_name} toevoegen als vriend`}
            onClick={() =>
              run(p.id, async () => {
                const res = await requestFriend(p.id);
                return res === "accepted" ? `Jij en ${p.display_name.split(" ")[0]} zijn nu vrienden` : REQUEST_MESSAGES[res];
              })
            }
          >
            <UserPlusIcon size={14} /> {busy === p.id ? "Bezig…" : "Toevoegen"}
          </button>
        </div>
      ))}
    </section>
  );

  const noFriends = data && data.friends.length === 0;
  const hasFriends = !!data && data.friends.length > 0;

  const addCard = (
    <section className="card animate-scale-in relative space-y-4 overflow-hidden" aria-labelledby="add-h">
      <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-accent/15 blur-3xl" />
      <div className="relative flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <UserPlusIcon size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="add-h" className="font-semibold">
            {hasFriends ? "Nog iemand toevoegen" : "Vrienden toevoegen"}
          </h2>
          <p className="text-xs text-muted">
            {hasFriends
              ? "Deel je code of vul de code van een vriend in."
              : "Vrienden zien elkaars trainingen, ranks en progressie. Voeding blijft privé."}
          </p>
        </div>
      </div>

      <div className="relative">
        <FriendCode code={code} onMessage={showFlashToast} />
      </div>

      <form className="relative space-y-1.5" onSubmit={submitCode} noValidate>
        <label htmlFor="friend-code" className="sr-only">
          Code of link van een vriend
        </label>
        <div className="flex gap-2">
          <input
            id="friend-code"
            className={`input min-w-0 flex-1 ${inputError ? "border-danger" : ""}`}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (inputError) setInputError(null);
            }}
            placeholder="Code of link van een vriend"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="send"
            aria-invalid={!!inputError}
            aria-describedby={inputError ? "friend-code-error" : undefined}
          />
          <button className="btn-ghost shrink-0" disabled={!input.trim() || busy === "code"} aria-busy={busy === "code"}>
            {busy === "code" ? "Bezig…" : "Toevoegen"}
          </button>
        </div>
        {inputError && (
          <p id="friend-code-error" role="alert" className="animate-fade-in text-xs text-danger">
            {inputError}
          </p>
        )}
      </form>
      {message && (
        <p role="status" className="animate-fade-in relative flex items-center gap-1.5 text-sm text-accent">
          <CheckIcon size={14} className="shrink-0" />
          {message.text}
        </p>
      )}
    </section>
  );
  const people = useMemo(() => (data ? [...(me ? [me] : []), ...data.friends] : []), [data, me]);

  return (
    <AppShell title="Vrienden" back>
      <div className="space-y-7">
        {!hasFriends && addCard}

        {status.error && data && (
          <div className="animate-fade-in flex items-center gap-3 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            <p className="min-w-0 flex-1">Kon niet verversen. Je ziet de laatst bekende stand.</p>
            <button
              className="-my-2 flex min-h-11 shrink-0 items-center gap-1 font-semibold hover:underline disabled:opacity-50"
              onClick={() => refreshFriends(userId).catch(() => {})}
              disabled={status.loading}
            >
              <RetryIcon size={13} className={status.loading ? "animate-spin" : ""} /> Opnieuw
            </button>
          </div>
        )}

        {data && data.incoming.length > 0 && (
          <section className="space-y-3" aria-labelledby="incoming-h">
            <h2 id="incoming-h" className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
              Verzoeken
              <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold tabular-nums text-accent-ink">{data.incoming.length}</span>
            </h2>
            {data.incoming.map((p, i) => (
              <div key={p.id} className="card animate-fade-up flex items-center gap-3 p-3" style={{ "--i": i } as React.CSSProperties}>
                <Link href={`/friends/${p.id}`} className="shrink-0" aria-label={`Profiel van ${p.display_name}`}>
                  <Avatar id={p.id} name={p.display_name} src={p.avatar_url} size={40} />
                </Link>
                <Link href={`/friends/${p.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.display_name}</p>
                  {errorFor(p.id) ?? <p className="text-xs text-muted">Wil je vriend worden</p>}
                </Link>
                <button
                  className="btn-ghost h-9 w-9 shrink-0 p-0"
                  aria-label={`Verzoek van ${p.display_name} weigeren`}
                  disabled={busy === p.id}
                  onClick={() =>
                    run(p.id, async () => {
                      await respondFriend(p.id, false);
                      return "Verzoek geweigerd";
                    })
                  }
                >
                  <CloseIcon size={16} />
                </button>
                <button
                  className="btn-primary h-9 shrink-0 px-3 text-xs"
                  disabled={busy === p.id}
                  aria-busy={busy === p.id}
                  onClick={() =>
                    run(p.id, async () => {
                      await respondFriend(p.id, true);
                      return `Jij en ${p.display_name.split(" ")[0]} zijn nu vrienden`;
                    })
                  }
                >
                  <CheckIcon size={14} /> {busy === p.id ? "Bezig…" : "Accepteren"}
                </button>
              </div>
            ))}
          </section>
        )}

        {noFriends && suggestionsSection}

        <WithSummaries people={people}>
          {(summaries) => {
            const offset = me && data ? 1 : 0;
            const mine = offset ? summaries[0] : null;
            const theirs = summaries.slice(offset);
            return (
              <>
                {data && data.friends.length > 0 && (
                  <WeekBoard
                    me={me}
                    mine={mine}
                    friends={data.friends}
                    summaries={theirs}
                  />
                )}
                <FriendsList
                  data={data?.friends}
                  summaries={theirs}
                  error={status.error}
                  loading={status.loading}
                  onRetry={() => refreshFriends(userId).catch(() => {})}
                  onShare={shareLink}
                  canShare={!!code}
                />
              </>
            );
          }}
        </WithSummaries>

        {!noFriends && suggestionsSection}

        {hasFriends && addCard}

        {data && data.outgoing.length > 0 && (
          <section className="space-y-3" aria-labelledby="outgoing-h">
            <h2 id="outgoing-h" className="text-sm font-semibold uppercase tracking-wide text-muted">
              Verstuurd
            </h2>
            {data.outgoing.map((p, i) => (
              <div key={p.id} className="card animate-fade-up flex items-center gap-3 p-3" style={{ "--i": i } as React.CSSProperties}>
                <Link href={`/friends/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3" aria-label={`Profiel van ${p.display_name}`}>
                  <Avatar id={p.id} name={p.display_name} src={p.avatar_url} size={36} className="shrink-0 opacity-80" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{p.display_name}</p>
                    {errorFor(p.id) ?? <p className="text-xs text-muted">Wacht op reactie</p>}
                  </div>
                </Link>
                <button
                  className="btn-ghost h-9 shrink-0 px-3 text-xs text-muted hover:text-danger"
                  disabled={busy === p.id}
                  aria-busy={busy === p.id}
                  aria-label={`Verzoek aan ${p.display_name} intrekken`}
                  onClick={() =>
                    run(p.id, async () => {
                      await removeFriend(p.id);
                      return "Verzoek ingetrokken";
                    })
                  }
                >
                  {busy === p.id ? "Bezig…" : "Intrekken"}
                </button>
              </div>
            ))}
          </section>
        )}
      </div>
    </AppShell>
  );
}

/** Vriendenlijst: wie vandaag trainde bovenaan, daarna wie het laatst trainde. */
function FriendsList({
  data,
  summaries,
  error,
  loading,
  onRetry,
  onShare,
  canShare,
}: {
  data: FriendProfile[] | undefined;
  summaries: (PersonSummary | null)[];
  error: boolean;
  loading: boolean;
  onRetry: () => void;
  onShare: () => void;
  canShare: boolean;
}) {
  const rows = useMemo(() => {
    if (!data) return [];
    const list = data.map((f, i) => ({ f, s: summaries[i] ?? null }));
    // Pas sorteren als alles bekend is, zodat de lijst niet tijdens het laden verspringt.
    if (list.some((r) => !r.s)) return list;
    return [...list].sort(
      (a, b) => (b.s!.last ?? "").localeCompare(a.s!.last ?? "") || a.f.display_name.localeCompare(b.f.display_name),
    );
  }, [data, summaries]);

  return (
    <section className="space-y-3" aria-labelledby="friends-h">
      <h2 id="friends-h" className="text-sm font-semibold uppercase tracking-wide text-muted">
        Mijn vrienden{data && data.length > 0 ? ` · ${data.length}` : ""}
      </h2>
      {!data ? (
        error ? (
          <div className="card space-y-3 text-center">
            <p className="text-sm text-muted">Kon je vrienden niet laden. Controleer je verbinding.</p>
            <button className="btn-ghost w-full" onClick={onRetry} disabled={loading}>
              <RetryIcon size={15} className={loading ? "animate-spin" : ""} />
              {loading ? "Laden…" : "Opnieuw proberen"}
            </button>
          </div>
        ) : (
          <div className="space-y-2" aria-busy>
            <div className="skeleton h-[70px]" />
            <div className="skeleton h-[70px]" />
          </div>
        )
      ) : data.length === 0 ? (
        <div className="card animate-fade-up flex flex-col items-center gap-3 px-6 py-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 text-accent ring-8 ring-accent/5">
            <UsersIcon size={26} />
          </div>
          <div>
            <p className="font-semibold">Train samen, ook op afstand</p>
            <p className="mt-1 text-sm text-muted">
              Stuur je link naar een trainingsmaatje. Zodra jullie vrienden zijn zie je elkaars trainingen, records en wie er
              sterker is.
            </p>
          </div>
          <button className="btn-primary mt-1 w-full max-w-xs" onClick={onShare} disabled={!canShare}>
            <ShareIcon size={15} /> Deel je link
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(({ f, s }, i) => (
            <FriendRow key={f.id} friend={f} index={i} summary={s} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Ranglijst van deze week: trainingsdagen tegen ieders eigen weekdoel, jij er tussen. */
function WeekBoard({
  me,
  mine,
  friends,
  summaries,
}: {
  me: FriendProfile | null;
  mine: PersonSummary | null;
  friends: FriendProfile[];
  summaries: (PersonSummary | null)[];
}) {
  const today = toISODate();
  const entries = [
    ...(me ? [{ p: me, s: mine, isMe: true }] : []),
    ...friends.map((p, i) => ({ p, s: summaries[i] ?? null, isMe: false })),
  ];
  const loaded = entries.every((e) => e.s);
  const ranked = loaded
    ? [...entries].sort((a, b) => {
        // Boven je weekdoel telt niet extra: 6 van 3 staat niet boven 5 van 5.
        const ra = Math.min(1, a.s!.week / Math.max(1, a.s!.goal));
        const rb = Math.min(1, b.s!.week / Math.max(1, b.s!.goal));
        return (
          rb - ra ||
          b.s!.week - a.s!.week ||
          (b.s!.last ?? "").localeCompare(a.s!.last ?? "") ||
          Number(b.isMe) - Number(a.isMe) ||
          a.p.display_name.localeCompare(b.p.display_name)
        );
      })
    : entries;
  const done = loaded ? entries.filter((e) => e.s!.week >= e.s!.goal).length : 0;

  return (
    <section className="space-y-3" aria-labelledby="week-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="week-h" className="text-sm font-semibold uppercase tracking-wide text-muted">
          Deze week
        </h2>
        {loaded && (
          <span className="text-xs text-muted">
            {done === 0 ? "Nog niemand op weekdoel" : `${done} van ${entries.length} op weekdoel`}
          </span>
        )}
      </div>
      <ol className="card animate-fade-up divide-y divide-line p-0">
        {ranked.map(({ p, s, isMe }, i) => {
          const pct = s ? Math.min(1, s.week / Math.max(1, s.goal)) : 0;
          const hit = !!s && s.week >= s.goal;
          const trainedToday = s?.last === today;
          const name = isMe ? "Jij" : p.display_name;
          const row = (
            <>
              <span className={`w-4 shrink-0 text-center text-xs font-bold tabular-nums ${i === 0 && loaded && s!.week > 0 ? "text-accent" : "text-muted"}`}>
                {loaded ? i + 1 : ""}
              </span>
              <span className="relative shrink-0">
                <Avatar id={p.id} name={p.display_name} src={p.avatar_url} size={32} ring={s?.overall?.tier.from} />
                {trainedToday && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-accent ring-2 ring-surface" aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className={`truncate text-sm ${isMe ? "font-bold" : "font-semibold"}`}>
                  {name}
                  {trainedToday && <span className="sr-only">, heeft vandaag getraind</span>}
                </p>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  {s ? (
                    <div
                      className={`h-full rounded-full ${hit ? "bg-accent" : "bg-accent/50"}`}
                      style={{ width: `${Math.max(pct * 100, s.week > 0 ? 6 : 0)}%`, transition: "width 0.6s cubic-bezier(0.2,0.8,0.2,1)" }}
                    />
                  ) : (
                    <div className="skeleton h-full w-1/3" />
                  )}
                </div>
              </div>
              <span className="w-10 shrink-0 text-right text-sm tabular-nums">
                {s ? (
                  <>
                    <span className={hit ? "font-bold text-accent" : "font-semibold"}>{s.week}</span>
                    <span className="text-muted">/{s.goal}</span>
                    <span className="sr-only"> trainingsdagen van je weekdoel</span>
                  </>
                ) : (
                  <span className="skeleton ml-auto block h-4 w-8" />
                )}
              </span>
            </>
          );
          return (
            <li key={p.id}>
              {isMe ? (
                <div className="flex items-center gap-3 bg-accent/[0.04] px-4 py-2.5">{row}</div>
              ) : (
                <Link href={`/friends/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface-2/40">
                  {row}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
