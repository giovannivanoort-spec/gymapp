"use client";

import { APP_NAME } from "@/lib/friends";
import { toISODate } from "@/lib/dates";
import { fetchOwnProfile, supabase } from "@/lib/supabase";

/** Supabase geeft standaard maximaal 1000 rijen per verzoek: in stukken ophalen. */
const PAGE = 1000;

type Source = { key: string; table: string; select: string; column: string };

/** Alles wat van jou is. Tabellen die (nog) niet bestaan worden overgeslagen. */
const SOURCES: Source[] = [
  {
    key: "sets",
    table: "set_logs",
    select: "set_number, reps, weight, created_at, workout_exercises(exercise_slug, workouts(date, title))",
    column: "user_id",
  },
  { key: "lichaamsgewicht", table: "bodyweight_logs", select: "*", column: "user_id" },
  { key: "voeding", table: "food_logs", select: "*", column: "user_id" },
  { key: "eigen_producten", table: "custom_foods", select: "*", column: "user_id" },
  { key: "favoriete_producten", table: "food_favorites", select: "*", column: "user_id" },
  { key: "opgeslagen_maaltijden", table: "saved_meals", select: "*", column: "user_id" },
  { key: "reacties", table: "comments", select: "body, created_at, workout_id", column: "user_id" },
  { key: "meldingsvoorkeuren", table: "notification_prefs", select: "plan, reminder, weekly, activity", column: "user_id" },
  { key: "coach_gesprekken", table: "coach_conversations", select: "*", column: "user_id" },
];

async function fetchAll(src: Source, userId: string): Promise<unknown[] | null> {
  const out: unknown[] = [];
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data, error } = await supabase
      .from(src.table)
      .select(src.select)
      .eq(src.column, userId)
      .range(from, from + PAGE - 1);
    if (error) {
      // Tabel bestaat niet in deze database: gewoon overslaan.
      if (["42P01", "42703", "PGRST200", "PGRST204", "PGRST205"].includes(error.code ?? "")) return null;
      throw error;
    }
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Al je eigen gegevens als één JSON-bestand, en start de download. */
export async function downloadMyData(userId: string, email: string | undefined): Promise<void> {
  // Eigen profiel inclusief voedingsdoelen (werkt ook als die kolommen voor anderen zijn afgeschermd).
  const profile = await fetchOwnProfile(userId);
  const { data: friendships } = await supabase.from("friendships").select("requester, addressee, status, created_at, accepted_at");

  const result: Record<string, unknown> = {
    app: APP_NAME,
    gemaakt_op: new Date().toISOString(),
    account: { id: userId, email: email ?? null },
    profiel: profile,
    vriendschappen: friendships ?? [],
  };
  for (const src of SOURCES) {
    const rows = await fetchAll(src, userId);
    if (rows) result[src.key] = rows;
  }

  const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${APP_NAME.toLowerCase()}-gegevens-${toISODate()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Account en al je gegevens verwijderen (supabase/upgrade-social.sql). */
export async function deleteMyAccount(): Promise<void> {
  const { error } = await supabase.rpc("delete_my_account");
  if (!error) return;
  if (["PGRST202", "42883"].includes(error.code ?? "")) {
    throw new Error("Account verwijderen kan nog niet: de database moet eerst worden bijgewerkt (supabase/upgrade-social.sql).");
  }
  throw error;
}
