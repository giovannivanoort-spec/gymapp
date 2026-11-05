"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCached, getCached, invalidate, setCached, useCached } from "@/lib/cache";
import { timeAgo } from "@/lib/dates";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { TIERS } from "@/lib/ranks";
import type { ActivityPayload, ActivityType } from "@/lib/activities";
import { supabase } from "@/lib/supabase";
import { Avatar } from "./Avatar";
import { FEED_PAGE, joinNames, plural } from "./groups/groupData";
import { toast } from "./ui/Toast";
import { useMinuteTick } from "./groups/useMinuteTick";
import { ArrowUpIcon, CheckIcon, PlusIcon } from "./Icons";
import { RankBadge } from "./RankBadge";

type Kudo = { user_id: string; profiles: { display_name: string } | null };

type Activity = {
  id: string;
  user_id: string;
  type: ActivityType;
  payload: ActivityPayload;
  workout_id: string | null;
  created_at: string;
  profiles: { display_name: string } | null;
  activity_kudos: Kudo[];
};

type FeedPage = { items: Activity[]; hasMore: boolean };

const PAGE = FEED_PAGE;

async function fetchFeed(groupId: string, limit: number): Promise<FeedPage> {
  const { data, error } = await supabase
    .from("activities")
    .select(
      "id, user_id, type, payload, workout_id, created_at, profiles!activities_user_id_fkey(display_name), activity_kudos(user_id, profiles(display_name))",
    )
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (error) throw error;
  const rows = (data as unknown as Activity[]) ?? [];
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

/**
 * Tijdlijn van de groep: records, promoties, afgeronde trainingen en nieuwe leden, met "Respect"
 * als reactie. Meldingen gaan via de gedeelde toast van de app, of via `onError` als die is meegegeven.
 */
export function GroupFeed({
  groupId,
  userId,
  onError,
}: {
  groupId: string;
  userId: string;
  onError?: (message: string) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const [failed, setFailed] = useState(false);
  // "3 min geleden" bijwerken zolang de pagina open staat.
  useMinuteTick();
  const pending = useRef(new Set<string>());
  const key = `feed:${groupId}:${limit}`;
  const persist = limit === PAGE;

  const fetcher = useCallback(
    () =>
      fetchFeed(groupId, limit).then(
        (d) => {
          setFailed(false);
          return d;
        },
        (e: unknown) => {
          setFailed(true);
          throw e;
        },
      ),
    [groupId, limit],
  );
  const fetched = useCached(key, fetcher, { persist, maxAge: 20_000 });

  // Bij "Meer laden" de huidige lijst blijven tonen tot de langere lijst binnen is.
  const [shown, setShown] = useState<FeedPage | undefined>(fetched);
  if (fetched !== undefined && fetched !== shown) setShown(fetched);
  const page = fetched ?? shown;
  const loadingMore = fetched === undefined && shown !== undefined;

  // Live: nieuwe activiteit en Respect van anderen; en verversen als de app weer in beeld komt.
  useEffect(() => {
    const refresh = () => invalidate(`feed:${groupId}:`);
    const channel = supabase
      .channel(`feed-${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "activities", filter: `group_id=eq.${groupId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_kudos" }, (payload) => {
        const row = (payload.new ?? payload.old) as { activity_id?: string } | null;
        const aid = row?.activity_id ?? (payload.old as { activity_id?: string } | null)?.activity_id;
        const items = getCached<FeedPage>(`feed:${groupId}:${limit}`)?.items;
        if (!aid || !items || items.some((a) => a.id === aid)) refresh();
      })
      .subscribe();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [groupId, limit]);

  function patchKudos(activityId: string, add: boolean) {
    const cur = getCached<FeedPage>(key) ?? page;
    if (!cur) return;
    setCached(
      key,
      {
        ...cur,
        items: cur.items.map((x) => {
          if (x.id !== activityId) return x;
          const others = x.activity_kudos.filter((k) => k.user_id !== userId);
          return { ...x, activity_kudos: add ? [...others, { user_id: userId, profiles: null }] : others };
        }),
      },
      persist,
    );
  }

  async function toggleKudos(a: Activity) {
    // Snel dubbel tikken: wacht tot het vorige verzoek klaar is.
    if (pending.current.has(a.id)) return;
    pending.current.add(a.id);
    const mine = a.activity_kudos.some((k) => k.user_id === userId);
    patchKudos(a.id, !mine);
    navigator.vibrate?.(10);
    const { error } = mine
      ? await supabase.from("activity_kudos").delete().eq("activity_id", a.id).eq("user_id", userId)
      : await supabase.from("activity_kudos").insert({ activity_id: a.id });
    pending.current.delete(a.id);
    // 23505: stond er al (bijv. vanaf een ander apparaat), dat is prima.
    if (error && error.code !== "23505") {
      patchKudos(a.id, mine);
      const message = mine ? "Respect intrekken lukte niet. Probeer het opnieuw." : "Respect geven lukte niet. Probeer het opnieuw.";
      if (onError) onError(message);
      else toast.error(message);
    }
  }

  if (!page) {
    if (failed) {
      return (
        <div className="card space-y-3 text-center text-sm">
          <p className="text-muted">Kan de activiteit niet laden.</p>
          <button className="btn-ghost min-h-11 w-full" onClick={() => fetchCached(key, fetcher, persist).catch(() => {})}>
            Opnieuw proberen
          </button>
        </div>
      );
    }
    return (
      <div className="card divide-y divide-line p-0" aria-busy aria-label="Activiteit laden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="skeleton h-[34px] w-[34px] shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <div className="skeleton h-3.5 w-3/4" />
              <div className="skeleton h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (page.items.length === 0) {
    return (
      <div className="card text-sm text-muted">
        Nog geen activiteit. Records, nieuwe ranks, afgeronde trainingen en nieuwe leden verschijnen hier, en je kunt elkaar
        Respect geven.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="card divide-y divide-line p-0">
        {page.items.map((a, i) => {
          const self = a.user_id === userId;
          const realName = a.profiles?.display_name ?? "Iemand";
          const name = self ? "Jij" : realName;
          const exercise = a.payload.slug ? (EXERCISE_BY_SLUG[a.payload.slug]?.name ?? a.payload.slug) : "";
          const kudos = a.activity_kudos.length;
          const mine = a.activity_kudos.some((k) => k.user_id === userId);
          const givers = [
            ...(mine ? ["jou"] : []),
            ...a.activity_kudos.filter((k) => k.user_id !== userId).map((k) => k.profiles?.display_name ?? "iemand"),
          ];
          const tier = TIERS[a.payload.tierIndex ?? 0];
          const profileHref = `/ranks?user=${a.user_id}`;
          return (
            <li key={a.id} className="animate-fade-up flex items-start gap-3 px-4 py-3" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
              <Link href={profileHref} className="relative mt-0.5 shrink-0 rounded-full" aria-label={`Profiel van ${realName}`}>
                <Avatar id={a.user_id} name={realName} size={36} />
                <TypeBadge a={a} />
              </Link>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <Link href={profileHref} className="font-semibold underline-offset-2 hover:underline">
                    {name}
                  </Link>{" "}
                  {a.type === "pr" && (
                    <>
                      zette een record op <span className="font-medium">{exercise}</span>
                      {a.payload.detail && <span className="text-muted"> · {a.payload.detail}</span>}
                    </>
                  )}
                  {a.type === "promotion" && (
                    <>
                      {self ? "bent" : "is"}{" "}
                      <span className="font-semibold" style={{ color: tier?.to }}>
                        {tier?.name}
                      </span>{" "}
                      geworden op <span className="font-medium">{exercise}</span>
                    </>
                  )}
                  {a.type === "finished" && <>{self ? "hebt" : "heeft"} de training afgerond</>}
                  {a.type === "joined" && <>{self ? "bent" : "is"} lid geworden van de groep</>}
                </p>
                {a.type === "finished" && <FinishedStats p={a.payload} />}
                <p className="mt-0.5 text-xs text-muted">
                  <time dateTime={a.created_at}>{timeAgo(a.created_at)}</time>
                  {a.workout_id && (
                    <>
                      {" · "}
                      <Link href={`/workouts/${a.workout_id}`} className="underline-offset-2 hover:text-ink hover:underline">
                        training bekijken
                      </Link>
                    </>
                  )}
                </p>
                {kudos > 0 && <p className="mt-1 truncate text-xs text-muted">Respect van {joinNames(givers)}</p>}
              </div>
              {a.type !== "joined" && self ? (
                // Je eigen activiteit: alleen laten zien hoeveel Respect je kreeg, niet zelf geven.
                kudos > 0 && (
                  <span
                    className="mt-1 shrink-0 rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold tabular-nums text-accent"
                    aria-label={`${kudos} keer Respect gekregen`}
                  >
                    Respect · {kudos}
                  </span>
                )
              ) : a.type !== "joined" && (
                <button
                  onClick={() => toggleKudos(a)}
                  aria-pressed={mine}
                  aria-label={`${mine ? "Respect intrekken" : "Respect geven"}${kudos ? ` (${kudos})` : ""}`}
                  className="group -my-1.5 flex min-h-11 shrink-0 items-center transition active:scale-90"
                >
                  <span
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold tabular-nums transition ${
                      mine ? "border-accent bg-accent text-accent-ink" : "border-line text-muted group-hover:text-ink"
                    }`}
                  >
                    <span key={`${mine}`} className={mine ? "animate-pop inline-block" : "inline-block"}>
                      Respect{kudos ? ` · ${kudos}` : ""}
                    </span>
                  </span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {page.hasMore && (
        <button
          className="min-h-11 w-full rounded-xl text-center text-sm font-medium text-muted hover:text-ink disabled:opacity-60"
          onClick={() => setLimit((l) => l + PAGE)}
          disabled={loadingMore}
        >
          {loadingMore ? "Laden…" : "Meer laden"}
        </button>
      )}
    </div>
  );
}

/** Klein icoon rechtsonder op de avatar: wat voor soort activiteit het is. */
function TypeBadge({ a }: { a: Activity }) {
  const ring = "absolute -bottom-1 -right-1 rounded-full ring-2 ring-surface";
  if (a.type === "promotion") {
    return (
      <span className={`${ring} bg-surface`} aria-hidden>
        <RankBadge tierIndex={a.payload.tierIndex ?? 0} size={18} />
      </span>
    );
  }
  const tone = a.type === "joined" ? "bg-surface-2 text-muted" : "bg-accent text-accent-ink";
  return (
    <span className={`${ring} flex h-[18px] w-[18px] items-center justify-center ${tone}`} aria-hidden>
      {a.type === "pr" ? (
        <ArrowUpIcon size={11} strokeWidth={3} />
      ) : a.type === "finished" ? (
        <CheckIcon size={11} strokeWidth={3} />
      ) : (
        <PlusIcon size={11} strokeWidth={3} />
      )}
    </span>
  );
}

/** Samenvatting onder "training afgerond": oefeningen, sets, volume en records. */
function FinishedStats({ p }: { p: Activity["payload"] }) {
  const parts = [
    p.exercises ? plural(p.exercises, "oefening", "oefeningen") : null,
    p.sets ? plural(p.sets, "set", "sets") : null,
    p.volume ? `${Math.round(p.volume).toLocaleString("nl-NL")} kg volume` : null,
    p.prs ? plural(p.prs, "record", "records") : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <p className="mt-1 text-xs font-medium text-ink/80">{parts.join(" · ")}</p>;
}
