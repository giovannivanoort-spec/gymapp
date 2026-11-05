import { createClient } from "@supabase/supabase-js";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { sendToUsers } from "@/lib/push-server";
import { TIERS } from "@/lib/ranks";

/**
 * Activiteiten die deze serverinstantie al heeft gemeld (id -> tijdstip). Een herhaald verzoek
 * (bijv. opnieuw versturen na een haperende verbinding) laat telefoons zo niet nog eens trillen.
 */
const notified = new Map<string, number>();
const NOTIFY_WINDOW_MS = 10 * 60 * 1000;

function alreadyNotified(id: string): boolean {
  const now = Date.now();
  for (const [k, at] of notified) if (now - at > NOTIFY_WINDOW_MS) notified.delete(k);
  if (notified.has(id)) return true;
  notified.set(id, now);
  // Begrensd houden, ook als er ooit heel veel verzoeken binnenkomen.
  if (notified.size > 500) notified.delete(notified.keys().next().value!);
  return false;
}

/**
 * Meldt een nieuwe activiteit (record, promotie, training afgerond) aan de andere leden van de
 * groep. Heeft de trainer het record van iemand anders gelogd, dan krijgt die persoon ook een
 * eigen melding.
 */
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Niet ingelogd." }, { status: 401 });
  const { activityId } = ((await req.json().catch(() => ({}))) ?? {}) as { activityId?: string };
  if (!activityId || !/^[0-9a-f-]{36}$/i.test(activityId)) return Response.json({ error: "activityId ontbreekt." }, { status: 400 });

  // Lezen als de gebruiker zelf: RLS garandeert dat hij lid is van de groep.
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await sb.auth.getUser(token);
  if (!auth.user) return Response.json({ error: "Sessie verlopen." }, { status: 401 });

  const { data: a } = await sb
    .from("activities")
    .select("id, group_id, user_id, type, payload, workout_id, created_by, created_at, profiles!activities_user_id_fkey(display_name), groups(name), workouts(title)")
    .eq("id", activityId)
    .single();
  if (!a || a.created_by !== auth.user.id) return Response.json({ error: "Niet gevonden." }, { status: 404 });
  // Alleen verse activiteiten melden (geen herhaalde verzoeken later).
  if (Date.now() - new Date(a.created_at).getTime() > 10 * 60 * 1000) return Response.json({ sent: 0 });

  if (alreadyNotified(a.id)) return Response.json({ sent: 0 });

  const p = (a.payload ?? {}) as { slug?: string; tierIndex?: number; detail?: string; sets?: number; volume?: number; prs?: number };

  // Dezelfde promotie in dezelfde training maar één keer melden (bijv. bij een dubbele opslag).
  if (a.type === "promotion" && a.workout_id && p.slug) {
    const { data: dupes } = await sb
      .from("activities")
      .select("id")
      .eq("workout_id", a.workout_id)
      .eq("user_id", a.user_id)
      .eq("type", "promotion")
      .eq("payload->>slug", p.slug)
      .eq("payload->>tierIndex", String(p.tierIndex ?? 0))
      .lt("created_at", a.created_at)
      .limit(1);
    if (dupes?.length) return Response.json({ sent: 0 });
  }

  const name = (a.profiles as unknown as { display_name: string } | null)?.display_name ?? "Iemand";
  const group = (a.groups as unknown as { name: string } | null)?.name ?? "je groep";
  const exercise = (p.slug && EXERCISE_BY_SLUG[p.slug]?.name) || "een oefening";

  const workoutTitle = (a.workouts as unknown as { title: string } | null)?.title;

  let title = group;
  let body = "";
  let tag = `activity-${a.id}`;
  if (a.type === "promotion") {
    title = `${name} is ${TIERS[p.tierIndex ?? 0]?.name ?? "gepromoveerd"} geworden`;
    body = `${exercise} · ${group}`;
  } else if (a.type === "pr") {
    title = `Nieuw record van ${name}`;
    body = `${exercise}: ${p.detail ?? ""} · ${group}`;
  } else if (a.type === "finished") {
    title = `${name} heeft ${workoutTitle ? `"${workoutTitle}"` : "de training"} afgerond`;
    const parts = [
      typeof p.sets === "number" ? `${p.sets} ${p.sets === 1 ? "set" : "sets"}` : null,
      typeof p.volume === "number" && p.volume > 0 ? `${Math.round(p.volume).toLocaleString("nl-NL")} kg` : null,
      typeof p.prs === "number" && p.prs > 0 ? `${p.prs} ${p.prs === 1 ? "record" : "records"}` : null,
      group,
    ].filter(Boolean);
    body = parts.join(" · ");
    // Meerdere leden die dezelfde training afronden: één melding die zichzelf bijwerkt.
    if (a.workout_id) tag = `finished-${a.workout_id}`;
  } else {
    return Response.json({ sent: 0 });
  }

  const { data: members } = await sb.from("group_members").select("user_id").eq("group_id", a.group_id);
  const recipients = (members ?? []).map((m) => m.user_id).filter((id) => id !== a.user_id && id !== auth.user!.id);
  const url = a.workout_id ? `/workouts/${a.workout_id}` : `/groups/${a.group_id}`;

  // Door de trainer gelogd: de sporter zelf hoort het ook (met eigen tekst).
  let own: { title: string; body: string } | null = null;
  if (a.user_id !== auth.user.id && (a.type === "pr" || a.type === "promotion")) {
    const { data: me } = await sb.from("profiles").select("display_name").eq("id", auth.user.id).maybeSingle();
    const trainer = (me as { display_name?: string } | null)?.display_name ?? "Je trainer";
    own =
      a.type === "pr"
        ? { title: "Nieuw record voor jou", body: `${trainer} heeft je record gelogd: ${exercise} ${p.detail ?? ""}`.trim() }
        : { title: `Je bent ${TIERS[p.tierIndex ?? 0]?.name ?? "gepromoveerd"} geworden`, body: `${exercise} · gelogd door ${trainer}` };
  }

  try {
    const [sent, sentOwn] = await Promise.all([
      recipients.length ? sendToUsers(recipients, { title, body, url, tag }) : Promise.resolve(0),
      own ? sendToUsers([a.user_id], { ...own, url, tag: `${tag}-own` }) : Promise.resolve(0),
    ]);
    return Response.json({ sent: Number(sent) + Number(sentOwn) });
  } catch (err) {
    // Mislukt: een volgende poging mag het opnieuw proberen.
    notified.delete(a.id);
    return Response.json({ error: err instanceof Error ? err.message : "Versturen mislukt" }, { status: 500 });
  }
}
