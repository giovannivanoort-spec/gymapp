"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { Avatar, ProfileButton } from "@/components/Avatar";
import { BookIcon, ChevronRightIcon, SparkleIcon } from "@/components/Icons";
import { Portal } from "@/components/Portal";
import { ActivityCard } from "@/components/home/ActivityCard";
import { GroupChoiceSheet, JoinSheet, NewGroupSheet } from "@/components/home/GroupSheets";
import { HomeFriends } from "@/components/home/HomeFriends";
import { HomeGroups } from "@/components/home/HomeGroups";
import { NutritionCard, fetchFoodWeek } from "@/components/home/NutritionCard";
import { Onboarding } from "@/components/home/Onboarding";
import { PlanStrip } from "@/components/home/PlanStrip";
import { PullToRefresh } from "@/components/home/PullToRefresh";
import { RankGoalCard } from "@/components/home/RankGoalCard";
import { RestCard } from "@/components/home/RestCard";
import { SyncNote, type HomeSyncStatus } from "@/components/home/SyncNote";
import { TodaySession } from "@/components/home/TodaySession";
import { WeekGoalSheet } from "@/components/home/WeekGoalSheet";
import { WeekRecap } from "@/components/home/WeekRecap";
import { WeekRecords } from "@/components/home/WeekRecords";
import { fetchUpcoming } from "@/components/home/data";
import { GREETINGS, refreshLive, strict, useClock, useRefreshOnResume, useSyncStatus } from "@/components/home/live";
import { invalidateActivity } from "@/lib/activity";
import { fetchCached, getCachedAt, useCachedState, type CachedState } from "@/lib/cache";
import { ageFrom, toISODate } from "@/lib/dates";
import { fetchFriends } from "@/lib/friends";
import { fetchMyGroups, myGroupsKey } from "@/lib/groups";
import { fetchHistory } from "@/lib/history";
import type { NutritionProfile } from "@/lib/nutrition/targets";
import { aggregateRanks, type LogLike } from "@/lib/ranks";
import { rankAll } from "@/lib/useRanks";
import { parseISODate } from "@/lib/week";

/**
 * De volledige geschiedenis is groot (alle sets ooit). Na het loggen maakt de trainingspagina hem
 * zelf ongeldig, en terugkeren naar de app of trek-om-te-verversen haalt hem ook opnieuw op; Home
 * hoeft hem dus niet bij elk bezoek opnieuw te downloaden.
 */
const HISTORY_MAX_AGE = 5 * 60_000;

/** Zichtbaar wel of niet geladen: nog niets bekend en de laatste poging mislukte (niet tijdens een nieuwe poging). */
const failedToLoad = (s: CachedState<unknown>) => s.data === undefined && !!s.error;

export default function HomePage() {
  const { profile, refreshProfile } = useAuth();
  const userId = useUserId();
  const router = useRouter();
  const { today, part } = useClock();
  // De dagwissel handelt deze pagina zelf af (hieronder), met de fetchers van de nieuwe dag. Daarom
  // krijgt de hook een vaste waarde: anders ververst hij eerder, nog met de fetchers van gisteren.
  useRefreshOnResume();
  const liveStatus = useSyncStatus();

  const [newOpen, setNewOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [chooseOpen, setChooseOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);

  // Alles via strikte fetchers: een mislukt verzoek (slecht bereik) laat de vorige gegevens staan.
  // Per bron een eigen status, zodat een trage of mislukte bron alleen zijn eigen blok raakt.
  const uid = userId || null;
  const sources = [
    { key: uid && `history:${uid}`, fetcher: strict("history", () => fetchHistory(userId)), maxAge: HISTORY_MAX_AGE },
    { key: uid && `friends:${uid}`, fetcher: strict("friends", () => fetchFriends(userId)), maxAge: 15_000 },
    // Dezelfde fetcher (en volgorde) als de rest van de app, die deze sleutel deelt.
    { key: uid && myGroupsKey(uid), fetcher: strict("groups", () => fetchMyGroups(userId)), maxAge: 10_000 },
    { key: uid && `home:workouts:${uid}`, fetcher: strict("workouts", () => fetchUpcoming(today)), maxAge: 10_000 },
    { key: uid && `home:food-week:${uid}`, fetcher: strict("food", () => fetchFoodWeek(today)), maxAge: 10_000 },
  ] as const;
  const historyS = useCachedState(sources[0].key, sources[0].fetcher, { persist: true, maxAge: sources[0].maxAge });
  const friendsS = useCachedState(sources[1].key, sources[1].fetcher, { persist: true, maxAge: sources[1].maxAge });
  const groupsS = useCachedState(sources[2].key, sources[2].fetcher, { persist: true, maxAge: sources[2].maxAge });
  const upcomingS = useCachedState(sources[3].key, sources[3].fetcher, { persist: true, maxAge: sources[3].maxAge });
  const foodS = useCachedState(sources[4].key, sources[4].fetcher, { persist: true, maxAge: sources[4].maxAge });
  const history = historyS.data;
  const friends = friendsS.data;
  const groups = groupsS.data;
  const upcoming = upcomingS.data;

  /** Alles verversen en wachten tot de gegevens van deze pagina binnen zijn (trek-om-te-verversen, "Opnieuw"). */
  const refreshAll = () => {
    refreshLive();
    // Stappen (eigen kaart, eigen sleutels): op de achtergrond mee verversen.
    if (uid) invalidateActivity(uid);
    return Promise.allSettled(sources.map(({ key, fetcher }) => (key ? fetchCached<unknown>(key, fetcher, true) : null)));
  };

  // Een nieuwe dag terwijl de app open bleef: alles opnieuw ophalen, met de fetchers van vandaag
  // (komende trainingen en eten hangen van de datum af). Een effect-event ziet altijd de nieuwste.
  const onNewDay = useEffectEvent(() => {
    refreshAll();
  });
  const seenDay = useRef(today);
  useEffect(() => {
    if (seenDay.current === today) return;
    seenDay.current = today;
    onNewDay();
  }, [today]);

  // Offline of verversen mislukt. Een offline kopie van de service worker (wel wifi, geen internet)
  // zit in de status per sleutel van de cache en telt dus ook als offline. "Mislukt" komt alleen uit
  // die status per sleutel: die volgt de laatste poging, ook als een ander scherm de sleutel ophaalde.
  const states = [historyS, friendsS, groupsS, upcomingS, foodS];
  const anyOffline = states.some((s) => s.offline);
  const anyError = states.some((s) => (s.error || s.stale) && !s.offline);
  const status: HomeSyncStatus = liveStatus === "offline" || anyOffline ? "offline" : anyError ? "error" : "ok";

  const bodyweight = profile?.bodyweight_kg ?? null;
  const sex = profile?.sex ?? null;
  const age = ageFrom(profile?.birth_date);
  const overall = useMemo(() => {
    if (!history) return undefined;
    const logs = new Map<string, LogLike[]>();
    for (const s of history) {
      const set = { weight: s.weight, reps: s.reps };
      const list = logs.get(s.slug);
      if (list) list.push(set);
      else logs.set(s.slug, [set]);
    }
    return aggregateRanks(rankAll(logs, bodyweight, sex, age)).overall;
  }, [history, bodyweight, sex, age]);
  const trainedDays = useMemo(
    () => (history ? new Set(history.filter((s) => (s.reps ?? 0) > 0).map((s) => s.date)) : null),
    [history],
  );
  // Vandaag gelogd, ook als het een training van een andere dag was (bijv. een ingehaalde training).
  const loggedToday = useMemo(
    () => !!history?.some((s) => (s.reps ?? 0) > 0 && !!s.createdAt && toISODate(new Date(s.createdAt)) === today),
    [history, today],
  );

  // Gecachete lijst kan van gisteren zijn: altijd zelf op datum filteren.
  const workouts = useMemo(() => (upcoming ?? []).filter((w) => w.date >= today), [upcoming, today]);
  const plannedDays = useMemo(() => (upcoming ? new Set(workouts.map((w) => w.date)) : null), [upcoming, workouts]);
  const todays = workouts.filter((w) => w.date === today);
  const later = workouts.filter((w) => w.date !== today);
  // Zonder training vandaag noemt de rustkaart de eerstvolgende al: die niet dubbel tonen.
  const soon = todays.length ? later : later.slice(1);
  const trainerGroups = groups?.filter((g) => g.role === "trainer") ?? [];
  const isTrainerOf = (groupId: string) => trainerGroups.some((g) => g.id === groupId);
  const planGroupId = trainerGroups[0]?.id ?? null;
  // De rustkaart toont zelf "Training plannen" als er niets gepland is; anders zit die in de strook.
  const stripPlanHref = planGroupId && (todays.length > 0 || later.length > 0) ? `/groups/${planGroupId}/plan` : null;

  const firstName = profile?.display_name?.split(" ")[0] ?? "";
  const incoming = friends?.incoming ?? [];
  const profileDone = !!(profile?.bodyweight_kg && profile.sex);
  const goal = profile?.weekly_goal ?? 3;
  const dateLabel = parseISODate(today).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
  const trainHref = todays[0] ? `/workouts/${todays[0].id}` : later[0] ? `/workouts/${later[0].id}` : groups?.[0] ? `/groups/${groups[0].id}` : null;
  const hasTrained = history ? history.some((s) => (s.reps ?? 0) > 0) : null;

  // Hoe oud is wat we tonen? De oudste van de gegevens op deze pagina die er wel zijn.
  const stamps = sources.map(({ key }) => (key ? getCachedAt(key) : -1)).filter((t) => t > 0);
  const syncedAt = stamps.length ? Math.min(...stamps) : null;

  const onboarding = (
    <Onboarding
      profileDone={profileDone}
      hasGroup={groups ? groups.length > 0 : null}
      hasFriend={friends ? friends.friends.length > 0 : null}
      hasTrained={hasTrained}
      trainHref={trainHref}
      onGroup={() => setChooseOpen(true)}
    />
  );

  const todayBlock =
    todays.length > 0 ? (
      <section className="space-y-3" aria-label="Training van vandaag">
        {todays.map((w, i) => (
          <TodaySession key={w.id} w={w} index={i} userId={userId} isTrainer={isTrainerOf(w.group_id)} history={history} />
        ))}
      </section>
    ) : (
      <RestCard
        loading={upcoming === undefined}
        failed={failedToLoad(upcomingS)}
        trainedToday={loggedToday}
        next={later[0] ?? null}
        planGroupId={planGroupId}
        onRetry={refreshAll}
      />
    );

  return (
    <AppShell>
      {/* Achtergrond onder de iOS-statusbalk, zodat kaarten er niet onderdoor scrollen. */}
      <Portal>
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-20 h-[env(safe-area-inset-top)] bg-bg/90 backdrop-blur" />
      </Portal>
      <PullToRefresh onRefresh={refreshAll} />

      <div className="space-y-6 pt-[env(safe-area-inset-top)]">
        <header className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm capitalize text-muted">{dateLabel}</p>
            <h1 className="break-words text-[26px] font-extrabold leading-[1.15] tracking-tight sm:text-[28px]">
              {GREETINGS[part]}
              {firstName && (
                <>
                  ,<span className="block text-accent sm:ml-[0.25em] sm:inline">{firstName}</span>
                </>
              )}
            </h1>
          </div>
          <div className="flex shrink-0 items-center">
            <Link href="/coach" aria-label="Coach" className="group -my-1.5 flex h-11 w-11 items-center justify-center rounded-full">
              <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-line bg-surface text-accent transition group-hover:border-muted group-active:scale-95">
                <SparkleIcon size={18} />
              </span>
            </Link>
            <ProfileButton id={userId} name={profile?.display_name ?? ""} src={profile?.avatar_url} />
          </div>
        </header>

        {status !== "ok" && (
          <SyncNote status={status} syncedAt={syncedAt} today={today} canRetry={liveStatus !== "offline"} onRetry={refreshAll} />
        )}

        {incoming.length > 0 && (
          <Link href="/friends" className="card animate-fade-up flex items-center gap-3 border-accent/40 bg-accent/5 p-3">
            <Avatar id={incoming[0].id} name={incoming[0].display_name} src={incoming[0].avatar_url} size={32} />
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-semibold">{incoming[0].display_name}</span>
              {incoming.length > 1
                ? ` en ${incoming.length - 1} ${incoming.length === 2 ? "ander willen" : "anderen willen"}`
                : " wil"}{" "}
              je vriend worden
            </p>
            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink">Bekijk</span>
          </Link>
        )}

        {/* De training van vandaag staat bovenaan: daar open je de app meestal voor. Zonder training
            vandaag gaat de checklist voor nieuwe gebruikers voor. De planning volgt direct daarna. */}
        {todays.length > 0 ? (
          <>
            {todayBlock}
            <PlanStrip workouts={soon} title="Binnenkort" today={today} planHref={stripPlanHref} />
            {onboarding}
          </>
        ) : (
          <>
            {onboarding}
            {todayBlock}
            <PlanStrip workouts={soon} title="Daarna" today={today} planHref={stripPlanHref} />
          </>
        )}

        <WeekRecap userId={userId} history={history} goal={goal} today={today} friends={friends?.friends} />

        <RankGoalCard
          overall={overall}
          rankFailed={failedToLoad(historyS)}
          profileDone={profileDone}
          days={trainedDays}
          planned={plannedDays}
          goal={goal}
          today={today}
          goalFailed={failedToLoad(historyS)}
          onEditGoal={() => setGoalOpen(true)}
        />

        <WeekRecords history={history} today={today} />

        <HomeFriends userId={userId} friends={friends} failed={failedToLoad(friendsS)} today={today} />

        <NutritionCard week={foodS.data} failed={failedToLoad(foodS)} today={today} profile={profile as NutritionProfile | null} userId={userId} />

        <ActivityCard userId={userId} today={today} />

        <HomeGroups
          groups={groups}
          failed={failedToLoad(groupsS)}
          onAdd={() => setChooseOpen(true)}
          onNew={() => setNewOpen(true)}
          onJoin={() => setJoinOpen(true)}
          onRetry={groupsS.retry}
        />

        {/* De enige ingang naar de oefeningenbibliotheek: klein en rustig onderaan. */}
        <Link
          href="/exercises"
          className="mx-auto flex min-h-11 w-fit items-center gap-2 rounded-full px-3 text-xs font-semibold text-muted transition-colors hover:text-ink"
        >
          <BookIcon size={14} /> Oefeningenbibliotheek
          <ChevronRightIcon size={14} />
        </Link>
      </div>

      <GroupChoiceSheet
        open={chooseOpen}
        onClose={() => setChooseOpen(false)}
        onNew={() => {
          setChooseOpen(false);
          setNewOpen(true);
        }}
        onJoin={() => {
          setChooseOpen(false);
          setJoinOpen(true);
        }}
      />
      <NewGroupSheet open={newOpen} userId={userId} onClose={() => setNewOpen(false)} onCreated={(id) => router.push(`/groups/${id}`)} />
      <JoinSheet open={joinOpen} onClose={() => setJoinOpen(false)} />
      {goalOpen && (
        <WeekGoalSheet
          userId={userId}
          goal={goal}
          days={trainedDays}
          today={today}
          onClose={() => setGoalOpen(false)}
          onSaved={refreshProfile}
        />
      )}
    </AppShell>
  );
}
