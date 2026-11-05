"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { fetchCached, getCached, getCachedAt, useCached } from "@/lib/cache";
import { relativeDay, toISODate } from "@/lib/dates";
import { fetchMyGroups, getMyGroups, invalidateMyGroups, myGroupsKey, type MyGroup } from "@/lib/groups";
import { errorMessage, supabase } from "@/lib/supabase";
import { useUserId } from "./AuthProvider";
import { CalendarIcon, ChevronRightIcon, DumbbellIcon, PlayIcon, PlusIcon, UsersIcon } from "./Icons";
import { Sheet } from "./Sheet";
import { ErrorState, ListSkeleton } from "./ui/States";

/** Een geplande training uit een groep waar je in zit (voor "Vandaag" en "Volgende training"). */
export type MemberWorkout = {
  id: string;
  date: string;
  title: string;
  groupName: string;
  exercises: number;
  /** Jij hebt er al sets in gelogd (alleen bekend voor trainingen van vandaag). */
  started?: boolean;
};

export type NewWorkoutView =
  | { kind: "choose"; groups: MyGroup[] }
  /** Trainer met een training op de planning vandaag: eerst die (trainers trainen ook), dan plannen. */
  | { kind: "trainer"; groups: MyGroup[]; today: MemberWorkout[] }
  /** `pending`: getoond uit de bewaarde stand, de verse lijst is nog onderweg. */
  | { kind: "member"; groups: MyGroup[]; upcoming?: MemberWorkout[]; pending?: boolean }
  | { kind: "create"; from?: "member" }
  | { kind: "error"; message: string };

const TIMEOUT_MS = 10_000;
/** Voor de geplande trainingen wachten we korter: lukt het niet, dan tonen we wat we al wisten. */
const UPCOMING_TIMEOUT_MS = 6_000;
const TODAY_TIMEOUT_MS = 4_000;
const TODAY_MAX_AGE = 60_000;

/** Promise met een tijdslimiet. De timer wordt altijd opgeruimd, ook als de promise eerder klaar is. */
function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([Promise.resolve(p), limit]).finally(() => clearTimeout(timer));
}

type UpcomingRow = {
  id: string;
  date: string;
  title: string;
  group_id: string;
  groups: { name: string } | null;
  workout_exercises: { count: number }[];
};

function toMemberWorkout(r: UpcomingRow, groups: MyGroup[]): MemberWorkout {
  return {
    id: r.id,
    date: r.date,
    title: r.title,
    groupName: r.groups?.name ?? groups.find((g) => g.id === r.group_id)?.name ?? "",
    exercises: r.workout_exercises?.[0]?.count ?? 0,
  };
}

/** Wat Home al kende (bewaarde lijst), voor direct tonen of als terugval bij een fout. */
function cachedUpcoming(userId: string, groups: MyGroup[]): MemberWorkout[] {
  const today = toISODate();
  const ids = groups.map((g) => g.id);
  return (getCached<UpcomingRow[]>(`home:workouts:${userId}`) ?? [])
    .filter((r) => ids.includes(r.group_id) && r.date >= today)
    .slice(0, 4)
    .map((r) => toMemberWorkout(r, groups));
}

/** Zet "al begonnen" over vanuit de lijst van vandaag. */
function withStarted(list: MemberWorkout[], today: MemberWorkout[]): MemberWorkout[] {
  if (!today.length) return list;
  const started = new Set(today.filter((w) => w.started).map((w) => w.id));
  return list.map((w) => (started.has(w.id) ? { ...w, started: true } : w));
}

/**
 * Komende trainingen (vandaag en later) in de groepen waar je lid bent. Mislukt het ophalen, dan
 * gebruiken we wat Home al kende; anders een lege lijst (de weergave valt dan terug op uitleg).
 */
async function fetchMemberUpcoming(userId: string, groups: MyGroup[]): Promise<MemberWorkout[]> {
  const today = toISODate();
  const ids = groups.map((g) => g.id);
  try {
    const { data, error } = await withTimeout(
      supabase
        .from("workouts")
        .select("id, date, title, group_id, groups(name), workout_exercises(count)")
        .in("group_id", ids)
        .gte("date", today)
        .order("date")
        .order("created_at")
        .limit(4),
      UPCOMING_TIMEOUT_MS,
    );
    if (error) throw error;
    return ((data ?? []) as unknown as UpcomingRow[]).map((r) => toMemberWorkout(r, groups));
  } catch {
    return cachedUpcoming(userId, groups);
  }
}

// ───────────────────────── Training van vandaag ─────────────────────────

type TodayPlan = { date: string; items: MemberWorkout[] };
/** Cachesleutel per dag; AppShell ververst alles onder "shell:today:" na het verlaten van een training. */
const todayKey = (userId: string, date: string) => `shell:today:${userId}:${date}`;
const NO_WORKOUTS: MemberWorkout[] = [];

/**
 * Trainingen van vandaag in al je groepen (als trainer of als lid), met per training of jij al
 * begonnen bent. Gooit bij een fout, zodat de cache de laatste goede stand houdt.
 */
async function fetchTodayPlan(userId: string, date: string): Promise<TodayPlan> {
  const groups = await getMyGroups(userId);
  if (!groups.length) return { date, items: [] };
  const { data, error } = await supabase
    .from("workouts")
    .select("id, date, title, group_id, groups(name), workout_exercises(count)")
    .in(
      "group_id",
      groups.map((g) => g.id),
    )
    .eq("date", date)
    .order("created_at");
  if (error) throw error;
  const items = ((data ?? []) as unknown as UpcomingRow[]).map((r) => toMemberWorkout(r, groups));
  if (items.length) {
    // Al begonnen? Mislukt dit, dan gewoon zonder (dan lijkt hij nog niet gestart).
    const { data: logs, error: logError } = await supabase
      .from("set_logs")
      .select("workout_exercises!inner(workout_id)")
      .eq("user_id", userId)
      .in(
        "workout_exercises.workout_id",
        items.map((w) => w.id),
      )
      .gt("reps", 0)
      .limit(500);
    if (!logError) {
      const rows = (logs ?? []) as unknown as { workout_exercises: { workout_id: string } | null }[];
      const started = new Set(rows.map((l) => l.workout_exercises?.workout_id));
      for (const w of items) w.started = started.has(w.id);
    }
  }
  return { date, items };
}

/**
 * Trainingen van vandaag (gedeeld via de cache, dus één verzoek voor de knop, de stip en het paneel).
 * Ververst op de achtergrond na een minuut en als je terugkomt in de app.
 */
export function useTodayWorkouts(userId: string | null): MemberWorkout[] {
  const date = toISODate();
  const plan = useCached<TodayPlan>(userId ? todayKey(userId, date) : null, () => fetchTodayPlan(userId ?? "", date), {
    persist: true,
    maxAge: TODAY_MAX_AGE,
  });
  return plan?.items ?? NO_WORKOUTS;
}

/** Vandaag uit de cache als die vers is, anders kort ophalen; lukt dat niet, de bewaarde stand. */
async function todayWorkouts(userId: string): Promise<MemberWorkout[]> {
  const date = toISODate();
  const key = todayKey(userId, date);
  const cached = getCached<TodayPlan>(key);
  const at = getCachedAt(key);
  if (cached && at > 0 && Date.now() - at < TODAY_MAX_AGE) return cached.items;
  try {
    const plan = await withTimeout(
      fetchCached(key, () => fetchTodayPlan(userId, date), true),
      TODAY_TIMEOUT_MS,
    );
    return plan.items;
  } catch {
    return cached?.items ?? [];
  }
}

/** Korte tik-feedback op telefoons die dat ondersteunen (iOS negeert het). */
export function haptic(ms = 10) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms);
  } catch {
    // niet ondersteund
  }
}

type Resolved = { go: string; view?: NewWorkoutView } | { view: NewWorkoutView };

/** Beslissing voor trainers: training van vandaag tonen, direct plannen, of eerst de groep kiezen. */
function trainerChoice(trainer: MyGroup[], today: MemberWorkout[]): Resolved {
  const trainerView: NewWorkoutView = { kind: "trainer", groups: trainer, today };
  if (today.length) return { view: trainerView };
  if (trainer.length === 1) return { go: `/groups/${trainer[0].id}/plan`, view: trainerView };
  return { view: { kind: "choose", groups: trainer } };
}

/**
 * Wat we direct kunnen tonen op basis van bewaarde data (geen wachttijd na de tik). null als we
 * nog niets weten; dan verschijnt het paneel met een skeleton tot resolveNewWorkout klaar is.
 */
function instantNewWorkout(userId: string, today: MemberWorkout[]): Resolved | null {
  const groups = getCached<MyGroup[]>(myGroupsKey(userId));
  if (!groups?.length) return null;
  const trainer = groups.filter((g) => g.role === "trainer");
  if (trainer.length) return trainerChoice(trainer, today);
  const known = cachedUpcoming(userId, groups);
  const upcoming = withStarted(known.length ? known : today, today);
  return { view: { kind: "member", groups, upcoming, pending: true } };
}

/**
 * Bepaalt wat "nieuwe training" doet: direct naar het plannen (één groep waar je trainer bent en
 * niets op de planning vandaag) of een keuze/uitleg tonen. Gedeeld door de plusknop en de
 * snelkoppeling /new. Bij `go` staat in `view` wat je anders zou tonen (voor als het paneel al open is).
 */
export async function resolveNewWorkout(userId: string): Promise<Resolved> {
  try {
    const groups = await withTimeout(getMyGroups(userId), TIMEOUT_MS);
    const trainer = groups.filter((g) => g.role === "trainer");
    if (trainer.length) return trainerChoice(trainer, await todayWorkouts(userId));
    // Lege lijst zonder verbinding betekent "onbekend", niet "geen groepen".
    if (groups.length === 0 && typeof navigator !== "undefined" && !navigator.onLine) {
      return { view: { kind: "error", message: "Je bent offline. Maak verbinding om je groepen te laden." } };
    }
    if (groups.length > 0) {
      const [upcoming, today] = await Promise.all([fetchMemberUpcoming(userId, groups), todayWorkouts(userId)]);
      return { view: { kind: "member", groups, upcoming: withStarted(upcoming, today) } };
    }
    return { view: { kind: "create" } };
  } catch (err) {
    const timeout = err instanceof Error && err.message === "timeout";
    return {
      view: {
        kind: "error",
        message: timeout ? "Het laden duurt te lang. Controleer je verbinding." : "Je groepen konden niet geladen worden.",
      },
    };
  }
}

/**
 * Groene knop midden in de onderbalk. Voor trainers: nieuwe training plannen (bij één groep direct,
 * bij meer eerst de groep kiezen), met bovenaan de training van vandaag als die er is. Voor leden
 * (`member`): de training van vandaag of de eerstvolgende, met één knop om te beginnen.
 * Leden plannen nooit zelf. Een stip op de knop betekent: er staat vandaag een training voor je
 * klaar die je nog niet bent begonnen.
 *
 * Het paneel opent direct met wat al bekend is (bewaarde groepen en trainingen) en wordt bijgewerkt
 * zodra de verse stand binnen is. Sluiten annuleert het wachten.
 */
export function NewWorkoutButton({ member = false }: { member?: boolean } = {}) {
  const userId = useUserId();
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useState<NewWorkoutView | null>(null);
  const [open, setOpen] = useState(false);
  /** Volgnummer van de lopende aanvraag; een antwoord na sluiten of na een nieuwe tik telt niet meer. */
  const request = useRef(0);

  const groups = useCached<MyGroup[]>(userId ? myGroupsKey(userId) : null, () => fetchMyGroups(userId), {
    persist: true,
    maxAge: 60_000,
  });
  const today = useTodayWorkouts(userId || null);
  // Niet tonen op de pagina van die training zelf: daar ben je al.
  const dot = today.some((w) => !w.started && pathname !== `/workouts/${w.id}`);
  const trainerGroups = groups?.filter((g) => g.role === "trainer").length ?? 0;
  const opensSheet = member || !groups || trainerGroups !== 1 || today.length > 0;

  function load(token: number, shown: boolean) {
    void resolveNewWorkout(userId).then((result) => {
      if (request.current !== token) return;
      if ("go" in result && !shown) {
        // Alleen een skeleton in beeld: dan meteen door naar het plannen.
        request.current++;
        setOpen(false);
        router.push(result.go);
        return;
      }
      if (result.view) setView(result.view);
    });
  }

  function start() {
    haptic();
    const token = ++request.current;
    const instant = userId ? instantNewWorkout(userId, today) : null;
    if (instant && "go" in instant) {
      router.push(instant.go);
      return;
    }
    setView(instant?.view ?? null);
    setOpen(true);
    load(token, !!instant);
  }

  function retry() {
    setView(null);
    load(++request.current, false);
  }

  function close() {
    request.current++;
    setOpen(false);
  }

  const label = dot ? "Training van vandaag, nog niet gestart" : member ? "Training van vandaag" : "Nieuwe training";

  return (
    <>
      <div className="flex items-start justify-center">
        <button
          type="button"
          onClick={start}
          aria-label={label}
          aria-haspopup={opensSheet ? "dialog" : undefined}
          aria-expanded={opensSheet ? open : undefined}
          className="relative -mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-ink transition duration-200 hover:brightness-110 active:scale-90"
          style={{ boxShadow: "0 0 0 4px var(--color-bg), 0 10px 28px -6px rgb(200 245 58 / 0.55)" }}
        >
          {member ? <DumbbellIcon size={24} strokeWidth={2.4} /> : <PlusIcon size={26} strokeWidth={2.6} />}
          {dot && (
            <span aria-hidden className="pointer-events-none absolute right-0.5 top-0.5 h-3.5 w-3.5">
              <span className="absolute inset-0 rounded-full bg-ink opacity-0 motion-safe:animate-dot-pulse" />
              <span className="animate-badge-in absolute inset-0 rounded-full bg-ink ring-[3px] ring-bg" />
            </span>
          )}
        </button>
      </div>

      <Sheet open={open} onClose={close} title={sheetTitle(view, member)}>
        <NewWorkoutContent
          view={view}
          onView={setView}
          onRetry={retry}
          onGo={(href) => {
            close();
            router.push(href);
          }}
        />
      </Sheet>
    </>
  );
}

/** Titel van het paneel: voor leden (en trainers met een training vandaag) gaat het om trainen. */
export function sheetTitle(view: NewWorkoutView | null, member = false): string {
  if (view?.kind === "trainer") {
    if (!view.today.length) return "Nieuwe training";
    return view.today.length === 1 ? "Training van vandaag" : "Trainingen van vandaag";
  }
  if (view?.kind === "member" || (!view && member)) {
    const first = view?.kind === "member" ? view.upcoming?.[0] : undefined;
    if (first && first.date === toISODate()) return "Training van vandaag";
    return first ? "Volgende training" : "Trainen";
  }
  if (view?.kind === "create") return "Nieuwe groep";
  return "Nieuwe training";
}

/** Inhoud van "nieuwe training": vandaag (trainer/lid), groep kiezen, groep maken of een fout. */
export function NewWorkoutContent({
  view,
  onView,
  onRetry,
  onGo,
}: {
  view: NewWorkoutView | null;
  onView: (v: NewWorkoutView) => void;
  onRetry: () => void;
  onGo: (href: string) => void;
}) {
  if (!view) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-4 w-32" />
        <ListSkeleton rows={2} />
      </div>
    );
  }

  if (view.kind === "error") return <ErrorState compact message={view.message} onRetry={onRetry} />;

  if (view.kind === "choose") return <GroupChoice groups={view.groups} onGo={onGo} />;

  if (view.kind === "trainer") return <TrainerToday view={view} onGo={onGo} />;

  if (view.kind === "member") return <MemberToday view={view} onView={onView} onGo={onGo} />;

  return <NewGroupForm fromMember={view.from === "member"} onCreated={(id) => onGo(`/groups/${id}/plan`)} />;
}

/** Groep kiezen om voor te plannen (trainer van meer groepen). */
function GroupChoice({ groups, onGo, label = "Voor welke groep?" }: { groups: MyGroup[]; onGo: (href: string) => void; label?: string }) {
  return (
    <div className="space-y-2">
      <p className="pb-1 text-sm text-muted">{label}</p>
      {groups.map((g, i) => (
        <button
          type="button"
          key={g.id}
          onClick={() => onGo(`/groups/${g.id}/plan`)}
          className="card animate-fade-up flex w-full items-center gap-3 text-left hover:border-muted active:scale-[0.99]"
          style={{ "--i": i } as React.CSSProperties}
        >
          <GroupMark name={g.name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{g.name}</span>
            <span className="text-xs text-muted">
              {g.memberCount} {g.memberCount === 1 ? "lid" : "leden"}
            </span>
          </span>
          <ChevronRightIcon className="text-muted" />
        </button>
      ))}
    </div>
  );
}

/** Tekst op de knop van een geplande training: beginnen, verder, of (later) alleen bekijken. */
function actionLabel(w: MemberWorkout, today: string): string {
  if (w.date !== today) return "Bekijk training";
  return w.started ? "Verder met training" : "Start training";
}

/** Hoofdkaart van een geplande training met één grote knop. */
function WorkoutHero({ w, onGo }: { w: MemberWorkout; onGo: (href: string) => void }) {
  const today = toISODate();
  const isToday = w.date === today;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-accent/40 bg-accent/[0.07] p-4">
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-accent/15 blur-2xl" />
      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
              isToday ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink"
            }`}
          >
            <CalendarIcon size={13} />
            {relativeDay(w.date)}
          </span>
          {w.started && isToday && (
            <span className="inline-flex items-center rounded-full border border-accent/40 px-2.5 py-1 text-xs font-semibold text-accent">
              Bezig
            </span>
          )}
        </div>
        <p className="mt-3 text-xl font-bold leading-tight">{w.title || "Training"}</p>
        <p className="mt-1 text-sm text-muted">
          {[w.groupName, w.exercises ? `${w.exercises} ${w.exercises === 1 ? "oefening" : "oefeningen"}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <button type="button" className="btn-primary mt-4 w-full py-3" onClick={() => onGo(`/workouts/${w.id}`)}>
          <PlayIcon size={16} />
          {actionLabel(w, today)}
        </button>
      </div>
    </div>
  );
}

/** Compacte rij voor een volgende geplande training. */
function WorkoutRow({ w, i, onGo }: { w: MemberWorkout; i: number; onGo: (href: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onGo(`/workouts/${w.id}`)}
      className="card animate-fade-up flex w-full items-center gap-3 py-3 text-left hover:border-muted active:scale-[0.99]"
      style={{ "--i": i } as React.CSSProperties}
    >
      <span className="w-16 shrink-0 text-xs font-semibold text-accent">{relativeDay(w.date)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{w.title || "Training"}</span>
        <span className="block truncate text-xs text-muted">
          {w.started ? `${w.groupName ? `${w.groupName} · ` : ""}Bezig` : w.groupName}
        </span>
      </span>
      <ChevronRightIcon className="text-muted" />
    </button>
  );
}

/**
 * Trainers met een training op de planning vandaag: die eerst (trainers trainen zelf ook mee),
 * daaronder plannen voor je groep(en).
 */
function TrainerToday({ view, onGo }: { view: Extract<NewWorkoutView, { kind: "trainer" }>; onGo: (href: string) => void }) {
  const [first, ...rest] = view.today;
  return (
    <div className="animate-fade-in space-y-5">
      {first && <WorkoutHero w={first} onGo={onGo} />}
      {rest.length > 0 && (
        <div>
          <p className="label">Ook vandaag</p>
          <div className="space-y-2">
            {rest.map((w, i) => (
              <WorkoutRow key={w.id} w={w} i={i} onGo={onGo} />
            ))}
          </div>
        </div>
      )}
      {view.groups.length === 1 ? (
        <button type="button" className="btn-ghost w-full py-3" onClick={() => onGo(`/groups/${view.groups[0].id}/plan`)}>
          <PlusIcon size={16} />
          Nieuwe training plannen
        </button>
      ) : (
        <GroupChoice groups={view.groups} onGo={onGo} label="Nieuwe training plannen voor" />
      )}
    </div>
  );
}

/**
 * Leden: de eerstvolgende geplande training als hoofdkaart met "Start", daarna wat er nog komt.
 * Zonder geplande training: uitleg dat de trainer plant, en je groepen.
 */
function MemberToday({
  view,
  onView,
  onGo,
}: {
  view: Extract<NewWorkoutView, { kind: "member" }>;
  onView: (v: NewWorkoutView) => void;
  onGo: (href: string) => void;
}) {
  const upcoming = view.upcoming ?? [];
  const [first, ...rest] = upcoming;
  const names = view.groups.map((g) => g.name);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} en ${names[names.length - 1]}`;

  // Nog niets bewaard en de verse lijst is onderweg: geen "niets gepland" tonen dat zo verspringt.
  if (!first && view.pending) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Laden">
        <div className="skeleton h-[164px] rounded-2xl" />
        <div className="skeleton h-4 w-2/3" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-4">
      {first ? (
        <WorkoutHero w={first} onGo={onGo} />
      ) : (
        <div className="flex gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <UsersIcon size={20} />
          </span>
          <div>
            <p className="font-semibold">Nog geen training gepland</p>
            <p className="mt-0.5 text-sm text-muted">
              De trainer van {list} plant de trainingen. Zodra er een klaarstaat, start je hem hier met één tik.
            </p>
          </div>
        </div>
      )}

      {rest.length > 0 && (
        <div>
          <p className="label">Daarna</p>
          <div className="space-y-2">
            {rest.map((w, i) => (
              <WorkoutRow key={w.id} w={w} i={i} onGo={onGo} />
            ))}
          </div>
        </div>
      )}

      {first ? (
        <p className="text-xs leading-relaxed text-muted">Je trainer plant de trainingen. Nieuwe trainingen verschijnen hier en op Home.</p>
      ) : (
        <div className="space-y-2">
          {view.groups.map((g) => (
            <Link
              key={g.id}
              href={`/groups/${g.id}`}
              onClick={(e) => {
                e.preventDefault();
                onGo(`/groups/${g.id}`);
              }}
              className="card flex items-center gap-3 hover:border-muted"
            >
              <GroupMark name={g.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{g.name}</span>
                <span className="text-xs text-muted">Bekijk groep</span>
              </span>
              <ChevronRightIcon className="text-muted" />
            </Link>
          ))}
        </div>
      )}

      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-medium text-muted transition-colors hover:text-ink"
        onClick={() => onView({ kind: "create", from: "member" })}
      >
        <PlusIcon size={15} />
        Zelf een groep starten
      </button>
    </div>
  );
}

function GroupMark({ name }: { name: string }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-lg font-bold text-accent">
      {Array.from(name.trim())[0]?.toLocaleUpperCase("nl") ?? "?"}
    </span>
  );
}

/** Nog geen groep waar je trainer bent: eerst een groep maken. */
function NewGroupForm({ onCreated, fromMember }: { onCreated: (id: string) => void; fromMember: boolean }) {
  const userId = useUserId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="animate-fade-in space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        setError(null);
        try {
          const { data, error } = await supabase.from("groups").insert({ name: name.trim() }).select("id").single();
          if (error) throw error;
          invalidateMyGroups(userId);
          onCreated(data.id);
        } catch (err) {
          setError(
            typeof navigator !== "undefined" && !navigator.onLine
              ? "Je bent offline. Maak verbinding en probeer het opnieuw."
              : errorMessage(err),
          );
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-muted">
        {fromMember
          ? "In een eigen groep ben jij de trainer: jij plant de trainingen en nodigt vrienden uit."
          : "Trainingen plan je voor een groep waar jij trainer bent. Je bent dat nog nergens, dus maak eerst een groep aan. Daarna kun je vrienden uitnodigen."}
      </p>
      <div>
        <label className="label" htmlFor="ngname">
          Naam van de groep
        </label>
        <input
          id="ngname"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Bijv. Gym bros"
          maxLength={40}
          autoComplete="off"
          required
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button className="btn-primary w-full" disabled={busy || !name.trim()}>
        {busy && <span className="spinner" aria-hidden />}
        {busy ? "Aanmaken…" : "Groep aanmaken en training plannen"}
      </button>
    </form>
  );
}
