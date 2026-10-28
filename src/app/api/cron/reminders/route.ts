import { adminClient, sendToUsers } from "@/lib/push-server";

/**
 * Dagelijkse herinnering (Vercel Cron, zie vercel.json): stuurt leden van een groep een melding
 * als er vandaag een training gepland staat.
 */
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Niet toegestaan." }, { status: 401 });
  }
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
  const admin = adminClient();
  const { data: workouts } = await admin
    .from("workouts")
    .select("id, title, group_id, groups(name, group_members(user_id))")
    .eq("date", today);

  let sent = 0;
  for (const w of workouts ?? []) {
    const g = w.groups as unknown as { name: string; group_members: { user_id: string }[] } | null;
    if (!g) continue;
    sent += await sendToUsers(
      g.group_members.map((m) => m.user_id),
      { title: `Vandaag: ${w.title}`, body: `Training gepland in ${g.name}. Tik om te openen.`, url: `/workouts/${w.id}`, tag: `workout-${w.id}` },
    );
  }
  return Response.json({ workouts: workouts?.length ?? 0, sent });
}
