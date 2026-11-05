import type { SupabaseClient } from "@supabase/supabase-js";
import type { OwnProfile } from "@/lib/types";

/**
 * Gedeeld tussen de chat (client), de API-route en de tools (server): labels, kaartjes en het
 * klaarzetten van een groepstraining. Bewust zonder "server-only" en zonder zware imports.
 */

/** Korte Nederlandse status per tool, voor de chips in de chat. */
export const TOOL_LABELS: Record<string, string> = {
  search_exercises: "Oefeningen zoeken",
  get_exercise: "Oefening bekijken",
  analyze_plan: "Spieren analyseren",
  list_my_groups: "Groepen bekijken",
  list_workouts: "Trainingen bekijken",
  get_workout: "Training nakijken",
  get_training_log: "Trainingslog bekijken",
  get_exercise_history: "Progressie bekijken",
  get_group_check: "Groep checken",
  list_templates: "Schema's bekijken",
  save_template: "Schema opslaan",
  propose_group_workout: "Voorstel maken",
  plan_group_workout: "Training klaarzetten",
  get_strength_ranks: "Ranks bekijken",
  get_nutrition: "Voeding bekijken",
  get_group_lifts: "Startgewichten bepalen",
};

export const toolLabel = (name: string) => TOOL_LABELS[name] ?? "Gegevens bekijken";

/**
 * Je eigen volledige profiel (met voedingsdoelen) op de server, met een client die het token van
 * de gebruiker gebruikt. Via de functie get_my_profile, zodat dit ook werkt als de voedingskolommen
 * voor anderen zijn afgeschermd; bestaat die functie nog niet (SQL niet gedraaid), dan via de tabel.
 * Bij een andere fout: `null` (de coach werkt dan zonder profielgegevens).
 */
export async function fetchMyProfile(sb: SupabaseClient, userId: string): Promise<OwnProfile | null> {
  const rpc = await sb.rpc("get_my_profile");
  if (!rpc.error) {
    const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as OwnProfile | null | undefined;
    return row && row.id === userId ? row : null;
  }
  if (rpc.error.code !== "PGRST202" && rpc.error.code !== "42883") return null;
  const { data } = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
  return (data as OwnProfile | null) ?? null;
}

/** Staat aan het eind van een antwoord dat met Stop is afgebroken (zo ziet de coach dat ook). */
export const STOP_MARK = "_(gestopt)_";

/** Tools die iets opslaan (na afloop moeten caches elders in de app ververst worden). */
export const WRITE_TOOLS = new Set(["save_template", "plan_group_workout"]);

/** Kaartje in de chat na een opgeslagen schema of een klaargezette training. */
export type Artifact = { kind: "template" | "workout"; link: string; title: string; detail: string };

export type ProposalExercise = { slug: string; name: string; sets: number; reps: string; notes?: string };
/** Voorstel voor een groepstraining dat de trainer zelf bevestigt via de kaart in de chat. */
export type WorkoutProposal = {
  group_id: string;
  group: string;
  date: string;
  title: string;
  notes?: string;
  exercises: ProposalExercise[];
};

/** Vandaag (YYYY-MM-DD) in Nederlandse tijd. */
export function todayAmsterdam(now = new Date()) {
  return now.toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
}

/** "do 6 nov" */
export function formatShortDate(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Amsterdam" });
}

export function artifactFrom(name: string, data: unknown): Artifact | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.link !== "string") return null;
  const count = typeof d.exercise_count === "number" ? `${d.exercise_count} oefeningen` : "";
  if (name === "save_template") return { kind: "template", link: d.link, title: String(d.name ?? "Schema"), detail: count };
  if (name === "plan_group_workout") {
    const when = typeof d.date === "string" ? formatShortDate(d.date) : "";
    return {
      kind: "workout",
      link: d.link,
      title: String(d.title ?? "Training"),
      detail: [d.group, when, count].filter(Boolean).join(" · "),
    };
  }
  return null;
}

/** Voorstel uit het resultaat van propose_group_workout (of null). */
export function proposalFrom(name: string, data: unknown): WorkoutProposal | null {
  if (name !== "propose_group_workout" || !data || typeof data !== "object") return null;
  const p = (data as { proposal?: WorkoutProposal }).proposal;
  if (!p || typeof p.group_id !== "string" || typeof p.date !== "string" || !Array.isArray(p.exercises)) return null;
  return p;
}

// ───────── Klaarzetten ─────────

type PlanInput = {
  group_id: string;
  date: string;
  title: string;
  notes?: string | null;
  exercises: { slug: string; sets: number; reps: string; notes?: string | null }[];
};
export type PlanResult =
  | { ok: true; workout_id: string; link: string; title: string; date: string; group: string; exercise_count: number; existing?: boolean }
  | { error: string };

/** Korte Nederlandse foutmelding voor een database-fout (de technische tekst gaat naar de log). */
export function dbMessage(error: { code?: string; message?: string } | null | undefined, action = "Ophalen"): string {
  if (!error) return `${action} mislukt.`;
  if (error.code === "42501" || /row-level security|permission denied/i.test(error.message ?? "")) {
    return `${action} niet toegestaan (geen rechten).`;
  }
  if (error.code === "23505") return "Dit bestaat al.";
  if (error.code === "23503") return `${action} mislukt: iets waarnaar verwezen wordt bestaat niet (meer).`;
  if (error.code === "22P02" || error.code === "22007") return `${action} mislukt: ongeldige waarde.`;
  return `${action} mislukt door een databasefout.`;
}

/**
 * Zet een groepstraining klaar (werkt alleen voor trainers; RLS controleert dat). Weigert datums in
 * het verleden en maakt geen dubbele training: staat er al een met dezelfde groep, datum en titel,
 * dan komt die terug met `existing: true`.
 */
export async function planGroupWorkout(sb: SupabaseClient, input: PlanInput): Promise<PlanResult> {
  const { group_id, date, title, notes, exercises } = input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Ongeldige datum." };
  if (date < todayAmsterdam()) return { error: `De datum ${formatShortDate(date)} ligt in het verleden. Kies vandaag of later.` };
  if (!exercises.length) return { error: "Een training heeft minstens één oefening nodig." };

  const { data: group, error: gErr } = await sb.from("groups").select("name").eq("id", group_id).maybeSingle();
  if (gErr) return { error: dbMessage(gErr, "Groep ophalen") };
  if (!group) return { error: "Groep niet gevonden of geen toegang." };

  const base = { link: "", title, date, group: group.name as string, exercise_count: exercises.length };
  const { data: dup } = await sb
    .from("workouts")
    .select("id")
    .eq("group_id", group_id)
    .eq("date", date)
    .eq("title", title)
    .limit(1);
  if (dup?.[0]) {
    const id = dup[0].id as string;
    return { ok: true, ...base, workout_id: id, link: `/workouts/${id}`, existing: true };
  }

  const { data: w, error } = await sb
    .from("workouts")
    .insert({ group_id, date, title, notes: notes || null })
    .select("id")
    .single();
  if (error || !w) {
    return {
      error:
        error?.code === "42501" || /row-level security/i.test(error?.message ?? "")
          ? "Alleen de trainer van deze groep kan trainingen klaarzetten."
          : dbMessage(error, "Klaarzetten"),
    };
  }
  const { error: exErr } = await sb.from("workout_exercises").insert(
    exercises.map((e, position) => ({
      workout_id: w.id,
      exercise_slug: e.slug,
      position,
      target_sets: e.sets,
      target_reps: e.reps,
      notes: e.notes || null,
    })),
  );
  if (exErr) {
    await sb.from("workouts").delete().eq("id", w.id);
    return { error: dbMessage(exErr, "Oefeningen opslaan") };
  }
  return { ok: true, ...base, workout_id: w.id as string, link: `/workouts/${w.id}` };
}

// ───────── Vervolgvragen ─────────

/**
 * Twee of drie logische vervolgvragen onder het laatste antwoord, op basis van wat de coach in die
 * beurt heeft gedaan (gebruikte tools, opgeslagen schema's, voorstellen).
 */
export function followupsFor(
  tools: string[],
  opts: { hasTemplate: boolean; hasWorkout: boolean; hasProposal: boolean; trainerGroup?: string },
): string[] {
  const used = new Set(tools);
  const out: string[] = [];
  const add = (s: string) => {
    if (!out.includes(s) && out.length < 3) out.push(s);
  };
  const g = opts.trainerGroup;
  if (opts.hasProposal) {
    add("Maak het voorstel wat zwaarder");
    add("Vervang een oefening door een variant met dumbbells");
    add("Pas de startgewichten aan voor wie vorige keer moeite had");
  }
  if (opts.hasWorkout) add("Geef een korte warming-up voor deze training");
  if (opts.hasTemplate) {
    if (g) add(`Stel deze training voor als groepstraining voor ${g}`);
    add("Hoe bouw ik dit schema de komende weken op?");
  }
  if (used.has("get_group_check") && g && !opts.hasProposal) add(`Stel de volgende training voor ${g} voor op basis hiervan`);
  if (used.has("get_workout")) add("Wat moet ik volgende keer anders doen?");
  if (used.has("get_exercise_history")) add("Maak een plan om deze oefening de komende weken te laten stijgen");
  if (used.has("get_strength_ranks")) add("Bij welke oefening zit ik het dichtst bij de volgende rang?");
  if (used.has("get_nutrition")) add("Geef een voorbeelddag die mijn eiwitdoel haalt");
  if (used.has("get_training_log")) add("Welke spiergroepen train ik te weinig?");
  if (used.has("analyze_plan") && !opts.hasTemplate && !opts.hasProposal) add("Sla dit op als schema");
  return out;
}
