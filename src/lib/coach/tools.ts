import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { analyzePlan } from "@/lib/analysis";
import { EQUIPMENT_LABEL } from "@/lib/exercise-types";
import { EXERCISES, EXERCISE_BY_SLUG } from "@/lib/exercises";
import { GROUP_BY_ID, MUSCLE_BY_ID, MUSCLE_GROUPS, MUSCLES, type MuscleGroupId, type MuscleId } from "@/lib/muscles";
import { aggregateRanks, rankExercise } from "@/lib/ranks";
import { ageFrom } from "@/lib/dates";

/**
 * Tools van de AI-coach. Ze gebruiken de Supabase-client van de ingelogde gebruiker,
 * dus Row Level Security bepaalt wat de coach mag lezen en schrijven.
 */

export type ToolContext = { sb: SupabaseClient; userId: string };

type CoachTool<S extends z.ZodType> = {
  name: string;
  /** Korte Nederlandse status voor in de chat, bijv. "Trainingen bekijken". */
  label: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
};

function tool<S extends z.ZodType>(t: CoachTool<S>) {
  return t;
}

const muscleIds = MUSCLES.map((m) => m.id) as [MuscleId, ...MuscleId[]];
const groupIds = MUSCLE_GROUPS.map((g) => g.id) as [MuscleGroupId, ...MuscleGroupId[]];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Gebruik YYYY-MM-DD");

const plannedExercise = z.object({
  slug: z.string().describe("Slug uit de oefeningenbibliotheek"),
  sets: z.number().int().min(1).max(20),
  reps: z.string().max(20).describe('Bijv. "8-12" of "10"'),
  notes: z.string().max(300).optional().describe("Korte uitvoeringstip voor deze oefening"),
});

/** Compacte weergave van een oefening voor in tool-resultaten. */
function brief(slug: string) {
  const e = EXERCISE_BY_SLUG[slug];
  if (!e) return { slug, name: slug };
  return {
    slug,
    name: e.name,
    equipment: EQUIPMENT_LABEL[e.equipment],
    primary: e.primary.map((m) => MUSCLE_BY_ID[m].short),
    secondary: e.secondary.map((m) => MUSCLE_BY_ID[m].short),
  };
}

function unknownSlugs(slugs: string[]) {
  return slugs.filter((s) => !EXERCISE_BY_SLUG[s]);
}

function fmtSets(logs: { set_number: number; weight: number | null; reps: number | null }[]) {
  return [...logs]
    .sort((a, b) => a.set_number - b.set_number)
    .map((l) => `${l.weight != null ? `${Number(l.weight)}kg×` : ""}${l.reps ?? "–"}`)
    .join(", ");
}

export const TOOLS = [
  tool({
    name: "search_exercises",
    label: "Oefeningen zoeken",
    description:
      "Zoek in de oefeningenbibliotheek van de app (219 oefeningen). Filter op tekst, spiergroep en/of losse spier. " +
      "Gebruik altijd slugs uit deze bibliotheek als je een schema voorstelt of opslaat.",
    schema: z.object({
      query: z.string().optional().describe("Zoektekst in de naam, bijv. 'curl'"),
      group: z.enum(groupIds).optional().describe("Spiergroep"),
      muscle: z.enum(muscleIds).optional().describe("Losse spier of spierkop"),
      primary_only: z.boolean().optional().describe("Alleen oefeningen waarbij de spier(groep) een hoofdspier is"),
      limit: z.number().int().min(1).max(60).optional(),
    }),
    run: async ({ query, group, muscle, primary_only, limit = 30 }) => {
      const q = query?.toLowerCase().trim();
      const hits = EXERCISES.filter((e) => {
        const pool = primary_only ? e.primary : [...e.primary, ...e.secondary];
        if (muscle && !pool.includes(muscle)) return false;
        if (group && !pool.some((m) => MUSCLE_BY_ID[m].group === group)) return false;
        return !q || e.name.toLowerCase().includes(q) || e.slug.includes(q.replace(/\s+/g, "-"));
      });
      return { count: hits.length, exercises: hits.slice(0, limit).map((e) => brief(e.slug)) };
    },
  }),

  tool({
    name: "get_exercise",
    label: "Oefening bekijken",
    description: "Volledige info over één oefening: spieren (met groep), uitvoering in stappen en tips.",
    schema: z.object({ slug: z.string() }),
    run: async ({ slug }) => {
      const e = EXERCISE_BY_SLUG[slug];
      if (!e) return { error: `Onbekende slug: ${slug}. Gebruik search_exercises.` };
      return {
        ...brief(slug),
        primary: e.primary.map((m) => `${GROUP_BY_ID[MUSCLE_BY_ID[m].group].name}: ${MUSCLE_BY_ID[m].name}`),
        secondary: e.secondary.map((m) => `${GROUP_BY_ID[MUSCLE_BY_ID[m].group].name}: ${MUSCLE_BY_ID[m].name}`),
        summary: e.summary,
        steps: e.steps,
        tips: e.tips,
      };
    },
  }),

  tool({
    name: "analyze_plan",
    label: "Spieren analyseren",
    description:
      "Analyseer een (voorgestelde) training met de spieranalyse van de app: effectieve sets per spiergroep en per " +
      "losse spier, verdeling duwen/trekken/benen/core en tips wat ontbreekt. Gebruik dit voordat je een schema " +
      "voorstelt of opslaat, en bij het nakijken van een training.",
    schema: z.object({ exercises: z.array(plannedExercise).min(1).max(30) }),
    run: async ({ exercises }) => {
      const bad = unknownSlugs(exercises.map((e) => e.slug));
      if (bad.length) return { error: `Onbekende slugs: ${bad.join(", ")}` };
      const a = analyzePlan(exercises);
      return {
        total_sets: a.totalSets,
        focus: a.focus,
        regions: a.regions,
        groups: a.groups
          .filter((g) => g.sets > 0)
          .map((g) => ({
            group: GROUP_BY_ID[g.id].name,
            sets: g.sets,
            muscles: Object.fromEntries(g.muscles.map((m) => [MUSCLE_BY_ID[m.id].short, m.sets])),
          })),
        untrained_groups: a.groups.filter((g) => g.sets === 0).map((g) => GROUP_BY_ID[g.id].name),
        suggestions: a.suggestions.map((s) => ({
          type: s.kind,
          text: s.text,
          exercises: s.exercises.map((e) => e.slug),
        })),
      };
    },
  }),

  tool({
    name: "list_my_groups",
    label: "Groepen bekijken",
    description: "De groepen van de gebruiker met hun rol (trainer/lid) en alle leden (id + naam).",
    schema: z.object({}),
    run: async (_input, { sb, userId }) => {
      const { data, error } = await sb
        .from("group_members")
        .select("role, groups(id, name, group_members(user_id, role, profiles(display_name)))")
        .eq("user_id", userId);
      if (error) return { error: error.message };
      return (data ?? []).map((row) => {
        const g = row.groups as unknown as {
          id: string;
          name: string;
          group_members: { user_id: string; role: string; profiles: { display_name: string } | null }[];
        };
        return {
          group_id: g.id,
          name: g.name,
          my_role: row.role,
          members: g.group_members.map((m) => ({
            user_id: m.user_id,
            name: m.profiles?.display_name,
            role: m.role,
          })),
        };
      });
    },
  }),

  tool({
    name: "list_workouts",
    label: "Trainingen bekijken",
    description:
      "Geplande en gedane groepstrainingen (alle groepen van de gebruiker, of één groep), met de oefeningen en doelen.",
    schema: z.object({
      group_id: z.string().uuid().optional(),
      from: isoDate.optional().describe("Vanaf datum (inclusief)"),
      to: isoDate.optional().describe("Tot en met datum"),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    run: async ({ group_id, from, to, limit = 20 }, { sb }) => {
      let q = sb
        .from("workouts")
        .select("id, date, title, notes, groups(name), workout_exercises(exercise_slug, position, target_sets, target_reps)")
        .order("date", { ascending: false })
        .limit(limit);
      if (group_id) q = q.eq("group_id", group_id);
      if (from) q = q.gte("date", from);
      if (to) q = q.lte("date", to);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return (data ?? []).map((w) => ({
        workout_id: w.id,
        date: w.date,
        title: w.title,
        group: (w.groups as unknown as { name: string } | null)?.name,
        notes: w.notes,
        exercises: [...w.workout_exercises]
          .sort((a, b) => a.position - b.position)
          .map((we) => `${EXERCISE_BY_SLUG[we.exercise_slug]?.name ?? we.exercise_slug} (${we.exercise_slug}) ${we.target_sets}×${we.target_reps}`),
      }));
    },
  }),

  tool({
    name: "get_workout",
    label: "Training nakijken",
    description:
      "Alle details van één training: oefeningen met doelen, de gelogde sets (kg × reps) van ieder groepslid, en de opmerkingen.",
    schema: z.object({ workout_id: z.string().uuid() }),
    run: async ({ workout_id }, { sb }) => {
      const { data: w, error } = await sb
        .from("workouts")
        .select("id, date, title, notes, group_id, groups(name), workout_exercises(id, exercise_slug, position, target_sets, target_reps, notes)")
        .eq("id", workout_id)
        .single();
      if (error || !w) return { error: "Training niet gevonden of geen toegang." };
      const wexIds = w.workout_exercises.map((we) => we.id);
      const [logs, comments, members] = await Promise.all([
        wexIds.length
          ? sb.from("set_logs").select("workout_exercise_id, user_id, set_number, weight, reps").in("workout_exercise_id", wexIds)
          : Promise.resolve({ data: [] as never[] }),
        sb.from("comments").select("workout_exercise_id, body, created_at, profiles(display_name)").eq("workout_id", workout_id).order("created_at"),
        sb.from("group_members").select("user_id, profiles(display_name)").eq("group_id", w.group_id),
      ]);
      const name = (uid: string) =>
        (members.data ?? []).find((m) => m.user_id === uid)?.profiles as unknown as { display_name: string } | undefined;
      return {
        date: w.date,
        title: w.title,
        group: (w.groups as unknown as { name: string } | null)?.name,
        notes: w.notes,
        exercises: [...w.workout_exercises]
          .sort((a, b) => a.position - b.position)
          .map((we) => {
            const mine = (logs.data ?? []).filter((l) => l.workout_exercise_id === we.id);
            const byUser = [...new Set(mine.map((l) => l.user_id))];
            return {
              exercise: `${EXERCISE_BY_SLUG[we.exercise_slug]?.name ?? we.exercise_slug} (${we.exercise_slug})`,
              target: `${we.target_sets}×${we.target_reps}`,
              trainer_note: we.notes,
              logged: Object.fromEntries(
                byUser.map((uid) => [name(uid)?.display_name ?? uid, fmtSets(mine.filter((l) => l.user_id === uid))]),
              ),
              comments: (comments.data ?? [])
                .filter((c) => c.workout_exercise_id === we.id)
                .map((c) => `${(c.profiles as unknown as { display_name: string } | null)?.display_name}: ${c.body}`),
            };
          }),
        general_comments: (comments.data ?? [])
          .filter((c) => !c.workout_exercise_id)
          .map((c) => `${(c.profiles as unknown as { display_name: string } | null)?.display_name}: ${c.body}`),
      };
    },
  }),

  tool({
    name: "get_training_log",
    label: "Trainingslog bekijken",
    description:
      "Alles wat iemand (standaard de gebruiker zelf, of een groepslid via user_id) de afgelopen dagen heeft gelogd, " +
      "per training en oefening. Gebruik dit om progressie, frequentie en volume te beoordelen.",
    schema: z.object({
      user_id: z.string().uuid().optional(),
      days: z.number().int().min(1).max(365).optional().describe("Aantal dagen terug, standaard 30"),
    }),
    run: async ({ user_id, days = 30 }, { sb, userId }) => {
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const { data, error } = await sb
        .from("set_logs")
        .select("set_number, weight, reps, workout_exercises!inner(exercise_slug, workouts!inner(id, date, title))")
        .eq("user_id", user_id ?? userId)
        .gte("workout_exercises.workouts.date", since)
        .limit(2000);
      if (error) return { error: error.message };
      type Row = {
        set_number: number;
        weight: number | null;
        reps: number | null;
        workout_exercises: { exercise_slug: string; workouts: { id: string; date: string; title: string } };
      };
      const sessions = new Map<string, { date: string; title: string; exercises: Map<string, Row[]> }>();
      for (const r of (data ?? []) as unknown as Row[]) {
        const w = r.workout_exercises.workouts;
        if (!sessions.has(w.id)) sessions.set(w.id, { date: w.date, title: w.title, exercises: new Map() });
        const ex = sessions.get(w.id)!.exercises;
        const slug = r.workout_exercises.exercise_slug;
        ex.set(slug, [...(ex.get(slug) ?? []), r]);
      }
      return {
        days,
        sessions: [...sessions.values()]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((s) => ({
            date: s.date,
            title: s.title,
            exercises: Object.fromEntries(
              [...s.exercises].map(([slug, rows]) => [EXERCISE_BY_SLUG[slug]?.name ?? slug, fmtSets(rows)]),
            ),
          })),
      };
    },
  }),

  tool({
    name: "get_exercise_history",
    label: "Progressie bekijken",
    description: "De laatste sessies van één oefening voor de gebruiker (of een groepslid): datum en sets (kg × reps).",
    schema: z.object({
      slug: z.string(),
      user_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(30).optional(),
    }),
    run: async ({ slug, user_id, limit = 10 }, { sb, userId }) => {
      if (!EXERCISE_BY_SLUG[slug]) return { error: `Onbekende slug: ${slug}` };
      const { data, error } = await sb
        .from("set_logs")
        .select("workout_exercise_id, set_number, weight, reps, workout_exercises!inner(exercise_slug, workouts!inner(date))")
        .eq("user_id", user_id ?? userId)
        .eq("workout_exercises.exercise_slug", slug)
        .limit(500);
      if (error) return { error: error.message };
      type Row = {
        workout_exercise_id: string;
        set_number: number;
        weight: number | null;
        reps: number | null;
        workout_exercises: { workouts: { date: string } };
      };
      const bySession = new Map<string, Row[]>();
      for (const r of (data ?? []) as unknown as Row[]) {
        bySession.set(r.workout_exercise_id, [...(bySession.get(r.workout_exercise_id) ?? []), r]);
      }
      return {
        exercise: EXERCISE_BY_SLUG[slug].name,
        sessions: [...bySession.values()]
          .map((rows) => ({ date: rows[0].workout_exercises.workouts.date, sets: fmtSets(rows) }))
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, limit),
      };
    },
  }),

  tool({
    name: "get_strength_ranks",
    label: "Ranks bekijken",
    description:
      "Krachtranks (Brons, Zilver, Goud, Platina, Diamant, Elite, Olympiër) van de gebruiker of een groepslid: per oefening " +
      "(geschatte 1RM of reps, en wat nodig is voor de volgende rang), per spiergroep en totaal. Gebaseerd op " +
      "krachtstandaarden per oefening, geslacht en lichaamsgewicht.",
    schema: z.object({ user_id: z.string().uuid().optional() }),
    run: async ({ user_id }, { sb, userId }) => {
      const uid = user_id ?? userId;
      const { data: profile } = await sb.from("profiles").select("*").eq("id", uid).single();
      if (!profile?.bodyweight_kg || !profile?.sex) {
        return { error: "Lichaamsgewicht en/of geslacht ontbreken in het profiel; zonder die gegevens zijn er geen ranks." };
      }
      const logs = new Map<string, { weight: number | null; reps: number | null }[]>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb
          .from("set_logs")
          .select("weight, reps, workout_exercises!inner(exercise_slug)")
          .eq("user_id", uid)
          .not("reps", "is", null)
          .range(from, from + 999);
        if (error) return { error: error.message };
        for (const r of (data ?? []) as unknown as { weight: number | null; reps: number | null; workout_exercises: { exercise_slug: string } }[]) {
          const slug = r.workout_exercises.exercise_slug;
          logs.set(slug, [...(logs.get(slug) ?? []), { weight: r.weight != null ? Number(r.weight) : null, reps: r.reps }]);
        }
        if (!data || data.length < 1000) break;
      }
      const ranks = [...logs]
        .map(([slug, l]) => rankExercise(slug, l, Number(profile.bodyweight_kg), profile.sex, ageFrom(profile.birth_date)))
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => b.score - a.score);
      const agg = aggregateRanks(ranks);
      return {
        bodyweight_kg: Number(profile.bodyweight_kg),
        overall: agg.overall ? { tier: agg.overall.tier.name, score: Math.round(agg.overall.score * 100) / 100 } : null,
        groups: agg.groups.map((g) => ({ group: GROUP_BY_ID[g.group].name, tier: g.tier.name })),
        exercises: ranks.map((r) => ({
          exercise: EXERCISE_BY_SLUG[r.slug]?.name ?? r.slug,
          tier: r.tier.name,
          progress_to_next: `${Math.round(r.progress * 100)}%`,
          best: r.unit === "reps" ? `${r.value} reps` : r.viaAdded ? `+${r.value} kg extra (1RM)` : `1RM ≈ ${r.value} kg`,
          next_tier_at: r.nextAt == null ? null : r.unit === "reps" ? `${r.nextAt} reps` : `${Math.ceil(r.nextAt)} kg${r.viaAdded ? " extra" : " 1RM"}`,
        })),
      };
    },
  }),

  tool({
    name: "list_templates",
    label: "Schema's bekijken",
    description: "De opgeslagen trainingsschema's (templates) van de gebruiker.",
    schema: z.object({}),
    run: async (_input, { sb }) => {
      const { data, error } = await sb.from("templates").select("id, name, exercises").order("created_at", { ascending: false });
      if (error) return { error: error.message };
      return data;
    },
  }),

  tool({
    name: "save_template",
    label: "Schema opslaan",
    description:
      "Sla een trainingsschema op bij de schema's van de gebruiker. Alleen gebruiken als de gebruiker vraagt om een " +
      "schema te maken/opslaan. Gebruik eerst analyze_plan.",
    schema: z.object({
      name: z.string().min(1).max(80),
      exercises: z.array(plannedExercise).min(1).max(30),
    }),
    run: async ({ name, exercises }, { sb }) => {
      const bad = unknownSlugs(exercises.map((e) => e.slug));
      if (bad.length) return { error: `Onbekende slugs: ${bad.join(", ")}` };
      const { data, error } = await sb.from("templates").insert({ name, exercises }).select("id").single();
      if (error) return { error: error.message };
      return { ok: true, template_id: data.id, link: `/templates/${data.id}` };
    },
  }),

  tool({
    name: "plan_group_workout",
    label: "Training klaarzetten",
    description:
      "Zet een training klaar voor een groep op een datum (zichtbaar voor alle leden). Werkt alleen als de gebruiker " +
      "trainer van die groep is. Alleen gebruiken als de gebruiker daar expliciet om vraagt of je voorstel heeft bevestigd.",
    schema: z.object({
      group_id: z.string().uuid(),
      date: isoDate,
      title: z.string().min(1).max(80),
      notes: z.string().max(1000).optional(),
      exercises: z.array(plannedExercise).min(1).max(30),
    }),
    run: async ({ group_id, date, title, notes, exercises }, { sb }) => {
      const bad = unknownSlugs(exercises.map((e) => e.slug));
      if (bad.length) return { error: `Onbekende slugs: ${bad.join(", ")}` };
      const { data: w, error } = await sb
        .from("workouts")
        .insert({ group_id, date, title, notes: notes || null })
        .select("id")
        .single();
      if (error) return { error: `Niet gelukt (ben je trainer van deze groep?): ${error.message}` };
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
        return { error: exErr.message };
      }
      return { ok: true, workout_id: w.id, link: `/workouts/${w.id}` };
    },
  }),
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Tooldefinities voor de Claude API (JSON Schema uit de Zod-schema's). */
export const TOOL_DEFINITIONS: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => {
  const schema = z.toJSONSchema(t.schema) as Record<string, unknown>;
  delete schema.$schema;
  return {
    name: t.name,
    description: t.description,
    input_schema: schema as Anthropic.Beta.BetaTool["input_schema"],
    eager_input_streaming: true,
  };
});

export function toolLabel(name: string) {
  return BY_NAME.get(name)?.label ?? name;
}

/** Voert een tool uit; valideert eerst de invoer (bij eager streaming valideert de API niet zelf). */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  const t = BY_NAME.get(name);
  if (!t) return { content: `Onbekende tool: ${name}`, isError: true };
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) {
    return { content: JSON.stringify({ INVALID_INPUT: z.prettifyError(parsed.error) }), isError: true };
  }
  try {
    // De generieke koppeling tussen schema en run gaat verloren in de array; de invoer is hierboven gevalideerd.
    const result = await (t.run as (i: unknown, c: ToolContext) => Promise<unknown>)(parsed.data, ctx);
    const isError = !!result && typeof result === "object" && "error" in result;
    return { content: JSON.stringify(result), isError };
  } catch (err) {
    return { content: `Fout in ${name}: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
