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
};
