import { timingSafeEqual } from "node:crypto";
import { adminClient, claimOnce, releaseClaim, sendMany, usersWanting, type PushMessage, type PushPayload } from "@/lib/push-server";
import type { NotificationKind } from "@/lib/types";

/**
 * Geplande meldingen (Vercel Cron, zie vercel.json: `0 7 * * *` voor de ochtend en
 * `/api/cron/reminders?slot=evening` op `0 18 * * *` voor de avond). Eén route, momenten via `?slot=`:
 * - `morning` (standaard): leden van een groep met vandaag een training krijgen één herinnering
 *   met alle trainingen van vandaag (wie de training plande, krijgt hem niet).
 * - `evening`: per persoon hooguit één melding die samenvoegt wat er speelt: training van vandaag
 *   nog niet gelogd, (op zondag) het weekoverzicht en morgen een training gepland.
 * - `weekly`: alleen het weekoverzicht (handig om los te testen).
 *
 * Iedereen kan per soort meldingen uitzetten (tabel notification_prefs, zie
 * supabase/upgrade-platform.sql). Per persoon, slot en dag gaat er maar één melding uit (tabel
 * push_log), ook als de cron dubbel of opnieuw draait. Zonder die tabellen werkt alles zoals
 * voorheen: iedereen krijgt alles.
 * Met `?dry=1` wordt er niets verstuurd of vastgelegd en krijg je alleen de aantallen terug.
 */

const TZ = "Europe/Amsterdam";
const PAGE = 1000;

type Admin = ReturnType<typeof adminClient>;

type WorkoutRow = {
  id: string;
  title: string;
  created_by: string;
  groups: { name: string; group_members: { user_id: string }[] } | null;
  workout_exercises: { id: string }[];
};

/** Faalt dicht: zonder CRON_SECRET op de server mag niemand deze route aanroepen. */
function checkAuth(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET ontbreekt; verzoek geweigerd.");
    return Response.json({ error: "Niet ingesteld." }, { status: 500 });
  }
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "Niet toegestaan." }, { status: 401 });
  }
  return null;
}

/** Datum (YYYY-MM-DD) in Amsterdam. */
function amsterdamDate(d = new Date()): string {
  return d.toLocaleDateString("sv-SE", { timeZone: TZ });
}

/** Verschuift een YYYY-MM-DD-datum met een aantal dagen. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = maandag … 6 = zondag, voor een YYYY-MM-DD-datum. */
function weekdayIndex(iso: string): number {
  return (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** Begin van een dag in Amsterdam als ISO-tijdstip (rekening houdend met zomer-/wintertijd). */
function startOfAmsterdamDay(iso: string): string {
  const noon = new Date(`${iso}T12:00:00Z`);
  const label = noon.toLocaleString("en-US", { timeZone: TZ, timeZoneName: "shortOffset" });
  const m = label.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  const hours = m ? Number(m[1]) : 1;
  const minutes = m?.[2] ? Number(m[2]) * Math.sign(hours) : 0;
  return new Date(Date.parse(`${iso}T00:00:00Z`) - (hours * 60 + minutes) * 60_000).toISOString();
}

/** Haalt alle rijen op in pagina's van 1000 (de limiet van Supabase). Gooit bij een fout. */
async function fetchAll<T>(
  label: string,
  query: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) {
      console.error(`[cron] ${label} ophalen mislukt:`, error.code, error.message);
      throw new Error(`${label} ophalen mislukt`);
    }
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function workoutsOn(admin: Admin, date: string): Promise<WorkoutRow[]> {
  return fetchAll<WorkoutRow>("trainingen", (from, to) =>
    admin
      .from("workouts")
      .select("id, title, created_by, groups(name, group_members(user_id)), workout_exercises(id)")
      .eq("date", date)
      .order("id")
      .range(from, to),
  );
}

/** Per lid (niet de planner) de trainingen uit deze lijst die echt oefeningen hebben. */
function workoutsPerMember(workouts: WorkoutRow[]): Map<string, WorkoutRow[]> {
  const perUser = new Map<string, WorkoutRow[]>();
  for (const w of workouts) {
    if (!w.groups || !w.workout_exercises?.length) continue;
    for (const { user_id } of w.groups.group_members ?? []) {
      if (user_id === w.created_by) continue;
      const list = perUser.get(user_id);
      if (list) list.push(w);
      else perUser.set(user_id, [w]);
    }
  }
  return perUser;
}

/** Eén melding per persoon voor een lijst geplande trainingen ("Vandaag: …" of "Morgen: …"). */
function planMessages(workouts: WorkoutRow[], day: "Vandaag" | "Morgen"): PushMessage[] {
  const prefix = day === "Vandaag" ? "workout" : "tomorrow";
  return [...workoutsPerMember(workouts)].map(([userId, list]) => {
    if (list.length === 1) {
      const w = list[0];
      return {
        userId,
        payload: {
          title: `${day}: ${w.title}`,
          body:
            day === "Vandaag"
              ? `Training gepland in ${w.groups!.name}. Tik om te openen.`
              : `Gepland in ${w.groups!.name}. Bekijk alvast de oefeningen.`,
          url: `/workouts/${w.id}`,
          tag: `${prefix}-${w.id}`,
        },
      };
    }
    return {
      userId,
      payload: {
        title: `${day} ${list.length} trainingen gepland`,
        body: list.map((w) => `${w.title} (${w.groups!.name})`).join(", "),
        url: "/",
        tag: `${prefix}-${list.map((w) => w.id.slice(0, 4)).join("")}`,
      },
    };
  });
}

/** Avond: wie vandaag een training had maar nog niets logde. */
async function notLoggedMessages(admin: Admin, workouts: WorkoutRow[]): Promise<PushMessage[]> {
  const weToWorkout = new Map<string, string>();
  for (const w of workouts) for (const we of w.workout_exercises ?? []) weToWorkout.set(we.id, w.id);
  if (!weToWorkout.size) return [];

  const logged = new Set<string>(); // `${userId}:${workoutId}`
  const weIds = [...weToWorkout.keys()];
  // In blokken, zodat de URL niet te lang wordt.
  for (let i = 0; i < weIds.length; i += 150) {
    const chunk = weIds.slice(i, i + 150);
    const rows = await fetchAll<{ user_id: string; workout_exercise_id: string }>("sets", (from, to) =>
      admin
        .from("set_logs")
        .select("user_id, workout_exercise_id")
        .in("workout_exercise_id", chunk)
        .order("id")
        .range(from, to),
    );
    for (const r of rows) logged.add(`${r.user_id}:${weToWorkout.get(r.workout_exercise_id)}`);
  }

  const messages = new Map<string, PushMessage>();
  for (const w of workouts) {
    if (!w.groups || !w.workout_exercises?.length) continue;
    for (const { user_id } of w.groups.group_members ?? []) {
      if (user_id === w.created_by || logged.has(`${user_id}:${w.id}`) || messages.has(user_id)) continue;
      messages.set(user_id, {
        userId: user_id,
        payload: {
          title: "Je training van vandaag is nog niet gelogd",
          body: `${w.title} · ${w.groups.name}. Vul je sets in, dan kloppen je progressie en records.`,
          url: `/workouts/${w.id}`,
          tag: `log-${w.id}`,
        },
      });
    }
  }
  return [...messages.values()];
}

/** Zondagavond: trainingen deze week tegenover het weekdoel, plus nieuwe records. */
async function weeklyMessages(admin: Admin, today: string): Promise<PushMessage[]> {
  const subs = await fetchAll<{ user_id: string }>("abonnementen", (from, to) =>
    admin.from("push_subscriptions").select("user_id").order("endpoint").range(from, to),
  );
  const users = [...new Set(subs.map((s) => s.user_id))];
  if (!users.length) return [];

  const monday = addDays(today, -weekdayIndex(today));

  const sets = await fetchAll<{ user_id: string; workout_exercises: { workout_id: string } }>("sets van deze week", (from, to) =>
    admin
      .from("set_logs")
      .select("user_id, workout_exercises!inner(workout_id, workouts!inner(date))")
      .in("user_id", users)
      .not("reps", "is", null)
      .gte("workout_exercises.workouts.date", monday)
      .lte("workout_exercises.workouts.date", today)
      .order("id")
      .range(from, to),
  );
  const sessions = new Map<string, Set<string>>();
  for (const s of sets) {
    const set = sessions.get(s.user_id) ?? new Set<string>();
    set.add(s.workout_exercises.workout_id);
    sessions.set(s.user_id, set);
  }

  // Weekdoel (kolom kan ontbreken als features.sql nog niet gedraaid is: dan 3).
  const goals = new Map<string, number>();
  const { data: profiles, error: profileError } = await admin.from("profiles").select("id, weekly_goal").in("id", users);
  if (profileError) console.error("[cron] weekdoelen ophalen mislukt:", profileError.code, profileError.message);
  for (const p of (profiles ?? []) as { id: string; weekly_goal: number | null }[]) goals.set(p.id, p.weekly_goal ?? 3);

  // Nieuwe records deze week (tabel kan ontbreken: dan zonder records).
  const records = new Map<string, number>();
  const { data: prs, error: prError } = await admin
    .from("activities")
    .select("user_id")
    .eq("type", "pr")
    .in("user_id", users)
    .gte("created_at", startOfAmsterdamDay(monday));
  if (prError) console.error("[cron] records ophalen mislukt:", prError.code, prError.message);
  for (const a of (prs ?? []) as { user_id: string }[]) records.set(a.user_id, (records.get(a.user_id) ?? 0) + 1);

  return users.map((userId) => {
    const done = sessions.get(userId)?.size ?? 0;
    const goal = goals.get(userId) ?? 3;
    const prCount = records.get(userId) ?? 0;
    const prText = prCount ? ` ${prCount} ${prCount === 1 ? "nieuw record" : "nieuwe records"}.` : "";
    let body: string;
    if (done >= goal) body = `Weekdoel gehaald.${prText}`;
    else if (done === 0) body = `Deze week geen training gelogd. Nieuwe week, nieuwe kans.`;
    else body = `Nog ${goal - done} te gaan voor je weekdoel. Volgende week weer.${prText}`;
    return {
      userId,
      payload: {
        title: `Je week: ${done} van ${goal} ${goal === 1 ? "training" : "trainingen"}`,
        body,
        url: "/progress",
        tag: `week-${monday}`,
      },
    };
  });
}

/** Eén soort melding binnen een slot, met de voorkeur die erbij hoort. */
type Part = { kind: NotificationKind; label: string; messages: PushMessage[] };

/** Houdt per soort alleen wie die meldingen aan heeft staan. */
async function applyPrefs(admin: Admin, parts: Part[]): Promise<Part[]> {
  return Promise.all(
    parts.map(async (p) => {
      const allowed = new Set(await usersWanting(p.messages.map((m) => m.userId), p.kind, admin));
      return { ...p, messages: p.messages.filter((m) => allowed.has(m.userId)) };
    }),
  );
}

/**
 * Voegt de meldingen per persoon samen tot één melding: de belangrijkste (eerste) bepaalt titel
 * en link, de rest komt kort in de tekst. Zo krijgt niemand op één avond meerdere pushes.
 */
function mergePerUser(parts: Part[], tag: string): PushMessage[] {
  const perUser = new Map<string, PushPayload[]>();
  for (const p of parts) {
    for (const m of p.messages) {
      const list = perUser.get(m.userId);
      if (list) list.push(m.payload);
      else perUser.set(m.userId, [m.payload]);
    }
  }
  return [...perUser].map(([userId, payloads]) => {
    if (payloads.length === 1) return { userId, payload: payloads[0] };
    const [first, ...rest] = payloads;
    const extra = rest.map((r) => `${r.title.replace(/[.\s]+$/, "")}.`).join(" ");
    return {
      userId,
      payload: { title: first.title, body: `${first.body} ${extra}`.trim(), url: first.url, tag },
    };
  });
}

export async function GET(req: Request) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const params = new URL(req.url).searchParams;
  const slot = params.get("slot") ?? "morning";
  const dry = params.get("dry") === "1";
  if (!["morning", "evening", "weekly"].includes(slot)) {
    return Response.json({ error: "Onbekend slot." }, { status: 400 });
  }

  try {
    const admin = adminClient();
    const today = amsterdamDate();
    const parts: Part[] = [];

    if (slot === "morning") {
      parts.push({ kind: "plan", label: "vandaag-gepland", messages: planMessages(await workoutsOn(admin, today), "Vandaag") });
    } else if (slot === "evening") {
      const [todays, tomorrows] = await Promise.all([workoutsOn(admin, today), workoutsOn(admin, addDays(today, 1))]);
      // Volgorde = belangrijkheid bij het samenvoegen.
      parts.push({ kind: "reminder", label: "nog-niet-gelogd", messages: await notLoggedMessages(admin, todays) });
      if (weekdayIndex(today) === 6) {
        parts.push({ kind: "weekly", label: "weekoverzicht", messages: await weeklyMessages(admin, today) });
      }
      parts.push({ kind: "plan", label: "morgen-gepland", messages: planMessages(tomorrows, "Morgen") });
    } else {
      parts.push({ kind: "weekly", label: "weekoverzicht", messages: await weeklyMessages(admin, today) });
    }

    const candidates = Object.fromEntries(parts.map((p) => [p.label, p.messages.length]));
    const wanted = await applyPrefs(admin, parts);
    const afterPrefs = Object.fromEntries(wanted.map((p) => [p.label, p.messages.length]));
    const messages = mergePerUser(wanted, `${slot}-${today}`);

    if (dry) {
      return Response.json({ slot, date: today, dry, candidates, afterPrefs, recipients: messages.length });
    }

    // Idempotent: wie vandaag al een melding voor dit slot kreeg, slaan we over.
    const fresh = new Set(await claimOnce(messages.map((m) => m.userId), slot, today, admin));
    const toSend = messages.filter((m) => fresh.has(m.userId));
    let result = { sent: 0, failed: 0, removed: 0, retryable: 0 };
    try {
      const { sent, failed, removed, undeliveredUsers } = await sendMany(toSend);
      // Wie op geen enkel apparaat iets ontving door een fout of time-out: claim vrijgeven, zodat
      // een herhaalde run het opnieuw probeert (alleen verlopen abonnementen tellen niet).
      if (undeliveredUsers.length) await releaseClaim(undeliveredUsers, slot, today, admin);
      result = { sent, failed, removed, retryable: undeliveredUsers.length };
    } catch (err) {
      console.error(`[cron] ${slot} versturen mislukt:`, err instanceof Error ? err.message : err);
      // Niets verstuurd: logboek terugzetten, zodat een nieuwe run het opnieuw kan proberen.
      await releaseClaim([...fresh], slot, today, admin);
      result = { sent: 0, failed: toSend.length, removed: 0, retryable: toSend.length };
    }
    return Response.json({
      slot,
      date: today,
      dry,
      candidates,
      afterPrefs,
      recipients: messages.length,
      alreadySent: messages.length - toSend.length,
      ...result,
    });
  } catch (err) {
    console.error("[cron] mislukt:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Herinneringen versturen mislukt." }, { status: 500 });
  }
}
