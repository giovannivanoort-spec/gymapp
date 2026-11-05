import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const maxDuration = 120;

const MODEL = "claude-opus-5-5";
/** Maximaal aantal foto-schattingen per persoon per dag. */
const DAILY_LIMIT = Number(process.env.PHOTO_DAILY_LIMIT ?? 15);
/** ~1,5 MB base64; de app verkleint foto's vooraf tot ±1000 px. */
const MAX_IMAGE_CHARS = 2_000_000;

const Estimate = z.object({
  description: z.string().describe("Korte Nederlandse omschrijving van de maaltijd"),
  items: z.array(
    z.object({
      name: z.string().describe("Nederlandse productnaam, bijv. 'Kipfilet (gebakken)'"),
      grams: z.number().describe("Geschatte hoeveelheid in gram"),
      kcal_per_100g: z.number(),
      protein_per_100g: z.number(),
      carbs_per_100g: z.number(),
      fat_per_100g: z.number(),
      confidence: z.enum(["hoog", "middel", "laag"]),
    }),
  ),
  notes: z.string().describe("Belangrijke onzekerheden, bijv. verborgen olie of saus; leeg als er niets bijzonders is"),
});

type EstimateT = z.infer<typeof Estimate>;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Zelfde plausibiliteitsregels als voor Open Food Facts: onmogelijke waarden (negatief, meer dan
 * 950 kcal of 100 g macro's per 100 g) gaan eruit, grammen worden begrensd. Wat eruit gaat, staat in notes.
 */
function sanitize(est: EstimateT): EstimateT {
  const dropped: string[] = [];
  const items = est.items.flatMap((it) => {
    const name = it.name.trim().slice(0, 80);
    const vals = [it.kcal_per_100g, it.protein_per_100g, it.carbs_per_100g, it.fat_per_100g, it.grams];
    const ok =
      name &&
      vals.every(Number.isFinite) &&
      it.kcal_per_100g >= 0 &&
      it.kcal_per_100g <= 950 &&
      [it.protein_per_100g, it.carbs_per_100g, it.fat_per_100g].every((v) => v >= 0 && v <= 100) &&
      it.protein_per_100g + it.carbs_per_100g + it.fat_per_100g <= 105 &&
      it.grams > 0;
    if (!ok) {
      dropped.push(name || "onbekend onderdeel");
      return [];
    }
    return [
      {
        ...it,
        name,
        grams: Math.round(Math.min(3000, Math.max(1, it.grams))),
        kcal_per_100g: Math.round(it.kcal_per_100g),
        protein_per_100g: round1(it.protein_per_100g),
        carbs_per_100g: round1(it.carbs_per_100g),
        fat_per_100g: round1(it.fat_per_100g),
      },
    ];
  });
  const note = dropped.length ? `Weggelaten wegens onmogelijke waarden: ${dropped.join(", ")}.` : "";
  return { ...est, items, notes: [est.notes.trim(), note].filter(Boolean).join(" ") };
}

/** Begin van de huidige kalenderdag in Nederland (de server draait in UTC), als ISO-tijdstip. */
function startOfDutchDay(now = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Amsterdam",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  // Verschil tussen Nederlandse kloktijd en UTC (1 of 2 uur, afhankelijk van zomertijd).
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offset = asUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day) - offset).toISOString();
}

const SYSTEM = `Je schat voedingswaarden van een maaltijd op een foto voor een Nederlandse fitness-app.
- Benoem elk herkenbaar onderdeel apart met een realistische hoeveelheid in gram. Gebruik bord-, bestek- en verpakkingsgrootte als referentie.
- Geef voedingswaarden per 100 gram volgens gangbare voedingstabellen (bereide staat zoals op de foto, bijv. gekookte rijst, gebakken kip).
- Reken bereidingsvet (olie, boter) mee als het zichtbaar of waarschijnlijk is: als apart onderdeel met een lage zekerheid.
- Wees eerlijk over onzekerheid via "confidence" en "notes". Is er geen eten te zien, geef dan een lege lijst en leg het uit in "notes".
- Namen en tekst in het Nederlands, zonder emoji's.`;

/** Lopende schattingen per gebruiker: twee tegelijk zou samen langs de daglimiet kunnen glippen. */
const inFlight = new Set<string>();

/** Ingelogde gebruiker en een Supabase-client met zijn rechten (RLS), of een foutantwoord. */
async function authenticate(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: Response.json({ error: "Niet ingelogd." }, { status: 401 }) } as const;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await sb.auth.getUser(token);
  if (!auth.user) return { error: Response.json({ error: "Sessie verlopen, log opnieuw in." }, { status: 401 }) } as const;
  return { sb, userId: auth.user.id } as const;
}

/** Aantal geslaagde schattingen vandaag; null als dat niet te bepalen is (dan niet schatten: liever dicht dan open). */
async function usedToday(sb: SupabaseClient): Promise<number | null> {
  const { count, error } = await sb
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("kind", "photo")
    .gte("created_at", startOfDutchDay());
  if (error) {
    console.error("[photo] daglimiet niet te bepalen:", error.message);
    return null;
  }
  return count ?? 0;
}

/** Hoeveel schattingen er vandaag nog over zijn (voor "nog 12 van 15" in de app). */
export async function GET(req: Request) {
  const auth = await authenticate(req);
  if ("error" in auth) return auth.error;
  const used = await usedToday(auth.sb);
  if (used == null) return Response.json({ error: "Probeer het zo opnieuw." }, { status: 503 });
  return Response.json(
    { used, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - used), available: !!process.env.ANTHROPIC_API_KEY },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY ontbreekt." }, { status: 500 });

  const auth = await authenticate(req);
  if ("error" in auth) return auth.error;
  const { sb, userId } = auth;

  const body = (await req.json().catch(() => null)) as { image?: string; hint?: string } | null;
  const match = body?.image?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!match) return Response.json({ error: "Stuur een foto (jpeg, png of webp)." }, { status: 400 });
  if (match[2].length > MAX_IMAGE_CHARS) return Response.json({ error: "Foto is te groot." }, { status: 413 });
  const hint = body?.hint?.trim().slice(0, 300);

  if (inFlight.has(userId)) return Response.json({ error: "Er loopt al een schatting. Wacht even tot die klaar is." }, { status: 409 });
  inFlight.add(userId);
  try {
    const used = await usedToday(sb);
    if (used == null) return Response.json({ error: "De daglimiet kon niet worden gecontroleerd. Probeer het zo opnieuw." }, { status: 503 });
    if (used >= DAILY_LIMIT) {
      return Response.json({ error: `Je hebt vandaag al ${DAILY_LIMIT} foto's laten schatten. Morgen kan het weer.` }, { status: 429 });
    }

    const client = new Anthropic();
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "medium", format: betaZodOutputFormat(Estimate) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: match[1] as "image/jpeg" | "image/png" | "image/webp", data: match[2] } },
            { type: "text", text: hint ? `Toelichting van de gebruiker: ${hint}` : "Schat de voedingswaarden van deze maaltijd." },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return Response.json({ error: "Deze foto kon niet worden geschat. Probeer een andere foto." }, { status: 422 });
    }
    // Alleen geslaagde schattingen tellen mee voor de daglimiet.
    const { error: usageError } = await sb.from("ai_usage").insert({ kind: "photo" });
    if (usageError) console.error("[photo] gebruik niet geregistreerd:", usageError.message);
    return Response.json({ ...sanitize(response.parsed_output), remaining: Math.max(0, DAILY_LIMIT - used - 1) });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return Response.json({ error: "Even te druk, probeer het zo opnieuw." }, { status: 429 });
    if (err instanceof Anthropic.APIError) return Response.json({ error: `De AI is even niet bereikbaar (${err.status ?? "netwerk"}).` }, { status: 502 });
    return Response.json({ error: "Er ging iets mis bij het schatten." }, { status: 500 });
  } finally {
    inFlight.delete(userId);
  }
}
