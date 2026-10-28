import { createClient } from "@supabase/supabase-js";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { sendToUsers } from "@/lib/push-server";
import { TIERS } from "@/lib/ranks";

/** Meldt een nieuwe activiteit (record, promotie) aan de andere leden van de groep. */
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Niet ingelogd." }, { status: 401 });
  const { activityId } = ((await req.json().catch(() => ({}))) ?? {}) as { activityId?: string };
  if (!activityId) return Response.json({ error: "activityId ontbreekt." }, { status: 400 });

  // Lezen als de gebruiker zelf: RLS garandeert dat hij lid is van de groep.
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await sb.auth.getUser(token);
  if (!auth.user) return Response.json({ error: "Sessie verlopen." }, { status: 401 });

  const { data: a } = await sb
    .from("activities")
    .select("id, group_id, user_id, type, payload, workout_id, created_by, created_at, profiles!activities_user_id_fkey(display_name), groups(name)")
    .eq("id", activityId)
    .single();
  if (!a || a.created_by !== auth.user.id) return Response.json({ error: "Niet gevonden." }, { status: 404 });
  // Alleen verse activiteiten melden (geen herhaalde verzoeken later).
  if (Date.now() - new Date(a.created_at).getTime() > 10 * 60 * 1000) return Response.json({ sent: 0 });

  const name = (a.profiles as unknown as { display_name: string } | null)?.display_name ?? "Iemand";
  const group = (a.groups as unknown as { name: string } | null)?.name ?? "je groep";
  const p = a.payload as { slug?: string; tierIndex?: number; detail?: string };
  const exercise = (p.slug && EXERCISE_BY_SLUG[p.slug]?.name) || "een oefening";

  let title = group;
  let body = "";
  if (a.type === "promotion") {
    title = `${name} is ${TIERS[p.tierIndex ?? 0]?.name ?? "gepromoveerd"} geworden`;
    body = `${exercise} · ${group}`;
  } else if (a.type === "pr") {
    title = `Nieuw record van ${name}`;
    body = `${exercise}: ${p.detail ?? ""} · ${group}`;
  } else {
    return Response.json({ sent: 0 });
  }

  const { data: members } = await sb.from("group_members").select("user_id").eq("group_id", a.group_id);
  const recipients = (members ?? []).map((m) => m.user_id).filter((id) => id !== a.user_id && id !== auth.user!.id);
  try {
    const sent = await sendToUsers(recipients, {
      title,
      body,
      url: a.workout_id ? `/workouts/${a.workout_id}` : `/groups/${a.group_id}`,
      tag: `activity-${a.id}`,
    });
    return Response.json({ sent });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Versturen mislukt" }, { status: 500 });
  }
}
