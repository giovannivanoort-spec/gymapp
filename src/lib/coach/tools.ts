import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { analyzePlan } from "@/lib/analysis";
import { EQUIPMENT_LABEL } from "@/lib/exercise-types";
import { defaultTargetReps, EXERCISES, EXERCISE_BY_SLUG } from "@/lib/exercises";
import { GROUP_BY_ID, MUSCLE_BY_ID, MUSCLE_GROUPS, MUSCLES, type MuscleGroupId, type MuscleId } from "@/lib/muscles";
import { aggregateRanks, formatRankBest, nextTierTarget, rankExercise } from "@/lib/ranks";
import { computeTargets, type NutritionProfile } from "@/lib/nutrition/targets";
import { ageFrom } from "@/lib/dates";
import { PUBLIC_PROFILE_COLUMNS, PUBLIC_PROFILE_COLUMNS_NO_PHOTO, type Profile } from "@/lib/types";
import {
  dbMessage,
  fetchMyProfile,
  planGroupWorkout,
  todayAmsterdam,
  toolLabel as sharedToolLabel,
  type WorkoutProposal,
} from "@/lib/coach/shared";

/**
 * Openbaar profiel van een groepslid (geen voedingsdoelen). Bestaat de kolom avatar_url nog niet
 * (upgrade-avatars.sql niet gedraaid), dan opnieuw zonder profielfoto.
 */
async function fetchMemberProfile(sb: SupabaseClient, uid: string): Promise<Profile | null> {
  const query = (cols: string) => sb.from("profiles").select(cols).eq("id", uid).maybeSingle();
  let { data, error } = await query(PUBLIC_PROFILE_COLUMNS);
  if (error && (error.code === "42703" || /does not exist|schema cache/i.test(error.message ?? ""))) {
    ({ data, error } = await query(PUBLIC_PROFILE_COLUMNS_NO_PHOTO));
  }
  return (data as unknown as Profile | null) ?? null;
}

/**
 * Tools van de AI-coach. Ze gebruiken de Supabase-client van de ingelogde gebruiker,
 * dus Row Level Security bepaalt wat de coach mag lezen en schrijven.
 * De Nederlandse labels voor de chat staan in shared.ts (TOOL_LABELS), zodat de chat ze ook kent.
 */

export type ToolContext = {
  sb: SupabaseClient;
  userId: string;
  /**
   * De berichten van het gesprek tot nu toe (zoals ze naar de API gaan). Alleen nodig voor
   * delete_template: dat controleert hiermee of de gebruiker het verwijderen echt heeft bevestigd.
   */
  history?: readonly unknown[];
};

type CoachTool<S extends z.ZodType> = {
  name: string;
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
  reps: z.string().max(20).describe('Bijv. "8-12" of "10"; bij statische oefeningen (plank, wall sit) seconden, bijv. "30-60"'),
  notes: z.string().max(300).optional().describe("Korte uitvoeringstip voor deze oefening"),
});

/** Oefening in een groepsvoorstel: met optioneel een startgewicht per groepslid. */
const proposedExercise = plannedExercise.extend({
  targets: z
    .array(
      z.object({
        name: z.string().min(1).max(40).describe("Voornaam van het groepslid zoals in get_group_lifts"),
        target: z.string().min(1).max(30).describe('Startgewicht of doel voor de eerste werkset, bijv. "62,5 kg" of "+5 kg" of "lichaamsgewicht"'),
      }),
    )
    .max(8)
    .optional()
    .describe("Startgewicht per groepslid op basis van get_group_lifts. Laat leden zonder eerdere sets weg."),
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

/**
 * Haalt alle rijen van een query op in pagina's van 1000 (PostgREST geeft er nooit meer tegelijk),
 * zodat er geen willekeurige subset terugkomt. `maxPages` begrenst het geheel.
 */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>,
  maxPages = 10,
): Promise<{ rows: T[]; error: string | null; truncated: boolean }> {
  const rows: T[] = [];
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await page(i * 1000, i * 1000 + 999);
    if (error) return { rows, error: dbMessage(error), truncated: false };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < 1000) return { rows, error: null, truncated: false };
  }
  return { rows, error: null, truncated: true };
}

/** Datum (YYYY-MM-DD) van `days` dagen geleden in Nederlandse tijd. */
function daysAgo(days: number) {
  return new Date(Date.now() - days * 86400000).toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
}

// ───────── Schema's bewerken en verwijderen ─────────

type StoredExercise = { slug: string; sets: number; reps: string; notes?: string };
type TemplateRow = { id: string; name: string; owner_id: string; group_id: string | null; exercises: StoredExercise[] };

/** Opslaan-vorm (zelfde als de app): sets 1-20, lege reps naar de standaard ("8-12", of "30-60" s), lege notities weg. */
function cleanExercises(list: { slug: string; sets: number; reps: string; notes?: string | null }[]): StoredExercise[] {
  return list.map(({ slug, sets, reps, notes }) => ({
    slug,
    sets: Math.max(1, Math.min(20, Math.round(Number(sets)) || 1)),
    reps: String(reps ?? "").trim() || defaultTargetReps(slug),
    ...(notes?.trim() && { notes: notes.trim() }),
  }));
}

/** "Bench Press (bench-press) 3×8-12 – notitie" */
function fmtExercise(e: StoredExercise) {
  return `${EXERCISE_BY_SLUG[e.slug]?.name ?? e.slug} (${e.slug}) ${e.sets}×${e.reps}${e.notes ? ` – ${e.notes}` : ""}`;
}

const missingColumn = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "42703" || error.code === "PGRST204" || /group_id/.test(error.message ?? ""));

/** Eén schema ophalen (RLS: eigen schema's en schema's die met een van je groepen gedeeld zijn). */
async function fetchTemplateRow(sb: SupabaseClient, id: string): Promise<{ row: TemplateRow | null; error?: string }> {
  let res = await sb.from("templates").select("id, name, owner_id, group_id, exercises").eq("id", id).maybeSingle();
  // Zonder upgrade-planning.sql bestaat group_id nog niet: dan zonder.
  if (missingColumn(res.error)) res = await sb.from("templates").select("id, name, owner_id, exercises").eq("id", id).maybeSingle();
  if (res.error) return { row: null, error: dbMessage(res.error, "Schema ophalen") };
  if (!res.data) return { row: null };
  const d = res.data as Partial<TemplateRow>;
  return {
    row: {
      id: d.id!,
      name: d.name ?? "Schema",
      owner_id: d.owner_id!,
      group_id: d.group_id ?? null,
      exercises: Array.isArray(d.exercises) ? d.exercises : [],
    },
  };
}

/** Groepen waarvan de gebruiker trainer is (voor "mag ik dit gedeelde schema bewerken"). */
async function trainerGroupIds(sb: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data } = await sb.from("group_members").select("group_id").eq("user_id", userId).eq("role", "trainer");
  return new Set((data ?? []).map((r) => r.group_id as string));
}

const NOT_FOUND = "Schema niet gevonden of geen toegang. Gebruik list_templates voor de juiste template_id.";

/** Gerichte wijziging in een schema, zodat de coach niet het hele schema opnieuw hoeft te sturen. */
const templateChange = z.object({
  op: z
    .enum(["replace", "remove", "add", "update", "move"])
    .describe(
      "replace: oefening `slug` vervangen door `new_slug` (sets/reps blijven, tenzij meegegeven; de oude notitie vervalt). " +
        "remove: oefening `slug` weghalen. add: oefening `slug` toevoegen (met sets en reps; standaard achteraan, of op `position`). " +
        "update: sets, reps en/of notes van oefening `slug` aanpassen. move: oefening `slug` naar `position` verplaatsen.",
    ),
  slug: z
    .string()
    .describe("Slug van de oefening zoals die nu in het schema staat (zie list_templates); bij add de slug van de nieuwe oefening"),
  new_slug: z.string().optional().describe("Alleen bij replace: slug van de nieuwe oefening uit de bibliotheek"),
  sets: z.number().int().min(1).max(20).optional(),
  reps: z.string().max(20).optional().describe('Bijv. "8-12" of "10"; bij statische oefeningen (plank, wall sit) seconden, bijv. "30-60"'),
  notes: z.string().max(300).optional().describe('Nieuwe uitvoeringstip; "" haalt de notitie weg'),
  position: z.number().int().min(1).max(30).optional().describe("Plek in het schema, 1 = eerste oefening (bij add en move)"),
});
type TemplateChange = z.infer<typeof templateChange>;

/** Past de wijzigingen op volgorde toe. Geeft de nieuwe lijst, of een foutmelding voor de coach. */
function applyChanges(start: StoredExercise[], changes: TemplateChange[]): { list: StoredExercise[]; done: string[] } | { error: string } {
  const list = start.map((e) => ({ ...e }));
  const done: string[] = [];
  const nameOf = (slug: string) => EXERCISE_BY_SLUG[slug]?.name ?? slug;
  // Op slug zoeken; lukt dat niet, dan op naam (de coach geeft soms de naam in plaats van de slug).
  const find = (key: string) => {
    let i = list.findIndex((e) => e.slug === key);
    if (i < 0) {
      const k = key.trim().toLowerCase();
      i = list.findIndex((e) => (EXERCISE_BY_SLUG[e.slug]?.name ?? "").toLowerCase() === k);
    }
    return i;
  };
  const missing = (key: string) => ({
    error:
      `De oefening "${key}" staat niet in dit schema. Huidige oefeningen: ` +
      (list.length ? list.map((e) => `${nameOf(e.slug)} (${e.slug})`).join(", ") : "geen") +
      ".",
  });
  const at = (position: number | undefined) => (position == null ? list.length : Math.min(list.length, position - 1));

  for (const c of changes) {
    if (c.op === "add") {
      if (!EXERCISE_BY_SLUG[c.slug]) return { error: `Onbekende slug: ${c.slug}. Gebruik search_exercises.` };
      const [item] = cleanExercises([{ slug: c.slug, sets: c.sets ?? 3, reps: c.reps ?? defaultTargetReps(c.slug), notes: c.notes }]);
      list.splice(at(c.position), 0, item);
      done.push(`${nameOf(c.slug)} toegevoegd`);
      continue;
    }
    const i = find(c.slug);
    if (i < 0) return missing(c.slug);
    const cur = list[i];
    if (c.op === "remove") {
      list.splice(i, 1);
      done.push(`${nameOf(cur.slug)} verwijderd`);
    } else if (c.op === "replace") {
      if (!c.new_slug) return { error: "Bij replace hoort new_slug (de nieuwe oefening)." };
      if (!EXERCISE_BY_SLUG[c.new_slug]) return { error: `Onbekende slug: ${c.new_slug}. Gebruik search_exercises.` };
      [list[i]] = cleanExercises([
        { slug: c.new_slug, sets: c.sets ?? cur.sets, reps: c.reps ?? cur.reps, notes: c.notes },
      ]);
      done.push(`${nameOf(cur.slug)} vervangen door ${nameOf(c.new_slug)}`);
    } else if (c.op === "update") {
      if (c.sets == null && c.reps == null && c.notes == null) return { error: "Bij update hoort sets, reps en/of notes." };
      [list[i]] = cleanExercises([
        { slug: cur.slug, sets: c.sets ?? cur.sets, reps: c.reps ?? cur.reps, notes: c.notes ?? cur.notes },
      ]);
      done.push(`${nameOf(cur.slug)} aangepast naar ${list[i].sets}×${list[i].reps}`);
    } else if (c.op === "move") {
      if (c.position == null) return { error: "Bij move hoort position (1 = eerste oefening)." };
      list.splice(i, 1);
      list.splice(at(c.position), 0, cur);
      done.push(`${nameOf(cur.slug)} verplaatst naar plek ${Math.min(c.position, list.length)}`);
    }
  }
  return { list, done };
}

// ───────── Bevestiging voor verwijderen ─────────

type HistoryBlock = { type?: string; text?: string; id?: string; name?: string; tool_use_id?: string; content?: unknown };
type HistoryMessage = { role?: string; content?: unknown };

const blocksOf = (m: HistoryMessage): HistoryBlock[] =>
  typeof m.content === "string" ? [{ type: "text", text: m.content }] : Array.isArray(m.content) ? (m.content as HistoryBlock[]) : [];

/** Een vraag van de gebruiker (geen bericht met alleen tool-resultaten). */
const isUserText = (m: HistoryMessage) => m.role === "user" && blocksOf(m).some((b) => b.type === "text");

/**
 * Wat de gebruiker als laatste typte, en voor welke schema's het vorige antwoord om bevestiging vroeg
 * (een delete_template-resultaat met needs_confirmation tussen de vorige en de laatste vraag).
 */
function deleteConfirmation(history: readonly unknown[] | undefined): { text: string; pending: Set<string> } {
  const msgs = (history ?? []) as HistoryMessage[];
  const pending = new Set<string>();
  let last = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (isUserText(msgs[i])) {
      last = i;
      break;
    }
  }
  if (last < 0) return { text: "", pending };
  const text = blocksOf(msgs[last])
    .filter((b) => b.type === "text" && b.text && !b.text.startsWith("<context>"))
    .map((b) => b.text)
    .join("\n");
  let prev = -1;
  for (let i = last - 1; i >= 0; i--) {
    if (isUserText(msgs[i])) {
      prev = i;
      break;
    }
  }
  const asked = new Set<string>();
  for (let i = prev + 1; i < last; i++) {
    for (const b of blocksOf(msgs[i])) {
      if (msgs[i].role === "assistant" && b.type === "tool_use" && b.name === "delete_template" && b.id) asked.add(b.id);
      if (b.type === "tool_result" && b.tool_use_id && asked.has(b.tool_use_id) && typeof b.content === "string") {
        try {
          const r = JSON.parse(b.content) as { needs_confirmation?: boolean; template_id?: string };
          if (r.needs_confirmation && typeof r.template_id === "string") pending.add(r.template_id);
        } catch {
          // geen JSON
        }
      }
    }
  }
  return { text, pending };
}

const LETTER = "a-zà-ÿ";
/** Woorden waarmee een duidelijk ja begint. */
const YES_START = new RegExp(
  `^(ja+|jawel|jazeker|jep|yep|yes|zeker|zeker weten|doe maar|doe het|ok|oke|oké|okay|akkoord|prima|graag|verwijder[${LETTER}]*|weg ermee|ga je gang|bevestig[${LETTER}]*)(?![${LETTER}])`,
);
/** Begint met een los "ja": een "niet" of "geen" verderop staat dan in een reden ("die gebruik ik niet meer"). */
const JA_START = new RegExp(`^(ja+|jawel|jazeker|jep|yep|yes)(?![${LETTER}])`);
/** Altijd nee, twijfel of een voorbehoud, waar het ook staat. */
const ALWAYS_NO = new RegExp(
  `(^|[^${LETTER}])(nee|neen|no|nope|stop|wacht|annuleer[${LETTER}]*|twijfel[${LETTER}]*|misschien|toch|eerst|behalve|tenzij|liever niet|niet doen|niet verwijderen|laat maar|laat (het|hem|die|dat|ze) (maar )?staan)(?![${LETTER}])`,
);
/** "maar" als voegwoord ("ja maar ...") is een voorbehoud; na een werkwoord of voornaamwoord ("doe maar", "verwijder hem maar") niet. */
const BUT = new RegExp(`(^|[^${LETTER}])(?<!(doe|verwijder[${LETTER}]*|hem|het|die|dat|ze|ermee|weg|gerust|wel) )maar(?![${LETTER}])`);
const NEGATION = new RegExp(`(^|[^${LETTER}])(niet|geen)(?![${LETTER}])`);

/**
 * Zegt de gebruiker duidelijk ja (en niet tegelijk nee, twijfel of een voorbehoud)? Het bericht moet
 * met een bevestigend woord beginnen; een vraag ("?") of "maar", "eerst", "behalve" is geen duidelijk ja.
 */
function isClearYes(text: string) {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t || t.length > 300) return false;
  if (t.includes("?") || ALWAYS_NO.test(t) || BUT.test(t)) return false;
  if (!YES_START.test(t)) return false;
  return JA_START.test(t) || !NEGATION.test(t);
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
    description:
      `Zoek in de oefeningenbibliotheek van de app (${EXERCISES.length} oefeningen). Filter op tekst, spiergroep ` +
      "en/of losse spier. Gebruik altijd slugs uit deze bibliotheek als je een schema voorstelt of opslaat.",
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
    description: "De groepen van de gebruiker met hun rol (trainer/lid) en alle leden (id + naam).",
    schema: z.object({}),
    run: async (_input, { sb, userId }) => {
      const { data, error } = await sb
        .from("group_members")
        .select("role, groups(id, name, group_members(user_id, role, profiles(display_name)))")
        .eq("user_id", userId);
      if (error) return { error: dbMessage(error) };
      return (data ?? []).filter((row) => row.groups).map((row) => {
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
        .select("id, date, title, notes, groups!inner(name), workout_exercises(exercise_slug, position, target_sets, target_reps)")
        .order("date", { ascending: false })
        .limit(limit);
      if (group_id) q = q.eq("group_id", group_id);
      if (from) q = q.gte("date", from);
      if (to) q = q.lte("date", to);
      const { data, error } = await q;
      if (error) return { error: dbMessage(error) };
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
    description:
      "Alles wat iemand (standaard de gebruiker zelf, of een groepslid via user_id) de afgelopen dagen heeft gelogd, " +
      "per training en oefening. Gebruik dit om progressie, frequentie en volume te beoordelen.",
    schema: z.object({
      user_id: z.string().uuid().optional(),
      days: z.number().int().min(1).max(365).optional().describe("Aantal dagen terug, standaard 30"),
    }),
    run: async ({ user_id, days = 30 }, { sb, userId }) => {
      const since = daysAgo(days);
      const { rows: data, error, truncated } = await fetchAll<unknown>((from, to) =>
        sb
          .from("set_logs")
          .select("set_number, weight, reps, workout_exercises!inner(exercise_slug, workouts!inner(id, date, title))")
          .eq("user_id", user_id ?? userId)
          .gte("workout_exercises.workouts.date", since)
          .order("id")
          .range(from, to),
      );
      if (error) return { error };
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
        ...(truncated && { note: "Erg veel data; niet alle sets zijn meegenomen. Vraag een kortere periode op." }),
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
    description: "De laatste sessies van één oefening voor de gebruiker (of een groepslid): datum en sets (kg × reps).",
    schema: z.object({
      slug: z.string(),
      user_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(30).optional(),
    }),
    run: async ({ slug, user_id, limit = 10 }, { sb, userId }) => {
      if (!EXERCISE_BY_SLUG[slug]) return { error: `Onbekende slug: ${slug}` };
      // Alle sets van deze oefening ophalen (in pagina's) en daarna op datum sorteren, zodat
      // "de laatste sessies" echt de laatste zijn en geen willekeurige greep uit de tabel.
      const { rows: data, error } = await fetchAll<unknown>((from, to) =>
        sb
          .from("set_logs")
          .select("workout_exercise_id, set_number, weight, reps, workout_exercises!inner(exercise_slug, workouts!inner(date))")
          .eq("user_id", user_id ?? userId)
          .eq("workout_exercises.exercise_slug", slug)
          .order("id")
          .range(from, to),
      );
      if (error) return { error };
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
    description:
      "Krachtranks (Brons, Zilver, Goud, Platina, Diamant, Elite, Olympiër) van de gebruiker of een groepslid: per oefening " +
      "(geschatte 1RM, extra gewicht, reps, seconden bij statische houdingen of zwaarste set bij dragen/duwen, en wat nodig is " +
      "voor de volgende rang), per spiergroep en totaal. Gebaseerd op " +
      "krachtstandaarden per oefening, geslacht en lichaamsgewicht.",
    schema: z.object({ user_id: z.string().uuid().optional() }),
    run: async ({ user_id }, { sb, userId }) => {
      const uid = user_id ?? userId;
      // Eigen profiel volledig; van een groepslid alleen de openbare kolommen (geen voedingsdoelen).
      const profile =
        uid === userId
          ? await fetchMyProfile(sb, userId)
          : await fetchMemberProfile(sb, uid);
      if (!profile?.bodyweight_kg || !profile?.sex) {
        return { error: "Lichaamsgewicht en/of geslacht ontbreken in het profiel; zonder die gegevens zijn er geen ranks." };
      }
      // Stabiel pagineren (op id), anders kunnen sets bij meer dan 1000 rijen dubbel of niet meetellen.
      type R = { weight: number | null; reps: number | null; workout_exercises: { exercise_slug: string } };
      const { rows, error } = await fetchAll<R>((from, to) =>
        sb
          .from("set_logs")
          .select("weight, reps, workout_exercises!inner(exercise_slug)")
          .eq("user_id", uid)
          .not("reps", "is", null)
          .order("id")
          .range(from, to),
      );
      if (error) return { error };
      const logs = new Map<string, { weight: number | null; reps: number | null }[]>();
      for (const r of rows) {
        const slug = r.workout_exercises.exercise_slug;
        logs.set(slug, [...(logs.get(slug) ?? []), { weight: r.weight != null ? Number(r.weight) : null, reps: r.reps }]);
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
          best: formatRankBest(r),
          next_tier_at: nextTierTarget(r)?.at ?? null,
        })),
      };
    },
  }),

  tool({
    name: "get_nutrition",
    description:
      "Voedingsdagboek van de gebruiker: per dag calorieën, eiwit, koolhydraten en vet (en per maaltijd wat er gegeten is), " +
      "plus de dagdoelen (berekend uit gewicht, lengte, leeftijd, geslacht, activiteit en doel, of handmatig ingesteld).",
    schema: z.object({
      days: z.number().int().min(1).max(60).optional().describe("Aantal dagen terug, standaard 7"),
      details: z.boolean().optional().describe("Ook de losse producten per maaltijd tonen (standaard alleen voor de laatste 2 dagen)"),
    }),
    run: async ({ days = 7, details }, { sb, userId }) => {
      const since = new Date(Date.now() - (days - 1) * 86400000).toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
      const [profile, { data: logs, error }] = await Promise.all([
        fetchMyProfile(sb, userId),
        sb
          .from("food_logs")
          .select("date, meal, name, grams, kcal, protein, carbs, fat")
          // RLS laat alleen je eigen dagboek zien; dit filter is een tweede slot op de deur.
          .eq("user_id", userId)
          .gte("date", since)
          .eq("planned", false)
          .order("date")
          .limit(2000),
      ]);
      if (error) return { error: dbMessage(error) };
      const targets = computeTargets(profile as NutritionProfile | null);
      type L = { date: string; meal: string; name: string; grams: number; kcal: number; protein: number; carbs: number; fat: number };
      const byDay = new Map<string, L[]>();
      for (const l of (logs ?? []) as L[]) byDay.set(l.date, [...(byDay.get(l.date) ?? []), l]);
      const dates = [...byDay.keys()].sort();
      const r = (n: number) => Math.round(Number(n));
      return {
        goal: profile?.nutrition_goal ?? "maintain",
        activity_level: profile?.activity_level ?? "moderate",
        targets: targets && { kcal: targets.kcal, protein_g: targets.protein, carbs_g: targets.carbs, fat_g: targets.fat, bmr: targets.bmr, tdee: targets.tdee },
        days_logged: dates.length,
        days: dates.map((d, i) => {
          const items = byDay.get(d)!;
          const sum = (k: "kcal" | "protein" | "carbs" | "fat") => r(items.reduce((a, x) => a + Number(x[k]), 0));
          const showItems = details || i >= dates.length - 2;
          return {
            date: d,
            kcal: sum("kcal"),
            protein_g: sum("protein"),
            carbs_g: sum("carbs"),
            fat_g: sum("fat"),
            ...(showItems && {
              meals: Object.fromEntries(
                ["breakfast", "lunch", "dinner", "snack"].map((m) => [
                  m,
                  items.filter((x) => x.meal === m).map((x) => `${x.name} ${r(x.grams)} g (${r(x.kcal)} kcal, ${r(x.protein)} g eiwit)`),
                ]),
              ),
            }),
          };
        }),
      };
    },
  }),

  tool({
    name: "get_group_check",
    description:
      "Groepscheck voor de trainer: per lid het aantal trainingen, gemiste groepstrainingen, de laatste training en " +
      "effectieve sets per spiergroep per week over de afgelopen dagen, plus het groepsgemiddelde en de spiergroepen " +
      "die het minst getraind zijn. Gebruik dit om te zien wie achterloopt en om de volgende groepstraining te plannen. " +
      "Bevat bewust geen voeding (die is privé).",
    schema: z.object({
      group_id: z.string().uuid(),
      days: z.number().int().min(7).max(60).optional().describe("Aantal dagen terug, standaard 14"),
    }),
    run: async ({ group_id, days = 14 }, { sb }) => {
      const since = daysAgo(days);
      const today = daysAgo(0);
      const [group, members, planned] = await Promise.all([
        sb.from("groups").select("name").eq("id", group_id).maybeSingle(),
        sb.from("group_members").select("user_id, role, profiles(display_name)").eq("group_id", group_id),
        sb.from("workouts").select("id, date, title").eq("group_id", group_id).gte("date", since).lte("date", today).order("date"),
      ]);
      const firstError = group.error ?? members.error ?? planned.error;
      if (firstError) return { error: dbMessage(firstError) };
      if (!group.data) return { error: "Groep niet gevonden of geen toegang." };
      const people = (members.data ?? []).map((m) => ({
        user_id: m.user_id as string,
        role: m.role as string,
        name: (m.profiles as unknown as { display_name: string } | null)?.display_name ?? "Onbekend",
      }));
      if (!people.length) return { group: group.data.name, members: [] };

      type Row = { user_id: string; workout_exercises: { exercise_slug: string; workouts: { id: string; date: string; group_id: string } } };
      const { rows, error, truncated } = await fetchAll<Row>(
        (from, to) =>
          sb
            .from("set_logs")
            .select("user_id, workout_exercises!inner(exercise_slug, workouts!inner(id, date, group_id))")
            .in(
              "user_id",
              people.map((p) => p.user_id),
            )
            .gte("workout_exercises.workouts.date", since)
            .lte("workout_exercises.workouts.date", today)
            .order("id")
            .range(from, to),
        20,
      );
      if (error) return { error };

      const weeks = days / 7;
      const perWeek = (n: number) => Math.round((n / weeks) * 10) / 10;
      const pastGroupSessions = (planned.data ?? []).filter((w) => w.date < today);
      const groupTotals = new Map<MuscleGroupId, number>();

      const report = people.map((p) => {
        const mine = rows.filter((r) => r.user_id === p.user_id);
        const workouts = new Map<string, string>();
        const setsBySlug = new Map<string, number>();
        for (const r of mine) {
          const w = r.workout_exercises.workouts;
          workouts.set(w.id, w.date);
          const slug = r.workout_exercises.exercise_slug;
          setsBySlug.set(slug, (setsBySlug.get(slug) ?? 0) + 1);
        }
        const a = analyzePlan([...setsBySlug].map(([slug, sets]) => ({ slug, sets, reps: "" })));
        for (const g of a.groups) groupTotals.set(g.id, (groupTotals.get(g.id) ?? 0) + g.sets);
        const byGroup = a.groups.map((g) => ({ group: GROUP_BY_ID[g.id].name, per_week: perWeek(g.sets) }));
        const dates = [...workouts.values()].sort();
        return {
          name: p.name,
          role: p.role === "trainer" ? "trainer" : "lid",
          sessions: workouts.size,
          sessions_per_week: perWeek(workouts.size),
          last_trained: dates.at(-1) ?? null,
          missed_group_sessions: pastGroupSessions
            .filter((w) => !workouts.has(w.id))
            .map((w) => `${w.date} ${w.title}`),
          total_sets: mine.length,
          sets_per_week_by_muscle_group: Object.fromEntries(byGroup.filter((g) => g.per_week > 0).map((g) => [g.group, g.per_week])),
          least_trained_groups: [...byGroup].sort((x, y) => x.per_week - y.per_week).slice(0, 4).map((g) => g.group),
        };
      });

      const avg = MUSCLE_GROUPS.map((g) => ({
        group: g.name,
        per_week: perWeek((groupTotals.get(g.id) ?? 0) / people.length),
      }));
      return {
        group: group.data.name,
        period: `${since} t/m ${today} (${days} dagen)`,
        group_sessions_in_period: (planned.data ?? []).map((w) => `${w.date} ${w.title}`),
        ...(truncated && { note: "Erg veel data; niet alle sets zijn meegenomen." }),
        members: report,
        group_average_sets_per_week: Object.fromEntries(avg.map((g) => [g.group, g.per_week])),
        least_trained_groups_overall: [...avg].sort((x, y) => x.per_week - y.per_week).slice(0, 4).map((g) => g.group),
      };
    },
  }),

  tool({
    name: "list_templates",
    description:
      "De trainingsschema's (templates) van de gebruiker: eigen schema's en schema's die een trainer met een van zijn " +
      "groepen deelt. Per schema: template_id, naam, mine (eigen schema), group_id (gedeeld met die groep, anders null), " +
      "can_edit (mag aanpassen met update_template) en de oefeningen als \"Naam (slug) sets×reps – notitie\". " +
      "Alleen eigen schema's (mine) kunnen worden verwijderd.",
    schema: z.object({}),
    run: async (_input, { sb, userId }) => {
      let res: { data: unknown[] | null; error: { code?: string; message?: string } | null } = await sb
        .from("templates")
        .select("id, name, owner_id, group_id, exercises")
        .order("created_at", { ascending: false });
      if (missingColumn(res.error)) {
        res = await sb.from("templates").select("id, name, owner_id, exercises").order("created_at", { ascending: false });
      }
      if (res.error) return { error: dbMessage(res.error) };
      const rows = (res.data ?? []) as Partial<TemplateRow>[];
      const trainerOf = rows.some((t) => t.owner_id !== userId && t.group_id) ? await trainerGroupIds(sb, userId) : new Set<string>();
      return {
        count: rows.length,
        templates: rows.map((t) => {
          const mine = t.owner_id === userId;
          const group_id = t.group_id ?? null;
          return {
            template_id: t.id,
            name: t.name,
            mine,
            group_id,
            can_edit: mine || (!!group_id && trainerOf.has(group_id)),
            exercises: (Array.isArray(t.exercises) ? t.exercises : []).map(fmtExercise),
          };
        }),
      };
    },
  }),

  tool({
    name: "save_template",
    description:
      "Sla een trainingsschema op bij de schema's van de gebruiker. Alleen gebruiken als de gebruiker vraagt om een " +
      "schema te maken/opslaan. Gebruik eerst analyze_plan.",
    schema: z.object({
      name: z.string().min(1).max(80),
      exercises: z.array(plannedExercise).min(1).max(30),
    }),
    run: async ({ name, exercises }, { sb, userId }) => {
      const bad = unknownSlugs(exercises.map((e) => e.slug));
      if (bad.length) return { error: `Onbekende slugs: ${bad.join(", ")}` };
      // Idempotent: werd hetzelfde schema net al opgeslagen (bijv. een antwoord dat na een onderbreking
      // wordt afgemaakt), dan dat schema teruggeven in plaats van een dubbele.
      const shape = (list: unknown) =>
        JSON.stringify(
          (Array.isArray(list) ? list : []).map((e: { slug?: string; sets?: number; reps?: string; notes?: string }) => [
            e.slug,
            e.sets,
            e.reps,
            e.notes ?? "",
          ]),
        );
      const { data: recent } = await sb
        .from("templates")
        .select("id, exercises")
        .eq("owner_id", userId)
        .eq("name", name)
        .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
        .limit(5);
      const same = (recent ?? []).find((t) => shape(t.exercises) === shape(exercises));
      if (same) {
        return {
          ok: true,
          template_id: same.id,
          link: `/templates/${same.id}`,
          name,
          exercise_count: exercises.length,
          note: "Dit schema stond al opgeslagen; er is niets dubbel aangemaakt.",
        };
      }
      const { data, error } = await sb.from("templates").insert({ name, exercises }).select("id").single();
      if (error) return { error: dbMessage(error) };
      return { ok: true, template_id: data.id, link: `/templates/${data.id}`, name, exercise_count: exercises.length };
    },
  }),

  tool({
    name: "update_template",
    description:
      "Pas een bestaand schema aan (alleen als can_edit in list_templates true is). Haal eerst de template_id en de " +
      "huidige oefeningen op met list_templates. Gebruik bij kleine wijzigingen `changes` (bijv. één oefening vervangen, " +
      "toevoegen of weghalen, of sets/reps aanpassen); de rest van het schema blijft dan precies zoals het was. Gebruik " +
      "`exercises` alleen om het hele schema te vervangen (dan moet je alle oefeningen meesturen, ook die gelijk blijven). " +
      "Gebruik bij grotere wijzigingen eerst analyze_plan met het nieuwe schema.",
    schema: z.object({
      template_id: z.string().uuid(),
      name: z.string().min(1).max(80).optional().describe("Nieuwe naam (alleen bij hernoemen)"),
      changes: z.array(templateChange).min(1).max(20).optional().describe("Gerichte wijzigingen, op volgorde toegepast"),
      exercises: z
        .array(plannedExercise)
        .min(1)
        .max(30)
        .optional()
        .describe("Volledige nieuwe oefeningenlijst; vervangt het hele schema. Niet samen met changes gebruiken."),
    }),
    run: async ({ template_id, name, changes, exercises }, { sb, userId }) => {
      if (!name && !changes && !exercises) return { error: "Geef een nieuwe naam, changes of exercises mee." };
      if (changes && exercises) return { error: "Gebruik changes of exercises, niet allebei." };
      if (exercises) {
        const bad = unknownSlugs(exercises.map((e) => e.slug));
        if (bad.length) return { error: `Onbekende slugs: ${bad.join(", ")}` };
      }
      const { row, error: fetchError } = await fetchTemplateRow(sb, template_id);
      if (fetchError) return { error: fetchError };
      if (!row) return { error: NOT_FOUND };
      if (row.owner_id !== userId && !(row.group_id && (await trainerGroupIds(sb, userId)).has(row.group_id))) {
        return {
          error:
            "Dit schema is door een trainer met je groep gedeeld; alleen de eigenaar of een trainer van die groep kan het " +
            "aanpassen. Bied aan om een eigen kopie op te slaan (save_template) en die aan te passen.",
        };
      }

      let next = cleanExercises(row.exercises);
      let applied: string[] = [];
      if (exercises) {
        next = cleanExercises(exercises);
        applied = ["Oefeningen vervangen"];
      } else if (changes) {
        const r = applyChanges(next, changes);
        if ("error" in r) return { error: `${r.error} Er is niets gewijzigd.` };
        next = r.list;
        applied = r.done;
      }
      if (!next.length) return { error: "Een schema heeft minstens één oefening nodig. Er is niets gewijzigd." };
      if (next.length > 30) return { error: "Een schema kan maximaal 30 oefeningen hebben. Er is niets gewijzigd." };
      const newName = name?.trim() || row.name;
      if (newName !== row.name) applied.unshift(`Naam gewijzigd in "${newName}"`);

      const base = {
        ok: true,
        updated: true,
        template_id,
        link: `/templates/${template_id}`,
        name: newName,
        exercise_count: next.length,
        exercises: next.map(fmtExercise),
      };
      const unchanged = newName === row.name && JSON.stringify(next) === JSON.stringify(cleanExercises(row.exercises));
      if (unchanged) return { ...base, changes: [], note: "Het schema was al zo; er is niets gewijzigd." };

      const { data, error } = await sb
        .from("templates")
        .update({ name: newName, exercises: next })
        .eq("id", template_id)
        .select("id")
        .maybeSingle();
      if (error) {
        return {
          error:
            error.code === "42501" || /row-level security|permission denied/i.test(error.message ?? "")
              ? "Je mag dit schema niet aanpassen; alleen de eigenaar of een trainer van de groep waarmee het gedeeld is."
              : dbMessage(error, "Schema bijwerken"),
        };
      }
      if (!data) return { error: "Je mag dit schema niet aanpassen (of het bestaat niet meer). Er is niets gewijzigd." };
      return { ...base, changes: applied };
    },
  }),

  tool({
    name: "delete_template",
    description:
      "Verwijder een eigen schema (alleen als mine in list_templates true is). Twee stappen: roep dit eerst aan met " +
      "confirmed=false; er wordt dan niets verwijderd en je krijgt needs_confirmation terug. Vraag de gebruiker dan " +
      "\"Weet je zeker dat je schema <naam> wilt verwijderen?\" en roep het pas opnieuw aan met confirmed=true als de " +
      "gebruiker daar in zijn volgende bericht duidelijk ja op zegt. Nooit confirmed=true in dezelfde beurt als de vraag.",
    schema: z.object({
      template_id: z.string().uuid(),
      confirmed: z.boolean().describe("true alleen nadat de gebruiker de vraag om bevestiging duidelijk met ja heeft beantwoord"),
    }),
    run: async ({ template_id, confirmed }, { sb, userId, history }) => {
      const check = deleteConfirmation(history);
      const askedBefore = check.pending.has(template_id);
      const { row, error: fetchError } = await fetchTemplateRow(sb, template_id);
      if (fetchError) return { error: fetchError };
      if (!row) {
        // Idempotent: na een bevestigde verwijdering (of een tweede aanroep) is het schema al weg.
        if (confirmed && askedBefore) {
          return { ok: true, deleted: true, already_deleted: true, template_id, note: "Dit schema was al verwijderd." };
        }
        return { error: NOT_FOUND };
      }
      if (row.owner_id !== userId) {
        return {
          error:
            "Alleen de eigenaar kan dit schema verwijderen. Het is door een trainer met je groep gedeeld; de gebruiker kan " +
            "het niet zelf weghalen.",
        };
      }
      const exercise_count = row.exercises.length;
      if (!confirmed || !askedBefore || !isClearYes(check.text)) {
        return {
          needs_confirmation: true,
          template_id,
          name: row.name,
          exercise_count,
          note:
            `Er is niets verwijderd. Vraag de gebruiker: "Weet je zeker dat je schema ${row.name} wilt verwijderen?" ` +
            "Roep delete_template pas opnieuw aan met confirmed=true als de gebruiker daar in zijn volgende bericht duidelijk ja op zegt.",
        };
      }
      const { data, error } = await sb.from("templates").delete().eq("id", template_id).eq("owner_id", userId).select("id");
      if (error) return { error: dbMessage(error, "Verwijderen") };
      return {
        ok: true,
        deleted: true,
        template_id,
        name: row.name,
        exercise_count,
        ...(!data?.length && { already_deleted: true, note: "Dit schema was al verwijderd." }),
      };
    },
  }),

  tool({
    name: "get_group_lifts",
    description:
      "Per groepslid de laatste sessies (datum en sets kg × reps) van een paar oefeningen, in één keer. Gebruik dit bij " +
      "een groepsvoorstel om per lid een startgewicht (targets) te bepalen, zodat de trainer niets hoeft op te zoeken " +
      "terwijl hij meerdere vrienden tegelijk traint.",
    schema: z.object({
      group_id: z.string().uuid(),
      slugs: z.array(z.string()).min(1).max(12).describe("Slugs van de oefeningen in het voorstel"),
      sessions: z.number().int().min(1).max(4).optional().describe("Aantal laatste sessies per oefening, standaard 2"),
    }),
    run: async ({ group_id, slugs, sessions = 2 }, { sb }) => {
      const bad = unknownSlugs(slugs);
      if (bad.length) return { error: `Onbekende slugs: ${bad.join(", ")}` };
      const { data: members, error: mErr } = await sb
        .from("group_members")
        .select("user_id, profiles(display_name)")
        .eq("group_id", group_id);
      if (mErr) return { error: dbMessage(mErr) };
      if (!members?.length) return { error: "Groep niet gevonden of geen toegang." };
      type Row = {
        user_id: string;
        workout_exercise_id: string;
        set_number: number;
        weight: number | null;
        reps: number | null;
        workout_exercises: { exercise_slug: string; workouts: { date: string } };
      };
      const { rows, error, truncated } = await fetchAll<Row>((from, to) =>
        sb
          .from("set_logs")
          .select("user_id, workout_exercise_id, set_number, weight, reps, workout_exercises!inner(exercise_slug, workouts!inner(date))")
          .in(
            "user_id",
            members.map((m) => m.user_id as string),
          )
          .in("workout_exercises.exercise_slug", slugs)
          .gte("workout_exercises.workouts.date", daysAgo(180))
          .order("id")
          .range(from, to),
      );
      if (error) return { error };
      return {
        ...(truncated && { note: "Erg veel data; niet alle sets zijn meegenomen." }),
        members: members.map((m) => {
          const mine = rows.filter((r) => r.user_id === m.user_id);
          const lifts: Record<string, { date: string; sets: string }[]> = {};
          for (const slug of slugs) {
            const bySession = new Map<string, Row[]>();
            for (const r of mine) {
              if (r.workout_exercises.exercise_slug !== slug) continue;
              bySession.set(r.workout_exercise_id, [...(bySession.get(r.workout_exercise_id) ?? []), r]);
            }
            const list = [...bySession.values()]
              .map((rs) => ({ date: rs[0].workout_exercises.workouts.date, sets: fmtSets(rs) }))
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, sessions);
            if (list.length) lifts[EXERCISE_BY_SLUG[slug].name] = list;
          }
          return {
            name: (m.profiles as unknown as { display_name: string } | null)?.display_name ?? "Onbekend",
            lifts,
            ...(Object.keys(lifts).length === 0 && { note: "Nog geen sets van deze oefeningen in de afgelopen 180 dagen." }),
          };
        }),
      };
    },
  }),

  tool({
    name: "propose_group_workout",
    description:
      "Stel een groepstraining voor zonder iets op te slaan. De app toont het voorstel als kaart in de chat, waarop de " +
      "trainer de datum kan aanpassen en zelf op Klaarzetten drukt. Dit is de standaardmanier om een groepstraining te " +
      "plannen. Alleen voor groepen waar de gebruiker trainer is. Gebruik eerst analyze_plan, en get_group_lifts om per " +
      "oefening een startgewicht per lid (targets) mee te geven.",
    schema: z.object({
      group_id: z.string().uuid(),
      date: isoDate.describe("Voorgestelde datum (vandaag of later)"),
      title: z.string().min(1).max(80),
      notes: z.string().max(1000).optional().describe("Korte notitie voor de groep, bijv. de focus van de training"),
      exercises: z.array(proposedExercise).min(1).max(30),
    }),
    run: async ({ group_id, date, title, notes, exercises }, { sb, userId }) => {
      const bad = unknownSlugs(exercises.map((e) => e.slug));
      if (bad.length) return { error: `Onbekende slugs: ${bad.join(", ")}` };
      if (date < todayAmsterdam()) return { error: `De datum ${date} ligt in het verleden. Kies vandaag of later.` };
      const { data: m, error } = await sb
        .from("group_members")
        .select("role, groups(name)")
        .eq("group_id", group_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return { error: dbMessage(error, "Groep ophalen") };
      if (!m) return { error: "Groep niet gevonden of de gebruiker is geen lid." };
      if (m.role !== "trainer") return { error: "Alleen de trainer van deze groep kan trainingen klaarzetten." };
      const proposal: WorkoutProposal = {
        group_id,
        group: (m.groups as unknown as { name: string } | null)?.name ?? "Groep",
        date,
        title,
        ...(notes && { notes }),
        exercises: exercises.map((e) => ({
          slug: e.slug,
          name: EXERCISE_BY_SLUG[e.slug].name,
          sets: e.sets,
          reps: e.reps,
          ...(e.notes && { notes: e.notes }),
          ...(e.targets?.length && { targets: e.targets }),
        })),
      };
      return {
        ok: true,
        note: "Het voorstel staat als kaart in de chat. De trainer zet het zelf klaar met de knop; er is nog niets opgeslagen.",
        proposal,
      };
    },
  }),

  tool({
    name: "plan_group_workout",
    description:
      "Zet een training direct klaar voor een groep (zichtbaar voor alle leden), zonder kaart ter bevestiging. Alleen " +
      "gebruiken als de trainer in zijn bericht uitdrukkelijk vraagt om het direct klaar te zetten; gebruik anders " +
      "propose_group_workout. Werkt alleen als de gebruiker trainer van die groep is. Weigert datums in het verleden en " +
      "geeft een bestaande training terug als die er al staat (zelfde groep, datum en titel).",
    schema: z.object({
      group_id: z.string().uuid(),
      date: isoDate,
      title: z.string().min(1).max(80),
      notes: z.string().max(1000).optional(),
      exercises: z.array(plannedExercise).min(1).max(30),
    }),
    run: async (input, { sb }) => {
      const bad = unknownSlugs(input.exercises.map((e) => e.slug));
      if (bad.length) return { error: `Onbekende slugs: ${bad.join(", ")}` };
      const r = await planGroupWorkout(sb, input);
      if ("ok" in r && r.existing) {
        return { ...r, note: "Deze training stond al klaar; er is niets dubbel aangemaakt." };
      }
      return r;
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

export const toolLabel = sharedToolLabel;

/** Voert een tool uit; valideert eerst de invoer (bij eager streaming valideert de API niet zelf). */
export async function runTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<{ content: string; isError: boolean; data?: unknown }> {
  const t = BY_NAME.get(name);
  if (!t) return { content: JSON.stringify({ error: `Onbekende tool: ${name}` }), isError: true };
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) {
    return { content: JSON.stringify({ INVALID_INPUT: z.prettifyError(parsed.error) }), isError: true };
  }
  try {
    // De generieke koppeling tussen schema en run gaat verloren in de array; de invoer is hierboven gevalideerd.
    const result = await (t.run as (i: unknown, c: ToolContext) => Promise<unknown>)(parsed.data, ctx);
    const isError = !!result && typeof result === "object" && "error" in result;
    return { content: JSON.stringify(result), isError, data: result };
  } catch (err) {
    console.error(`[coach] tool ${name} faalde`, err);
    return { content: JSON.stringify({ error: `${toolLabel(name)} mislukte door een onverwachte fout.` }), isError: true };
  }
}
