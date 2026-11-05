"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { ArrowDownIcon, ArrowUpIcon } from "@/components/Icons";
import { MonthCalendar } from "@/components/MonthCalendar";
import { DataStatus } from "@/components/platform/DataStatus";
import { LoadError } from "@/components/platform/LoadError";
import { ProgressBodyweight } from "@/components/ProgressBodyweight";
import { WeeklyVolume } from "@/components/WeeklyVolume";
import { DayDetail, type PlannedWorkout } from "@/components/progress/DayDetail";
import { ExerciseProgress } from "@/components/progress/ExerciseProgress";
import { RankSummaryCard } from "@/components/progress/RankSummaryCard";
import { RecentPRs } from "@/components/progress/RecentPRs";
import { Records } from "@/components/progress/Records";
import { TrainingRhythm } from "@/components/progress/TrainingRhythm";
import { toISODate } from "@/lib/dates";
import { nl, sessionsBySlug, useHistoryState, type HistorySet, type Session } from "@/lib/history";
import { exerciseName, monthRecap, recentPRs } from "@/lib/progress/records";
import { useSafeCached } from "@/lib/progress/safeCache";
import { supabase } from "@/lib/supabase";

const TABS = [
  { id: "overzicht", label: "Overzicht" },
  { id: "volume", label: "Volume" },
  { id: "oefeningen", label: "Oefeningen" },
  { id: "gewicht", label: "Gewicht" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function ProgressPage() {
  return (
    <Suspense
      fallback={
        <AppShell title="Progressie">
          <ProgressSkeleton />
        </AppShell>
      }
    >
      <Progress />
    </Suspense>
  );
}

function ProgressSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Progressie laden">
      <div className="skeleton h-11" />
      <div className="skeleton h-80" />
      <div className="skeleton h-40" />
    </div>
  );
}

type PlannedRow = { id: string; date: string; title: string; groups: { name: string } | null };

async function fetchPlanned(from: string, to: string): Promise<PlannedWorkout[]> {
  const { data, error } = await supabase
    .from("workouts")
    .select("id, date, title, groups!inner(name)")
    .gte("date", from)
    .lte("date", to)
    .order("date");
  if (error) throw error;
  return ((data ?? []) as unknown as PlannedRow[]).map((w) => ({ id: w.id, date: w.date, title: w.title, group: w.groups?.name ?? null }));
}

function Progress() {
  const userId = useUserId();
  const { profile } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : "overzicht";

  // Gedeelde, gecachete geschiedenis: direct zichtbaar als je eerder op Home of Ranks was.
  const historyState = useHistoryState(userId);
  const history = historyState.data;
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [exercise, setExercise] = useState<string | null>(null);
  // Bezochte tabs blijven gemonteerd (verborgen), zodat gekozen maatstaf, periode en week blijven staan.
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(() => new Set([tab]));
  if (!visited.has(tab)) setVisited(new Set([...visited, tab]));
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const tabButtons = useRef(new Map<TabId, HTMLButtonElement>());
  const chartRef = useRef<HTMLElement | null>(null);

  // Geplande groepstrainingen in de getoonde maand; per maand onthouden, dus terugbladeren is direct.
  const monthKey = toISODate(month).slice(0, 7);
  const {
    data: plannedList,
    error: plannedError,
    retry: retryPlanned,
  } = useSafeCached(
    `progress:planned:${userId}:${monthKey}`,
    () => fetchPlanned(toISODate(month), toISODate(new Date(month.getFullYear(), month.getMonth() + 1, 0))),
    { persist: true, maxAge: 60_000 },
  );
  const planned = useMemo(() => new Set((plannedList ?? []).map((w) => w.date)), [plannedList]);

  const sessions = useMemo(() => (history ? sessionsBySlug(history) : new Map<string, Session[]>()), [history]);

  const trained = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of history ?? []) if ((s.reps ?? 0) > 0) map.set(s.date, (map.get(s.date) ?? 0) + 1);
    return map;
  }, [history]);

  const trainedDays = useMemo(() => [...trained.keys()], [trained]);

  // Standaard: de laatste getrainde dag in de getoonde maand, anders vandaag (als die in beeld is).
  const today = toISODate();
  const lastTrainedInMonth = useMemo(
    () =>
      [...trained.keys()]
        .filter((d) => d.startsWith(monthKey) && d <= today)
        .sort()
        .at(-1) ?? null,
    [trained, monthKey, today],
  );
  // Een keuze uit een andere maand telt niet: dan weer de standaard van de getoonde maand.
  const chosen = selected?.startsWith(monthKey) ? selected : null;
  const day = chosen ?? lastTrainedInMonth ?? (today.startsWith(monthKey) ? today : null);
  const changeMonth = useCallback((m: Date) => {
    setMonth(m);
    setSelected(null);
  }, []);

  const exercises = useMemo(() => [...sessions].sort((a, b) => b[1].length - a[1].length).map(([slug]) => slug), [sessions]);
  const currentExercise = exercise && sessions.has(exercise) ? exercise : (exercises[0] ?? null);
  const prs = useMemo(() => recentPRs(sessions), [sessions]);

  // Maandcijfers, vergeleken met dezelfde periode van de vorige maand (lopende maand: tot vandaag).
  const monthStats = useMemo(() => {
    const prevMonth = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    const prevKey = toISODate(prevMonth).slice(0, 7);
    const isCurrent = today.startsWith(monthKey);
    const dayLimit = isCurrent ? Number(today.slice(8, 10)) : 31;
    const thisMonth = statsFor(history ?? [], (d) => d.startsWith(monthKey));
    const prev = statsFor(history ?? [], (d) => d.startsWith(prevKey) && Number(d.slice(8, 10)) <= dayLimit);
    const prevName = prevMonth.toLocaleDateString("nl-NL", { month: "short" }).replace(".", "");
    const monthName = month.toLocaleDateString("nl-NL", { month: "long" });
    return {
      ...thisMonth,
      prev,
      prevLabel: isCurrent ? `t.o.v. zelfde periode ${prevName}` : `t.o.v. ${prevName}`,
      recapLabel: isCurrent ? "deze maand" : `in ${monthName}`,
    };
  }, [history, month, monthKey, today]);
  const recap = useMemo(() => monthRecap(sessions, monthKey), [sessions, monthKey]);

  const goTab = useCallback(
    (next: TabId) => {
      const sp = new URLSearchParams(params.toString());
      if (next === "overzicht") sp.delete("tab");
      else sp.set("tab", next);
      const qs = sp.toString();
      router.replace(qs ? `/progress?${qs}` : "/progress", { scroll: false });
      // Als je al voorbij de tabs gescrold bent: terug naar het begin van de inhoud.
      const wrapper = tabsRef.current?.parentElement;
      if (wrapper) {
        const header = document.querySelector("header")?.getBoundingClientRect().height ?? 0;
        const target = wrapper.getBoundingClientRect().top + window.scrollY - header - 16;
        if (window.scrollY > target) window.scrollTo({ top: Math.max(0, target) });
      }
    },
    [params, router],
  );

  /** Pijltjes links/rechts, Home en End wisselen van tab (en verplaatsen de focus mee). */
  const onTabKey = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const i = TABS.findIndex((t) => t.id === tab);
      let next = -1;
      if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
      else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = TABS.length - 1;
      if (next < 0) return;
      e.preventDefault();
      const id = TABS[next].id;
      goTab(id);
      tabButtons.current.get(id)?.focus();
    },
    [goTab, tab],
  );

  /** Oefening tonen (vanuit records of recente records) en naar de grafiek scrollen. */
  const pendingScroll = useRef(false);
  const scrollToChart = useCallback(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    chartRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, []);
  const openExercise = useCallback(
    (slug: string) => {
      setExercise(slug);
      if (tab === "oefeningen") return scrollToChart();
      pendingScroll.current = true;
      goTab("oefeningen");
    },
    [goTab, tab, scrollToChart],
  );
  useEffect(() => {
    if (tab !== "oefeningen" || !pendingScroll.current) return;
    pendingScroll.current = false;
    scrollToChart();
  }, [tab, scrollToChart]);

  // De tabbalk plakt direct onder de (sticky) kop, wat de hoogte daarvan ook is (notch, titel).
  const stickyTabs = useCallback((el: HTMLDivElement | null) => {
    tabsRef.current = el;
    if (!el) return;
    const header = document.querySelector("header");
    if (!header) return;
    const ro = new ResizeObserver(() => {
      el.style.top = `${Math.round(header.getBoundingClientRect().height)}px`;
    });
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  return (
    <AppShell title="Progressie">
      {history === undefined ? (
        historyState.error ? (
          <LoadError
            error={historyState.error}
            onRetry={historyState.retry}
            retrying={historyState.refreshing}
            title="Kon je trainingen niet laden"
          />
        ) : (
          <SlowLoading onRetry={historyState.retry} />
        )
      ) : history.length === 0 ? (
        <div className="space-y-7">
          <div className="card animate-scale-in space-y-3 text-sm text-muted">
            <p className="font-semibold text-ink">Nog geen trainingen gelogd</p>
            <p>Zodra je sets invult bij een training, zie je hier je kalender, volume, grafieken en records.</p>
            <div className="flex gap-2">
              <Link href="/" className="btn-primary flex-1">
                Naar Home
              </Link>
              <button type="button" className="btn-ghost" onClick={historyState.retry} disabled={historyState.refreshing}>
                {historyState.refreshing ? "Bezig…" : "Opnieuw laden"}
              </button>
            </div>
          </div>
          <ProgressBodyweight />
        </div>
      ) : (
        <div className="space-y-6">
          <div ref={stickyTabs} className="sticky top-0 z-10 -mx-4 -mt-4 bg-bg/90 px-4 py-2.5 backdrop-blur">
            <div
              role="tablist"
              aria-label="Onderdelen van progressie"
              className="grid grid-cols-4 rounded-xl border border-line bg-surface-2 p-0.5 text-xs font-semibold"
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  ref={(el) => {
                    if (el) tabButtons.current.set(t.id, el);
                    else tabButtons.current.delete(t.id);
                  }}
                  type="button"
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={tab === t.id ? 0 : -1}
                  onClick={() => goTab(t.id)}
                  onKeyDown={onTabKey}
                  className={`rounded-[10px] px-1 py-2 transition ${tab === t.id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <DataStatus state={historyState} showAge />

          <TabPanel id="overzicht" active={tab} visited={visited}>
            <RankSummaryCard />

            <RecentPRs prs={prs} onOpen={openExercise} />

            <section className="card space-y-4">
              <MonthCalendar
                month={month}
                onMonth={changeMonth}
                selected={day}
                onSelect={setSelected}
                trained={trained}
                planned={planned}
                monthsAhead={1}
              />
              {plannedError && (
                <p role="status" className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
                  <span className="min-w-0">Geplande trainingen niet geladen.</span>
                  <button type="button" onClick={retryPlanned} className="shrink-0 font-semibold text-accent">
                    Opnieuw
                  </button>
                </p>
              )}
              <div className="space-y-3 border-t border-line pt-3">
                <div className="grid grid-cols-3 text-center">
                  <Stat
                    value={monthStats.sessions}
                    label={monthStats.sessions === 1 ? "training" : "trainingen"}
                    delta={monthStats.sessions - monthStats.prev.sessions}
                    show={monthStats.prev.sessions > 0}
                  />
                  <Stat
                    value={monthStats.sets}
                    label="sets"
                    delta={monthStats.sets - monthStats.prev.sets}
                    show={monthStats.prev.sets > 0}
                  />
                  <Stat
                    value={monthStats.volume >= 1000 ? `${nl(monthStats.volume / 1000)} t` : `${nl(monthStats.volume, 0)} kg`}
                    label="volume"
                    delta={
                      monthStats.prev.volume > 0
                        ? Math.round(((monthStats.volume - monthStats.prev.volume) / monthStats.prev.volume) * 100)
                        : 0
                    }
                    unit="%"
                    show={monthStats.prev.volume > 0}
                  />
                </div>
                {monthStats.prev.sets > 0 && <p className="text-center text-[11px] text-muted">{monthStats.prevLabel}</p>}
                {(recap.prs > 0 || recap.mostImproved) && (
                  <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 rounded-xl bg-surface-2 px-3 py-2 text-xs">
                    {recap.prs > 0 && (
                      <span>
                        <span className="font-bold tabular-nums text-accent">{recap.prs}</span>{" "}
                        <span className="text-muted">
                          {recap.prs === 1 ? "record" : "records"} {monthStats.recapLabel}
                        </span>
                      </span>
                    )}
                    {recap.mostImproved && (
                      <button type="button" onClick={() => openExercise(recap.mostImproved!.slug)} className="min-w-0 truncate text-left">
                        <span className="text-muted">Meest vooruit: </span>
                        <span className="font-semibold">{exerciseName(recap.mostImproved.slug)}</span>{" "}
                        <span className="font-semibold tabular-nums text-accent">+{nl(recap.mostImproved.pct)}%</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>

            {day && (
              <DayDetail day={day} history={history} sessions={sessions} planned={(plannedList ?? []).filter((p) => p.date === day)} />
            )}

            <section className="card">
              <TrainingRhythm days={trainedDays} goal={profile?.weekly_goal ?? 3} />
            </section>
          </TabPanel>

          <TabPanel id="volume" active={tab} visited={visited}>
            <WeeklyVolume history={history} />
          </TabPanel>

          <TabPanel id="oefeningen" active={tab} visited={visited}>
            {currentExercise && (
              <ExerciseProgress
                ref={chartRef}
                slug={currentExercise}
                options={exercises}
                sessions={sessions.get(currentExercise) ?? []}
                onChange={setExercise}
              />
            )}
            <Records sessions={sessions} selected={currentExercise} onOpen={openExercise} />
          </TabPanel>

          <TabPanel id="gewicht" active={tab} visited={visited}>
            <ProgressBodyweight />
          </TabPanel>
        </div>
      )}
    </AppShell>
  );
}

/**
 * Inhoud van één tab. Pas gemonteerd bij het eerste bezoek en daarna verborgen in plaats van
 * weggegooid, zodat keuzes (maatstaf, periode, week) bij terugkeren nog staan. Bij zichtbaar
 * worden speelt de fade-in opnieuw (de animatie start opnieuw na display: none).
 */
function TabPanel({ id, active, visited, children }: { id: TabId; active: TabId; visited: ReadonlySet<TabId>; children: React.ReactNode }) {
  if (!visited.has(id)) return null;
  return (
    <div
      id={`panel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      hidden={active !== id}
      tabIndex={-1}
      className="animate-fade-in space-y-7 outline-none"
    >
      {children}
    </div>
  );
}

/** Skelet tijdens het laden; na een tijdje een uitleg en een knop om opnieuw te proberen. */
function SlowLoading({ onRetry }: { onRetry: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="space-y-3">
      {slow && (
        <div role="alert" className="card animate-fade-in flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0">
            <span className="block font-semibold">Laden duurt langer dan normaal</span>
            <span className="block text-xs text-muted">
              {typeof navigator !== "undefined" && navigator.onLine === false
                ? "Je bent offline. Zodra je verbinding hebt, laden je trainingen vanzelf."
                : "Controleer je verbinding of probeer het opnieuw."}
            </span>
          </span>
          <button
            type="button"
            className="btn-ghost shrink-0 px-3 py-1.5 text-xs"
            onClick={() => {
              setSlow(false);
              onRetry();
            }}
          >
            Opnieuw
          </button>
        </div>
      )}
      <ProgressSkeleton />
    </div>
  );
}

function statsFor(history: HistorySet[], inPeriod: (date: string) => boolean) {
  const sets = history.filter((s) => inPeriod(s.date) && (s.reps ?? 0) > 0);
  return {
    sessions: new Set(sets.map((s) => s.workoutId)).size,
    sets: sets.length,
    volume: sets.reduce((v, s) => v + (s.weight ?? 0) * (s.reps ?? 0), 0),
  };
}

function Stat({
  value,
  label,
  delta = 0,
  unit = "",
  show = false,
}: {
  value: number | string;
  label: string;
  /** Verschil met de vorige periode. */
  delta?: number;
  unit?: string;
  show?: boolean;
}) {
  return (
    <div className="[&:not(:first-child)]:border-l [&:not(:first-child)]:border-line">
      <p className="text-xl font-extrabold tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
      {show && (
        <p
          className={`mt-0.5 inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${
            delta > 0 ? "text-accent" : "text-muted"
          }`}
        >
          {delta > 0 ? <ArrowUpIcon size={10} /> : delta < 0 ? <ArrowDownIcon size={10} /> : null}
          {delta === 0 ? "gelijk" : `${Math.abs(delta)}${unit}`}
        </p>
      )}
    </div>
  );
}
