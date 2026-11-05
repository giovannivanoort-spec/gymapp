import type { ActivityType } from "./activities";

export type Role = "trainer" | "member";

export type Profile = {
  id: string;
  display_name: string;
  bodyweight_kg: number | null;
  sex: "male" | "female" | null;
  height_cm: number | null;
  /** YYYY-MM-DD */
  birth_date: string | null;
  /** Aantal trainingen per week dat iemand wil halen (1–7). */
  weekly_goal?: number | null;
};

/**
 * Kolommen van een profiel die groepsleden en vrienden mogen zien. Gebruik dit (of
 * fetchPublicProfile uit lib/supabase) in plaats van select("*") of profiles(*) voor andermans
 * profiel: profiles bevat ook voedingsdoelen (kcal_target, nutrition_goal, ...) en voeding blijft
 * privé. Embedden kan zo: `group_members.select(\`*, profiles(${PUBLIC_PROFILE_COLUMNS})\`)`.
 */
export const PUBLIC_PROFILE_COLUMNS = "id, display_name, bodyweight_kg, sex, height_cm, birth_date, weekly_goal";

/** Minimale kolommen die er altijd zijn (ook als de extra SQL-scripts nog niet gedraaid zijn). */
export const BASE_PROFILE_COLUMNS = "id, display_name";

/** Wat je van andermans profiel ziet (zonder voedingsdoelen). */
export type PublicProfile = Profile;

/** Voedingsdoelen in je eigen profiel: alleen van jezelf te lezen (zie upgrade-platform.sql). */
export type NutritionProfileFields = {
  activity_level?: string | null;
  nutrition_goal?: string | null;
  kcal_target?: number | null;
  protein_target?: number | null;
  carbs_target?: number | null;
  fat_target?: number | null;
};

/** Je eigen, volledige profiel. */
export type OwnProfile = Profile & NutritionProfileFields & { friend_code?: string | null; created_at?: string };

export type Group = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
};

export type GroupMember = {
  group_id: string;
  user_id: string;
  role: Role;
  profiles: Profile | null;
};

export type Workout = {
  id: string;
  group_id: string;
  date: string;
  title: string;
  notes: string | null;
  created_by: string;
};

export type WorkoutExercise = {
  id: string;
  workout_id: string;
  exercise_slug: string;
  position: number;
  target_sets: number;
  target_reps: string;
  notes: string | null;
};

export type SetLog = {
  id: string;
  workout_exercise_id: string;
  user_id: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  created_at: string;
};

export type Comment = {
  id: string;
  workout_id: string;
  workout_exercise_id: string | null;
  user_id: string;
  body: string;
  created_at: string;
};

/** Eén oefening in een schema dat nog niet is opgeslagen (builder / template). */
export type PlannedExercise = {
  slug: string;
  sets: number;
  reps: string;
  notes?: string;
};

export type Template = {
  id: string;
  owner_id: string;
  name: string;
  exercises: PlannedExercise[];
  created_at: string;
  /** Gedeeld met deze groep (zie upgrade-planning.sql); null/ontbrekend = alleen van de eigenaar. */
  group_id?: string | null;
};

/** Soorten gebeurtenissen in de groepsfeed (één definitie, in ./activities). */
export type { ActivityType };

/** Eén gebeurtenis in de groepsfeed (record, promotie, nieuw lid). */
export type Activity = {
  id: string;
  group_id: string;
  user_id: string;
  type: ActivityType;
  /** pr: { slug, detail }, promotion: { slug, tierIndex } */
  payload: { slug?: string; tierIndex?: number; detail?: string } & Record<string, unknown>;
  workout_id: string | null;
  created_by: string;
  created_at: string;
};

export type ActivityKudos = {
  activity_id: string;
  user_id: string;
  created_at: string;
};

export type BodyweightLog = {
  id: string;
  user_id: string;
  /** YYYY-MM-DD */
  date: string;
  weight_kg: number;
  created_at: string;
};

/** Pushabonnement van één apparaat (alleen op de server te lezen voor anderen). */
export type PushSubscriptionRow = {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
  created_at: string;
};

/** Soorten meldingen die iemand los aan of uit kan zetten (tabel notification_prefs). */
export type NotificationKind = "plan" | "reminder" | "weekly" | "activity";

/** Meldingsvoorkeuren van één persoon (alleen zelf te lezen). Ontbreekt de rij, dan staat alles aan. */
export type NotificationPrefs = {
  user_id: string;
  /** Ochtend "vandaag training" en avond "morgen gepland". */
  plan: boolean;
  /** Avond: training van vandaag nog niet gelogd. */
  reminder: boolean;
  /** Zondagavond: weekoverzicht. */
  weekly: boolean;
  /** Records en promoties van groepsleden. */
  activity: boolean;
  updated_at?: string;
};
