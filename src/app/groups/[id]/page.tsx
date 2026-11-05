"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useUserId } from "@/components/AuthProvider";
import { Avatar } from "@/components/Avatar";
import { GroupFeed } from "@/components/GroupFeed";
import { GroupLeaderboard } from "@/components/GroupLeaderboard";
import { StepsLeaderboard } from "@/components/activity/StepsLeaderboard";
import { ChevronRightIcon, PlusIcon, SparkleIcon, UserPlusIcon } from "@/components/Icons";
import { AvatarStack } from "@/components/groups/AvatarStack";
import { ConfirmSheet } from "@/components/groups/ConfirmSheet";
import {
  fetchAttendance,
  fetchPastWorkouts,
  forgetGroup,
  memberName,
  plural,
  refreshGroup,
  refreshTrainingData,
  useGroupData,
  type GroupWorkout,
} from "@/components/groups/groupData";
import { GroupSettingsSheet, LeaveSheet, MemberSheet } from "@/components/groups/GroupSheets";
import { InviteSheet } from "@/components/groups/InviteSheet";
import { TodayPanel } from "@/components/groups/TodayPanel";
import { useGroupLive } from "@/components/groups/useGroupLive";
import { RepeatWeekSheet } from "@/components/groups/RepeatWeekSheet";
import { WeekStrip } from "@/components/groups/WeekStrip";
import { toast } from "@/components/ui/Toast";
import { invalidate } from "@/lib/cache";
import { relativeDay, toISODate } from "@/lib/dates";
import { errorMessage, supabase } from "@/lib/supabase";
import type { GroupMember } from "@/lib/types";
import { weekRange } from "@/lib/week";

/**
 * Extra pagina's eerdere trainingen ("Meer laden"), horend bij de eerste pagina waarop ze volgen
 * (de ids daarvan als handtekening).
 */
type Extra = { basedOn: string; items: GroupWorkout[]; attendance: Record<string, string[]>; hasMore: boolean };

const TABS = [
  { key: "trainingen", label: "Trainingen" },
  { key: "activiteit", label: "Activiteit" },
  { key: "ranglijst", label: "Ranglijst" },
  { key: "leden", label: "Leden" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const tabStorageKey = (groupId: string) => `spotter:group-tab:${groupId}`;

function readTab(groupId: string): TabKey {
  try {
    const v = localStorage.getItem(tabStorageKey(groupId));
    if (TABS.some((t) => t.key === v)) return v as TabKey;
  } catch {
    // geen opslag beschikbaar
  }
  return "trainingen";
}

function writeTab(groupId: string, tab: TabKey) {
  try {
    localStorage.setItem(tabStorageKey(groupId), tab);
  } catch {
    // niet belangrijk
  }
}

export default function GroupPage() {
  const { id } = useParams<{ id: string }>();
  const userId = useUserId();
  const router = useRouter();
  const { data, error, retry } = useGroupData(id);
  useGroupLive(id);

  const [tab, setTab] = useState<TabKey>(() => readTab(id));
  const [tabFor, setTabFor] = useState(id);
  if (tabFor !== id) {
    // Andere groep geopend binnen dezelfde pagina: het onthouden tabblad van die groep tonen.
    setTabFor(id);
    setTab(readTab(id));
  }
  const [showPast, setShowPast] = useState(false);
  const [loadedExtra, setExtra] = useState<Extra | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [managing, setManaging] = useState<GroupMember | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const [repeatOpen, setRepeatOpen] = useState(false);

  // Is de eerste pagina eerdere trainingen veranderd (bijv. een training elders verwijderd), dan
  // vervallen de extra geladen pagina's; anders blijven verouderde trainingen staan. Een gewone
  // live-verversing (zelfde trainingen) laat ze staan.
  const pastSig = useMemo(() => (data?.past ?? []).map((w) => w.id).join(","), [data]);
  const extra = loadedExtra && loadedExtra.basedOn === pastSig ? loadedExtra : null;

  const group = data?.group;
  const members = useMemo(() => {
    const list = data?.members ?? [];
    // Trainers bovenaan, verder op volgorde van lid worden.
    return [...list].sort((a, b) => (a.role === b.role ? 0 : a.role === "trainer" ? -1 : 1));
  }, [data]);
  const me = members.find((m) => m.user_id === userId);
  const isTrainer = me?.role === "trainer";
  const today = toISODate();

  const past = useMemo(() => {
    const base = data?.past ?? [];
    if (!extra) return base;
    const seen = new Set(base.map((w) => w.id));
    return [...base, ...extra.items.filter((w) => !seen.has(w.id))];
  }, [data, extra]);
  const hasMorePast = extra ? extra.hasMore : (data?.hasMorePast ?? false);
  const attendance = useMemo(() => ({ ...(data?.attendance ?? {}), ...(extra?.attendance ?? {}) }), [data, extra]);
  const upcoming = useMemo(() => data?.upcoming ?? [], [data]);
  const todays = useMemo(() => upcoming.filter((w) => w.date === today && w.exerciseCount > 0), [upcoming, today]);
  const later = useMemo(() => upcoming.filter((w) => !todays.includes(w)), [upcoming, todays]);

  // Per lid de datum van elke groepstraining waarin diegene sets logde (aanwezigheidsranglijst).
  // Uit een vast venster van weken, zodat "Meer laden" de cijfers niet verandert.
  const attendanceByUser = useMemo(() => {
    const out: Record<string, string[]> = {};
    const source = data?.window ?? [...upcoming.filter((u) => u.date === today), ...(data?.past ?? [])];
    for (const w of source) {
      for (const uid of data?.attendance[w.id] ?? []) (out[uid] ??= []).push(w.date);
    }
    return out;
  }, [data, upcoming, today]);

  const thisWeek = useMemo(() => {
    const { from, to } = weekRange(0);
    return [...past, ...upcoming].filter((w) => w.date >= from && w.date <= to);
  }, [past, upcoming]);

  // Vorige week, voor "Vorige week herhalen" (alleen trainingen met oefeningen).
  const lastWeek = useMemo(() => {
    const { from, to } = weekRange(-1);
    return past.filter((w) => w.date >= from && w.date <= to && w.exerciseCount > 0);
  }, [past]);

  const nameOf = useCallback((uid: string) => memberName(members.find((m) => m.user_id === uid)), [members]);
  const photoOf = useCallback((uid: string) => members.find((m) => m.user_id === uid)?.profiles?.avatar_url ?? null, [members]);

  function selectTab(next: TabKey, focus = false) {
    setTab(next);
    writeTab(id, next);
    if (focus) tabRefs.current[TABS.findIndex((t) => t.key === next)]?.focus();
  }

  function onTabKey(e: React.KeyboardEvent, index: number) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      selectTab(TABS[e.key === "Home" ? 0 : TABS.length - 1].key, true);
    } else if (delta) {
      e.preventDefault();
      selectTab(TABS[(index + delta + TABS.length) % TABS.length].key, true);
    }
  }

  async function loadMorePast() {
    if (!data) return;
    setLoadingMore(true);
    const base = pastSig;
    try {
      const page = await fetchPastWorkouts(id, past.length);
      const att = await fetchAttendance(page.items.map((w) => w.id));
      // Is de groepsdata intussen ververst, dan valt deze pagina vanzelf weg (basedOn klopt niet meer).
      setExtra((prev) => {
        const keep = prev && prev.basedOn === base ? prev : null;
        return {
          basedOn: base,
          items: [...(keep?.items ?? []), ...page.items],
          attendance: { ...(keep?.attendance ?? {}), ...att },
          hasMore: page.hasMore,
        };
      });
    } catch {
      toast.error("Kan eerdere trainingen niet laden");
    }
    setLoadingMore(false);
  }

  async function deleteGroup() {
    setDeleteBusy(true);
    setDeleteError(null);
    const { data: deleted, error } = await supabase.from("groups").delete().eq("id", id).select("id");
    if (error || !deleted?.length) {
      setDeleteBusy(false);
      setDeleteError(
        error
          ? /fetch|network/i.test(errorMessage(error))
            ? "Geen verbinding. Probeer het opnieuw."
            : errorMessage(error)
          : "Alleen trainers kunnen de groep verwijderen.",
      );
      return;
    }
    goHomeAfterExit();
  }

  function goHomeAfterExit() {
    // forgetGroup laat de data van deze (nog zichtbare) pagina staan: geen skeleton-flits.
    router.replace("/");
    forgetGroup(id, userId);
    try {
      localStorage.removeItem(tabStorageKey(id));
    } catch {
      // niet belangrijk
    }
  }

  const onMemberChanged = useCallback(
    (message: string) => {
      setManaging(null);
      refreshGroup(id, userId);
      invalidate("leaderboard:");
      toast.success(message);
    },
    [id, userId],
  );

  // ─────────────── Fout- en laadtoestanden ───────────────

  if (error?.kind === "notfound") {
    return (
      <AppShell title="Groep" back="/">
        <div className="card animate-fade-up space-y-3 text-center">
          <p className="font-semibold">Groep niet gevonden</p>
          <p className="text-sm text-muted">Deze groep bestaat niet meer, of je bent geen lid (meer). Vraag de trainer om een nieuwe uitnodiging.</p>
          <Link href="/" className="btn-ghost w-full">
            Naar home
          </Link>
        </div>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell title="Groep" back="/">
        {error ? (
          <div className="card animate-fade-up space-y-3 text-center">
            <p className="font-semibold">Kan groep niet laden</p>
            <p className="text-sm text-muted">{error.message}</p>
            <button className="btn-primary w-full" onClick={retry}>
              Opnieuw proberen
            </button>
          </div>
        ) : (
          <GroupSkeleton />
        )}
      </AppShell>
    );
  }

  return (
    <AppShell
      title={group?.name ?? "Groep"}
      back="/"
      action={
        <div className="flex items-center gap-1">
          <button
            className="flex h-11 w-11 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink active:scale-95"
            onClick={() => setInviteOpen(true)}
            aria-label="Vrienden uitnodigen"
            title="Vrienden uitnodigen"
          >
            <UserPlusIcon size={20} />
          </button>
          {isTrainer && (
            <Link href={`/groups/${id}/plan`} className="flex min-h-11 items-center" aria-label="Training plannen">
              <span className="btn-primary min-h-9 px-3 py-1.5 text-xs">
                <PlusIcon size={14} strokeWidth={2.6} />
                Training
              </span>
            </Link>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="animate-fade-in flex items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 py-1 pl-3 pr-1 text-sm">
            <span className="min-w-0 flex-1 text-warn">Geen verbinding. Je ziet de laatst bekende gegevens.</span>
            <button className="min-h-11 shrink-0 rounded-lg px-3 font-semibold text-ink underline-offset-2 hover:underline" onClick={retry}>
              Opnieuw
            </button>
          </div>
        )}

        {/* ─────────────── Vandaag (live) ─────────────── */}
        {todays.map((w) => (
          <TodayPanel key={w.id} workout={w} members={members} userId={userId} isTrainer={isTrainer} />
        ))}

        {/* ─────────────── Onderdelen ─────────────── */}
        <div role="tablist" aria-label="Onderdelen van de groep" className="grid grid-cols-4 gap-1 rounded-2xl border border-line bg-surface p-1">
          {TABS.map((t, i) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                role="tab"
                id={`tab-${t.key}`}
                aria-selected={active}
                aria-controls={`panel-${t.key}`}
                tabIndex={active ? 0 : -1}
                onClick={() => selectTab(t.key)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={`min-h-11 truncate rounded-xl px-1 text-[13px] font-semibold transition active:scale-95 ${
                  active ? "bg-surface-2 text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div key={tab} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="animate-fade-in">
          {tab === "trainingen" && (
            <section className="space-y-3" aria-label="Trainingen">
              <WeekStrip groupId={id} workouts={thisWeek} isTrainer={isTrainer} />

              {isTrainer && group && (
                <div className={`grid gap-2 ${lastWeek.length ? "grid-cols-2" : "grid-cols-1"}`}>
                  {lastWeek.length > 0 && (
                    <button className="btn-ghost min-h-11 px-3 text-[13px] leading-tight" onClick={() => setRepeatOpen(true)}>
                      <RepeatIcon />
                      Vorige week herhalen
                    </button>
                  )}
                  <Link
                    href={`/coach?q=${encodeURIComponent(
                      `Groepscheck: wie van ${group.name} loopt achter, en op welke spiergroepen? Stel daarna de volgende training voor.`,
                    )}`}
                    className="btn-ghost min-h-11 px-3 text-[13px] leading-tight"
                  >
                    <SparkleIcon size={16} />
                    Groepscheck met coach
                  </Link>
                </div>
              )}

              {upcoming.length === 0 ? (
                <div className="card space-y-3 text-sm text-muted">
                  <p>{isTrainer ? "Nog niets gepland. Zet een training klaar, dan kan iedereen zijn sets erin loggen." : "Nog niets gepland door de trainer."}</p>
                  {isTrainer && (
                    <Link href={`/groups/${id}/plan`} className="btn-primary min-h-11 w-full">
                      Training plannen
                    </Link>
                  )}
                </div>
              ) : (
                later.length > 0 && (
                  <div className="space-y-2">
                    <SectionTitle>Gepland</SectionTitle>
                    <ul className="space-y-2">
                      {later.map((w, i) => (
                        <li key={w.id} className="animate-fade-up" style={{ "--i": i } as React.CSSProperties}>
                          <WorkoutRow
                            w={w}
                            today={today}
                            present={w.date === today ? (attendance[w.id] ?? []) : null}
                            memberCount={members.length}
                            nameOf={nameOf}
                            photoOf={photoOf}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )}

              {past.length > 0 && (
                <div className="space-y-2">
                  <button
                    className="flex min-h-11 w-full items-center gap-2 rounded-xl px-1 text-sm font-medium text-muted hover:text-ink"
                    onClick={() => setShowPast((v) => !v)}
                    aria-expanded={showPast}
                  >
                    <ChevronRightIcon size={16} className={`transition-transform duration-200 ${showPast ? "rotate-90" : ""}`} />
                    Eerdere trainingen ({past.length}
                    {hasMorePast ? "+" : ""})
                  </button>
                  {showPast && (
                    <ul className="space-y-2">
                      {past.map((w, i) => (
                        <li key={w.id} className="animate-fade-up" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
                          <WorkoutRow
                            w={w}
                            today={today}
                            present={attendance[w.id] ?? []}
                            memberCount={members.length}
                            nameOf={nameOf}
                            photoOf={photoOf}
                            replanHref={isTrainer ? `/groups/${id}/plan?from=${w.id}` : undefined}
                          />
                        </li>
                      ))}
                      {hasMorePast && (
                        <li>
                          <button className="btn-ghost min-h-11 w-full" onClick={loadMorePast} disabled={loadingMore}>
                            {loadingMore ? "Laden…" : "Meer laden"}
                          </button>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}

          {tab === "activiteit" && <GroupFeed groupId={id} userId={userId} onError={(m) => toast.error(m)} />}

          {tab === "ranglijst" &&
            (members.length > 0 ? (
              <div className="space-y-6">
                <GroupLeaderboard members={members} userId={userId} groupId={id} attendance={attendanceByUser} />
                <StepsLeaderboard userId={userId} scope={{ scope: "group", groupId: id }} />
              </div>
            ) : (
              <div className="card text-sm text-muted">Nog geen leden om te vergelijken.</div>
            ))}

          {tab === "leden" && (
            <div className="space-y-5">
              <section className="space-y-3" aria-labelledby="h-leden">
                <SectionTitle id="h-leden">Leden ({members.length})</SectionTitle>
                <ul className="card divide-y divide-line p-0">
                  {members.map((m, i) => {
                    const name = memberName(m);
                    const self = m.user_id === userId;
                    return (
                      <li key={m.user_id} className="animate-fade-up flex items-center gap-1 pr-2" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
                        <Link
                          href={`/ranks?user=${m.user_id}`}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-4 py-3 transition hover:bg-surface-2"
                        >
                          <Avatar id={m.user_id} name={name} src={m.profiles?.avatar_url} size={36} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">
                              {name}
                              {self && <span className="font-normal text-muted"> (jij)</span>}
                            </p>
                            <p className={`text-xs ${m.role === "trainer" ? "text-accent" : "text-muted"}`}>{m.role === "trainer" ? "Trainer" : "Lid"}</p>
                          </div>
                        </Link>
                        {isTrainer && !self && (
                          <button
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink active:scale-95"
                            onClick={() => setManaging(m)}
                            aria-label={`${name} beheren`}
                          >
                            <DotsIcon />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <button className="btn-ghost min-h-11 w-full" onClick={() => setInviteOpen(true)}>
                  <UserPlusIcon size={16} />
                  Vrienden uitnodigen
                </button>
              </section>

              <section className="flex flex-wrap gap-2 border-t border-line pt-5" aria-label="Groep beheren">
                {isTrainer && (
                  <button className="btn-ghost min-h-11" onClick={() => setSettingsOpen(true)}>
                    Groepsinstellingen
                  </button>
                )}
                {me && (
                  <button
                    className="btn-ghost min-h-11"
                    onClick={() => {
                      // Verse ledenlijst, zodat overdragen of verwijderen op de juiste stand gebaseerd is.
                      refreshGroup(id);
                      setLeaving(true);
                    }}
                  >
                    Groep verlaten
                  </button>
                )}
                {isTrainer && (
                  <button
                    className="btn-danger min-h-11"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteOpen(true);
                    }}
                  >
                    Groep verwijderen
                  </button>
                )}
              </section>
            </div>
          )}
        </div>
      </div>

      {managing && <MemberSheet member={managing} groupId={id} onClose={() => setManaging(null)} onChanged={onMemberChanged} />}

      {leaving && (
        <LeaveSheet groupId={id} members={members} userId={userId} onClose={() => setLeaving(false)} onLeft={goHomeAfterExit} />
      )}

      {repeatOpen && (
        <RepeatWeekSheet
          groupId={id}
          lastWeek={lastWeek}
          existing={[...past, ...upcoming]}
          onClose={() => setRepeatOpen(false)}
          onDone={(count, partialError) => {
            setRepeatOpen(false);
            refreshTrainingData(id);
            if (partialError) toast.error(partialError);
            else toast.success(count === 1 ? "1 training gepland" : `${count} trainingen gepland`);
          }}
        />
      )}

      {group && <InviteSheet group={group} open={inviteOpen} onClose={() => setInviteOpen(false)} onMessage={(m) => toast(m)} />}

      {settingsOpen && group && (
        <GroupSettingsSheet
          group={group}
          onClose={() => setSettingsOpen(false)}
          onChanged={(message) => {
            setSettingsOpen(false);
            refreshGroup(id, userId);
            toast.success(message);
          }}
        />
      )}

      <ConfirmSheet
        open={deleteOpen}
        title="Groep verwijderen?"
        danger
        busy={deleteBusy}
        error={deleteError}
        confirmLabel="Definitief verwijderen"
        onConfirm={deleteGroup}
        onClose={() => setDeleteOpen(false)}
        body={
          <>
            <span className="font-semibold text-ink">{group?.name}</span> wordt verwijderd, met alle trainingen, gelogde sets en
            activiteit. Dit kan niet ongedaan worden gemaakt.
          </>
        }
      />

    </AppShell>
  );
}

function SectionTitle({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
      {children}
    </h2>
  );
}

function GroupSkeleton() {
  return (
    <div className="space-y-5" aria-busy aria-label="Groep laden">
      <div className="skeleton h-[52px] rounded-2xl" />
      <div className="space-y-3">
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="skeleton h-14" />
          ))}
        </div>
        <div className="skeleton h-3 w-20" />
        <div className="skeleton h-[72px]" />
        <div className="skeleton h-[72px]" />
      </div>
    </div>
  );
}

function WorkoutRow({
  w,
  today,
  present,
  memberCount,
  nameOf,
  photoOf,
  replanHref,
}: {
  w: GroupWorkout;
  today: string;
  /** Wie er sets logde; null = niet tonen (training ligt nog in de toekomst). */
  present: string[] | null;
  memberCount: number;
  nameOf: (uid: string) => string;
  photoOf?: (uid: string) => string | null;
  replanHref?: string;
}) {
  const isToday = w.date === today;
  const [y, mo, d] = w.date.split("-").map(Number);
  const date = new Date(y, mo - 1, d);
  return (
    <div className="flex items-stretch gap-2">
      <Link
        href={`/workouts/${w.id}`}
        className={`card flex min-w-0 flex-1 items-center gap-3 py-3 hover:border-muted active:scale-[0.99] ${
          isToday ? "border-accent/50 bg-accent/5" : ""
        }`}
      >
        <div
          className={`flex w-11 shrink-0 flex-col items-center rounded-xl py-1.5 ${isToday ? "bg-accent text-accent-ink" : "bg-surface-2"}`}
          aria-hidden
        >
          <span className="text-[10px] font-semibold uppercase leading-none opacity-80">
            {date.toLocaleDateString("nl-NL", { month: "short" }).replace(".", "")}
          </span>
          <span className="text-lg font-bold leading-tight tabular-nums">{d}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{w.title}</p>
          <p className="truncate text-xs text-muted">
            {relativeDay(w.date)} · {plural(w.exerciseCount, "oefening", "oefeningen")}
          </p>
          {present && (
            <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
              {present.length > 0 ? (
                <>
                  <AvatarStack people={present.map((uid) => ({ id: uid, name: nameOf(uid), src: photoOf?.(uid) }))} size={20} />
                  <span className="truncate">
                    {present.length} van {memberCount} getraind
                  </span>
                </>
              ) : (
                <span>{isToday ? "Nog niemand heeft sets gelogd" : "Niemand heeft sets gelogd"}</span>
              )}
            </div>
          )}
        </div>
        <ChevronRightIcon className="shrink-0 text-muted" />
      </Link>
      {replanHref && (
        <Link
          href={replanHref}
          className="flex w-11 shrink-0 items-center justify-center rounded-2xl border border-line bg-surface text-muted transition hover:border-muted hover:text-ink active:scale-95"
          aria-label={`${w.title} opnieuw plannen`}
          title="Opnieuw plannen"
        >
          <RepeatIcon />
        </Link>
      )}
    </div>
  );
}

function DotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a3 3 0 013-3h15" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a3 3 0 01-3 3H3" />
    </svg>
  );
}
