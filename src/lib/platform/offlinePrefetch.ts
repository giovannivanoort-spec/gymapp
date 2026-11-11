"use client";

import { commentsKey, fetchComments, fetchLogs, fetchWorkout, logsKey, workoutKey } from "@/components/workout/data";
import type { HistRow } from "@/components/workout/logic";
import { fetchCached, getCached, setCached } from "@/lib/cache";
import { toISODate } from "@/lib/dates";
import { supabase } from "@/lib/supabase";

/**
 * "Offline klaar": haalt bij een goede verbinding de trainingen van vandaag en morgen alvast op,
 * met alles wat je nodig hebt om te loggen zonder bereik (kelder, sportschool zonder wifi):
 * de training met oefeningen en groepsleden, de sets die al gelogd zijn, de opmerkingen, per
 * groepslid de vorige keer per oefening, en de pagina zelf met haar app-bestanden.
 *
 * Alles komt in dezelfde cache-sleutels als die van de trainingspagina, dus die opent offline
 * meteen met deze data. Draait hooguit eens per 30 minuten (of als de dag omslaat), niet bij
 * databesparing of een 2G-verbinding.
 */

export type OfflineWorkout = { id: string; title: string; date: string; group: string | null };
export type OfflineReady = {
  /** Wanneer alles is klaargezet (ms). */
  at: number;
  /** Datum (YYYY-MM-DD) waarvoor "vandaag" gold. */
  day: string;
  workouts: OfflineWorkout[];
  /** false als een deel niet gelukt is (de rest staat wel klaar). */
  complete: boolean;
};

export const offlineReadyKey = (userId: string) => `offline-ready:${userId}`;

const MIN_INTERVAL_MS = 30 * 60 * 1000;
const MAX_WORKOUTS = 6;
const MAX_ASSETS = 60;

type Connection = { saveData?: boolean; effectiveType?: string; type?: string };

/** Is de verbinding goed genoeg om op de achtergrond data klaar te zetten? */
export function goodConnection(): boolean {
  if (typeof navigator === "undefined" || navigator.onLine === false) return false;
  const c = (navigator as Navigator & { connection?: Connection }).connection;
  if (!c) return true;
  if (c.saveData) return false;
  return !/(^|-)2g$/.test(c.effectiveType ?? "");
}

// ─────────── Vorige keer per oefening (zelfde sleutel en vorm als components/workout/data) ───────────

/** Moet gelijk blijven aan useHistories in components/workout/data.ts. */
const histKey = (workoutId: string, uid: string, slugKey: string) => `wo:hist:${workoutId}:${uid}:${slugKey}`;

type HistQueryRow = {
  set_number: number;
  weight: number | null;
  reps: number | null;
  created_at: string;
  workout_exercise_id: string;
  workout_exercises: { exercise_slug: string; workouts: { date: string } };
};

async function fetchHistRows(uid: string, slugs: string[], workoutId: string): Promise<HistRow[]> {
  const out: HistRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("set_logs")
      .select("set_number, weight, reps, created_at, workout_exercise_id, workout_exercises!inner(exercise_slug, workout_id, workouts!inner(date))")
      .eq("user_id", uid)
      .in("workout_exercises.exercise_slug", slugs)
      .neq("workout_exercises.workout_id", workoutId)
      .order("created_at")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as HistQueryRow[];
    for (const r of rows) {
      out.push({
        s: r.workout_exercises.exercise_slug,
        x: r.workout_exercise_id,
        d: r.workout_exercises.workouts.date,
        n: r.set_number,
        w: r.weight == null ? null : Number(r.weight),
        r: r.reps,
        t: r.created_at,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

// ─────────── Pagina en app-bestanden (via de service worker) ───────────

/**
 * Laadt de pagina en haar app-bestanden één keer, zodat de service worker ze bewaart. Alleen met
 * een actieve service worker (anders heeft het geen zin).
 */
async function warmPage(path: string) {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) return;
  const html = await res.text();
  const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+?\.(?:js|css)/g) ?? [])].slice(0, MAX_ASSETS);
  // In kleine porties; bestanden die al bewaard zijn, komen direct uit de cache.
  for (let i = 0; i < assets.length; i += 6) {
    await Promise.all(assets.slice(i, i + 6).map((a) => fetch(a, { credentials: "same-origin" }).catch(() => undefined)));
  }
}

// ─────────── Klaarzetten ───────────

let running: Promise<OfflineReady | null> | null = null;

function tomorrowISO(): string {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  return toISODate(t);
}

async function run(userId: string): Promise<OfflineReady> {
  const today = toISODate();
  // Alleen trainingen van groepen waar je nu lid van bent: de ledenlijst is alleen voor leden
  // leesbaar (een verlaten groep die je zelf aanmaakte, blijft zonder dit filter zichtbaar).
  const { data, error } = await supabase
    .from("workouts")
    .select("id, title, date, groups!inner(name, group_members!inner(user_id))")
    .in("date", [today, tomorrowISO()])
    .order("date")
    .order("created_at")
    .limit(MAX_WORKOUTS);
  if (error) throw error;
  const list = (data ?? []) as unknown as { id: string; title: string; date: string; groups: { name: string } | null }[];

  let complete = true;
  const warmed = new Set<string>();
  for (const w of list) {
    try {
      const bundle = await fetchCached(workoutKey(w.id), () => fetchWorkout(w.id), true);
      await Promise.all([
        fetchCached(logsKey(w.id), () => fetchLogs(w.id), true),
        fetchCached(commentsKey(w.id), () => fetchComments(w.id), true),
      ]);
      const slugs = [...new Set(bundle?.workout.workout_exercises.map((e) => e.exercise_slug) ?? [])].sort();
      if (bundle && slugs.length && goodConnection()) {
        const slugKey = slugs.join(",");
        await Promise.all(
          bundle.members.map((m) =>
            fetchCached(histKey(w.id, m.user_id, slugKey), () => fetchHistRows(m.user_id, slugs, w.id), true),
          ),
        );
      }
      const path = `/workouts/${w.id}`;
      if (!warmed.has(path)) {
        warmed.add(path);
        await warmPage(path).catch(() => {
          complete = false;
        });
      }
    } catch {
      complete = false;
    }
  }

  const result: OfflineReady = {
    at: Date.now(),
    day: today,
    workouts: list.map((w) => ({ id: w.id, title: w.title, date: w.date, group: w.groups?.name ?? null })),
    complete,
  };
  setCached(offlineReadyKey(userId), result, true);
  return result;
}

/**
 * Zet de trainingen van vandaag en morgen klaar voor offline gebruik. Zonder `force` alleen bij
 * een goede verbinding en hooguit eens per 30 minuten; geeft dan de vorige stand terug. Gooit bij
 * een fout (bijv. geen verbinding) als `force` aan staat, anders null.
 */
export function prepareOffline(userId: string, { force = false }: { force?: boolean } = {}): Promise<OfflineReady | null> {
  if (running) return force ? running : running.catch(() => null);
  const last = getCached<OfflineReady>(offlineReadyKey(userId)) ?? null;
  if (!force) {
    const recent = last && last.day === toISODate() && Date.now() - last.at < MIN_INTERVAL_MS;
    if (recent || !goodConnection()) return Promise.resolve(last);
  }
  const p = run(userId);
  running = p.finally(() => {
    running = null;
  });
  return force ? running : running.catch(() => null);
}
