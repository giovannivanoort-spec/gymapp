import "server-only";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import type { NotificationKind, NotificationPrefs, PushSubscriptionRow } from "./types";

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

/** Supabase met de secret key: alleen op de server, omzeilt RLS (nodig om andermans abonnementen te lezen). */
export function adminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key) throw new Error("SUPABASE_SECRET_KEY ontbreekt");
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL ontbreekt");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Zijn de sleutels voor pushmeldingen ingesteld? (zonder ze te tonen) */
export function pushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.SUPABASE_SECRET_KEY);
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

export type PushMessage = { userId: string; payload: PushPayload };

type Admin = ReturnType<typeof adminClient>;

/** Tabel of kolom bestaat (nog) niet: upgrade-platform.sql is niet gedraaid. */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "") || /does not exist|schema cache/i.test(error.message ?? "");
}

/**
 * Wie van deze gebruikers wil meldingen van deze soort? Zonder eigen voorkeur: ja (standaard staat
 * alles aan). Bestaat de tabel nog niet of mislukt het lezen, dan krijgt iedereen de melding (zoals
 * voorheen), liever één melding te veel dan een gemiste training.
 */
export async function usersWanting(userIds: string[], kind: NotificationKind, admin: Admin = adminClient()): Promise<string[]> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return [];
  const off = new Set<string>();
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await admin
      .from("notification_prefs")
      .select(`user_id, ${kind}`)
      .in("user_id", unique.slice(i, i + 200));
    if (error) {
      if (!isMissingTable(error)) console.error("[push] voorkeuren ophalen mislukt:", error.code, error.message);
      return unique;
    }
    for (const row of (data ?? []) as unknown as Pick<NotificationPrefs, "user_id" | NotificationKind>[]) {
      if (row[kind] === false) off.add(row.user_id);
    }
  }
  return unique.filter((id) => !off.has(id));
}

/**
 * Legt vast dat deze gebruikers vandaag een melding van deze soort krijgen en geeft terug wie er
 * nog géén had. Zo stuurt een dubbel of opnieuw uitgevoerde cron niemand twee keer dezelfde
 * melding. Zonder tabel push_log (script niet gedraaid) gaat iedereen door.
 */
export async function claimOnce(userIds: string[], kind: string, day: string, admin: Admin = adminClient()): Promise<string[]> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return [];
  const fresh: string[] = [];
  for (let i = 0; i < unique.length; i += 500) {
    const rows = unique.slice(i, i + 500).map((user_id) => ({ user_id, kind, day }));
    const { data, error } = await admin
      .from("push_log")
      .upsert(rows, { onConflict: "user_id,kind,day", ignoreDuplicates: true })
      .select("user_id");
    if (error) {
      if (!isMissingTable(error)) console.error("[push] logboek bijwerken mislukt:", error.code, error.message);
      return unique;
    }
    for (const r of (data ?? []) as { user_id: string }[]) fresh.push(r.user_id);
  }
  return fresh;
}

/** Laat een vastgelegde melding weer vrij (bijv. als versturen helemaal mislukte), zodat een herhaalde run het opnieuw probeert. */
export async function releaseClaim(userIds: string[], kind: string, day: string, admin: Admin = adminClient()): Promise<void> {
  if (!userIds.length) return;
  const { error } = await admin.from("push_log").delete().eq("kind", kind).eq("day", day).in("user_id", userIds);
  if (error && !isMissingTable(error)) console.error("[push] logboek terugzetten mislukt:", error.code, error.message);
}

export type SendResult = {
  /** Aantal apparaten waar de melding is afgeleverd bij de pushdienst. */
  sent: number;
  /** Aantal apparaten waar het misging (niet verlopen abonnementen). */
  failed: number;
  /** Aantal opgeruimde, verlopen abonnementen. */
  removed: number;
  /**
   * Gebruikers bij wie op geen enkel apparaat iets is afgeleverd terwijl dat wel geprobeerd is
   * (fout of time-out, niet: alleen verlopen abonnementen). Een cron kan hun claim vrijgeven,
   * zodat een volgende run het opnieuw probeert.
   */
  undeliveredUsers: string[];
};

/** Langer dan dit heeft een melding (bijv. "vandaag training") geen zin meer. */
const DEFAULT_TTL = 60 * 60 * 12;
/** Maximale wachttijd per pushverzoek: een hangende pushdienst mag de cron niet ophouden. */
const SEND_TIMEOUT_MS = 10_000;
/** Zoveel pushverzoeken tegelijk. */
const SEND_CONCURRENCY = 10;

/** Voert `fn` uit voor alle items, met hooguit `limit` tegelijk. */
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Stuurt per gebruiker een eigen melding naar al zijn apparaten. Abonnementen worden in één
 * query opgehaald; verlopen abonnementen (404/410) worden opgeruimd en andere fouten gelogd.
 * Hooguit 10 verzoeken tegelijk, elk met een time-out van 10 s.
 */
export async function sendMany(messages: PushMessage[], { ttl = DEFAULT_TTL }: { ttl?: number } = {}): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0, removed: 0, undeliveredUsers: [] };
  // Eén melding per gebruiker (de laatste wint), zodat niemand dubbel gepusht wordt.
  const byUser = new Map<string, PushPayload>();
  for (const m of messages) if (m.userId) byUser.set(m.userId, m.payload);
  if (!byUser.size) return result;

  configure();
  const admin = adminClient();
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("endpoint, user_id, p256dh, auth")
    .in("user_id", [...byUser.keys()]);
  if (error) {
    console.error("[push] abonnementen ophalen mislukt:", error.code, error.message);
    throw new Error("Abonnementen ophalen mislukt");
  }

  const expired: string[] = [];
  const delivered = new Set<string>();
  const failedUsers = new Set<string>();
  const rows = ((subs ?? []) as Pick<PushSubscriptionRow, "endpoint" | "user_id" | "p256dh" | "auth">[]).filter((s) => byUser.has(s.user_id));
  await eachLimited(rows, SEND_CONCURRENCY, async (s) => {
    const payload = byUser.get(s.user_id)!;
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: ttl, urgency: "normal", topic: topicFor(payload.tag), timeout: SEND_TIMEOUT_MS },
      );
      result.sent++;
      delivered.add(s.user_id);
    } catch (err) {
      const { statusCode, body } = err as { statusCode?: number; body?: string };
      if (statusCode === 404 || statusCode === 410) {
        expired.push(s.endpoint);
      } else {
        result.failed++;
        failedUsers.add(s.user_id);
        // Alleen het domein van de pushdienst loggen, niet het (geheime) endpoint.
        let host = "onbekend";
        try {
          host = new URL(s.endpoint).host;
        } catch {
          // ongeldig endpoint
        }
        console.error("[push] versturen mislukt:", statusCode ?? "geen status", host, String(body ?? (err as Error)?.message ?? "").slice(0, 200));
      }
    }
  });
  result.undeliveredUsers = [...failedUsers].filter((u) => !delivered.has(u));

  if (expired.length) {
    const { error: delError } = await admin.from("push_subscriptions").delete().in("endpoint", expired);
    if (delError) console.error("[push] opruimen verlopen abonnementen mislukt:", delError.code, delError.message);
    else result.removed = expired.length;
  }
  return result;
}

/**
 * Web Push "topic": een nieuwere melding met hetzelfde topic vervangt een nog niet afgeleverde
 * oudere bij de pushdienst. Max. 32 tekens uit het URL-veilige base64-alfabet.
 */
function topicFor(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  const t = tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  return t || undefined;
}

/**
 * Stuurt een melding naar alle apparaten van deze gebruikers; verlopen abonnementen worden opgeruimd.
 * Alleen naar wie meldingen van soort `kind` aan heeft staan (standaard "activity": records en
 * promoties van groepsleden; `kind: null` slaat de voorkeuren over).
 */
export async function sendToUsers(
  userIds: string[],
  payload: PushPayload,
  { kind = "activity" }: { kind?: NotificationKind | null } = {},
): Promise<number> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return 0;
  const recipients = kind ? await usersWanting(unique, kind) : unique;
  if (!recipients.length) return 0;
  const { sent } = await sendMany(recipients.map((userId) => ({ userId, payload })));
  return sent;
}
