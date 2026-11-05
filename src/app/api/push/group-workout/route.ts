import { createClient } from "@supabase/supabase-js";
import { pushConfigured, sendToUsers } from "@/lib/push-server";

/** Zelfde training niet vaker dan dit melden (bijv. twee keer snel na elkaar opslaan). */
const MIN_INTERVAL_MS = 2 * 60 * 1000;
const lastSent = new Map<string, number>();

/** Datum (YYYY-MM-DD) in Nederland, ook als de server in een andere tijdzone draait. */
function amsterdamDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function dayLabel(iso: string): string {
  if (iso === amsterdamDate()) return "vandaag";
  if (iso === amsterdamDate(1)) return "morgen";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12))
    .toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .replace(/\./g, "");
}

/**
 * Meldt aan de leden van een groep dat de trainer een training heeft gepland of aangepast.
 * Alleen een trainer van de groep mag dit versturen, en alleen voor trainingen van vandaag of later.
 */
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Niet ingelogd." }, { status: 401 });
  const body = ((await req.json().catch(() => ({}))) ?? {}) as { workoutId?: string; kind?: string };
  const workoutId = body.workoutId;
  const kind = body.kind === "edit" ? "edit" : "new";
  if (!workoutId || !/^[0-9a-f-]{36}$/i.test(workoutId)) return Response.json({ error: "workoutId ontbreekt." }, { status: 400 });
  if (!pushConfigured()) return Response.json({ sent: 0 });

  // Lezen als de gebruiker zelf: RLS garandeert dat hij lid is van de groep.
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await sb.auth.getUser(token);
  if (!auth.user) return Response.json({ error: "Sessie verlopen." }, { status: 401 });

  const { data: w } = await sb
    .from("workouts")
    .select("id, group_id, title, date, groups(name), workout_exercises(count)")
    .eq("id", workoutId)
    .maybeSingle();
  if (!w || !w.group_id) return Response.json({ error: "Niet gevonden." }, { status: 404 });
  if (w.date < amsterdamDate(-1)) return Response.json({ sent: 0 });

  const { data: members } = await sb.from("group_members").select("user_id, role").eq("group_id", w.group_id);
  const me = (members ?? []).find((m) => m.user_id === auth.user!.id);
  if (me?.role !== "trainer") return Response.json({ error: "Alleen trainers kunnen leden een melding sturen." }, { status: 403 });

  const last = lastSent.get(w.id);
  if (last && Date.now() - last < MIN_INTERVAL_MS) return Response.json({ sent: 0 });
  lastSent.set(w.id, Date.now());

  const group = (w.groups as unknown as { name: string } | null)?.name ?? "je groep";
  const count = (w.workout_exercises as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
  const parts = [w.title as string, dayLabel(w.date as string), count ? `${count} ${count === 1 ? "oefening" : "oefeningen"}` : null].filter(Boolean);

  const recipients = (members ?? []).map((m) => m.user_id as string).filter((id) => id !== auth.user!.id);
  try {
    const sent = await sendToUsers(
      recipients,
      {
        title: kind === "edit" ? `Training aangepast in ${group}` : `Nieuwe training in ${group}`,
        body: parts.join(" · "),
        url: `/workouts/${w.id}`,
        // Een latere wijziging vervangt de eerdere melding over dezelfde training.
        tag: `group-workout-${w.id}`,
      },
      { kind: "plan" },
    );
    return Response.json({ sent });
  } catch (err) {
    lastSent.delete(w.id);
    return Response.json({ error: err instanceof Error ? err.message : "Versturen mislukt" }, { status: 500 });
  }
}
