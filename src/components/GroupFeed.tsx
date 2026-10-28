"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/dates";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { TIERS } from "@/lib/ranks";
import { supabase } from "@/lib/supabase";
import { ArrowUpIcon, PlusIcon } from "./Icons";
import { RankBadge } from "./RankBadge";

type Activity = {
  id: string;
  user_id: string;
  type: "pr" | "promotion" | "joined";
  payload: { slug?: string; tierIndex?: number; detail?: string };
  workout_id: string | null;
  created_at: string;
  profiles: { display_name: string } | null;
  activity_kudos: { user_id: string }[];
};

/** Tijdlijn van de groep: records, promoties en nieuwe leden, met "Respect" als reactie. */
export function GroupFeed({ groupId, userId }: { groupId: string; userId: string }) {
  const [items, setItems] = useState<Activity[] | null>(null);
  const [limit, setLimit] = useState(15);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    supabase
      .from("activities")
      .select("id, user_id, type, payload, workout_id, created_at, profiles!activities_user_id_fkey(display_name), activity_kudos(user_id)")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data }) => setItems((data as unknown as Activity[]) ?? []));
  }, [groupId, limit, version]);

  useEffect(() => {
    const channel = supabase
      .channel(`feed-${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "activities", filter: `group_id=eq.${groupId}` }, () =>
        setVersion((v) => v + 1),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId]);

  async function toggleKudos(a: Activity) {
    const mine = a.activity_kudos.some((k) => k.user_id === userId);
    // Direct tonen, daarna opslaan.
    setItems((list) =>
      list?.map((x) =>
        x.id === a.id
          ? { ...x, activity_kudos: mine ? x.activity_kudos.filter((k) => k.user_id !== userId) : [...x.activity_kudos, { user_id: userId }] }
          : x,
      ) ?? null,
    );
    navigator.vibrate?.(10);
    if (mine) await supabase.from("activity_kudos").delete().eq("activity_id", a.id).eq("user_id", userId);
    else await supabase.from("activity_kudos").insert({ activity_id: a.id });
  }

  if (items === null) return <div className="skeleton h-32" />;
  if (items.length === 0) {
    return <div className="card text-sm text-muted">Nog geen activiteit. Records en promoties van de groep verschijnen hier.</div>;
  }

  return (
    <div className="space-y-2">
      <ul className="card divide-y divide-line p-0">
        {items.map((a, i) => {
          const name = a.user_id === userId ? "Jij" : (a.profiles?.display_name ?? "Iemand");
          const exercise = a.payload.slug ? (EXERCISE_BY_SLUG[a.payload.slug]?.name ?? a.payload.slug) : "";
          const kudos = a.activity_kudos.length;
          const mine = a.activity_kudos.some((k) => k.user_id === userId);
          return (
            <li key={a.id} className="animate-fade-up flex items-start gap-3 px-4 py-3" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
              <div className="mt-0.5 shrink-0">
                {a.type === "promotion" ? (
                  <RankBadge tierIndex={a.payload.tierIndex ?? 0} size={34} />
                ) : (
                  <span className={`flex h-[34px] w-[34px] items-center justify-center rounded-full ${a.type === "pr" ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted"}`}>
                    {a.type === "pr" ? <ArrowUpIcon size={16} /> : <PlusIcon size={16} />}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-semibold">{name}</span>{" "}
                  {a.type === "pr" && (
                    <>
                      zette een record op <span className="font-medium">{exercise}</span>
                      {a.payload.detail && <span className="text-muted"> · {a.payload.detail}</span>}
                    </>
                  )}
                  {a.type === "promotion" && (
                    <>
                      {a.user_id === userId ? "bent" : "is"}{" "}
                      <span className="font-semibold" style={{ color: TIERS[a.payload.tierIndex ?? 0]?.to }}>
                        {TIERS[a.payload.tierIndex ?? 0]?.name}
                      </span>{" "}
                      geworden op <span className="font-medium">{exercise}</span>
                    </>
                  )}
                  {a.type === "joined" && <>{a.user_id === userId ? "bent" : "is"} lid geworden van de groep</>}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {timeAgo(a.created_at)}
                  {a.workout_id && (
                    <>
                      {" · "}
                      <Link href={`/workouts/${a.workout_id}`} className="hover:text-ink">
                        training bekijken
                      </Link>
                    </>
                  )}
                </p>
              </div>
              {a.type !== "joined" && (
                <button
                  onClick={() => toggleKudos(a)}
                  aria-pressed={mine}
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums transition active:scale-90 ${
                    mine ? "border-accent bg-accent text-accent-ink" : "border-line text-muted hover:text-ink"
                  }`}
                >
                  Respect{kudos ? ` · ${kudos}` : ""}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {items.length >= limit && (
        <button className="w-full text-center text-sm text-muted hover:text-ink" onClick={() => setLimit((l) => l + 15)}>
          Meer laden
        </button>
      )}
    </div>
  );
}
