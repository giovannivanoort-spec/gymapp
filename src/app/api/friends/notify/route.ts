import { createClient } from "@supabase/supabase-js";
import { claimOnce, pushConfigured, sendToUsers } from "@/lib/push-server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Alleen verse wijzigingen melden (geen herhaalde verzoeken later). */
const FRESH_MS = 10 * 60 * 1000;

type Event = "request" | "accepted";

/**
 * Meldt een vriendschapsverzoek ("X wil je vriend worden") of een geaccepteerd verzoek ("X heeft je
 * verzoek geaccepteerd") aan de ander. De server controleert zelf (met de rechten van de gebruiker)
 * of die vriendschap echt net is ontstaan, en stuurt per persoon en soort hooguit één melding per dag.
 */
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Niet ingelogd." }, { status: 401 });
  const { target, event } = ((await req.json().catch(() => ({}))) ?? {}) as { target?: string; event?: Event };
  if (!target || !UUID.test(target)) return Response.json({ error: "target ontbreekt." }, { status: 400 });
  if (event !== "request" && event !== "accepted") return Response.json({ error: "Onbekend event." }, { status: 400 });
  if (!pushConfigured()) return Response.json({ sent: 0 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await sb.auth.getUser(token);
  const me = auth.user?.id;
  if (!me) return Response.json({ error: "Sessie verlopen." }, { status: 401 });
  if (me === target) return Response.json({ sent: 0 });

  // Lezen als de gebruiker zelf: RLS laat alleen je eigen vriendschappen zien.
  const { data: rows } = await sb
    .from("friendships")
    .select("requester, addressee, status, created_at, accepted_at")
    .or(`and(requester.eq.${me},addressee.eq.${target}),and(requester.eq.${target},addressee.eq.${me})`);
  const row = (rows ?? [])[0] as
    | { requester: string; addressee: string; status: string; created_at: string; accepted_at: string | null }
    | undefined;
  if (!row) return Response.json({ sent: 0 });
  const fresh = (iso: string | null) => !!iso && Date.now() - new Date(iso).getTime() < FRESH_MS;
  if (event === "request" && !(row.status === "pending" && row.requester === me && fresh(row.created_at))) {
    return Response.json({ sent: 0 });
  }
  if (event === "accepted" && !(row.status === "accepted" && fresh(row.accepted_at ?? row.created_at))) {
    return Response.json({ sent: 0 });
  }

  const { data: profile } = await sb.from("profiles").select("display_name").eq("id", me).maybeSingle();
  const name = (profile as { display_name?: string } | null)?.display_name?.trim() || "Iemand";

  try {
    // Verzoek sturen, intrekken en opnieuw sturen mag geen reeks meldingen opleveren.
    const day = new Date().toISOString().slice(0, 10);
    const [allowed] = await claimOnce([target], `friend-${event}-${me}`, day);
    if (!allowed) return Response.json({ sent: 0 });
    const sent = await sendToUsers(
      [target],
      event === "request"
        ? { title: `${name} wil je vriend worden`, body: "Accepteer het verzoek om elkaars trainingen en ranks te zien.", url: `/friends/${me}`, tag: `friend-${me}` }
        : { title: `${name} is nu je vriend`, body: `Bekijk de trainingen, records en ranks van ${name}.`, url: `/friends/${me}`, tag: `friend-${me}` },
      { kind: null },
    );
    return Response.json({ sent });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Versturen mislukt" }, { status: 500 });
  }
}
