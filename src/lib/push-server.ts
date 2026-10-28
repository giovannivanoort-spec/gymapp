import "server-only";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

/** Supabase met de secret key: alleen op de server, omzeilt RLS (nodig om andermans abonnementen te lezen). */
export function adminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY ontbreekt");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let configured = false;
function configure() {
  if (configured) return;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error("VAPID-sleutels ontbreken");
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://gymapp.vercel.app", pub, priv);
  configured = true;
}

/** Stuurt een melding naar alle apparaten van deze gebruikers; verlopen abonnementen worden opgeruimd. */
export async function sendToUsers(userIds: string[], payload: PushPayload): Promise<number> {
  if (!userIds.length) return 0;
  configure();
  const admin = adminClient();
  const { data: subs } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth").in("user_id", userIds);
  let sent = 0;
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 12 },
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }),
  );
  return sent;
}
