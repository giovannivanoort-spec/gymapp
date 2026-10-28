import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { createClient } from "@supabase/supabase-js";
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

const SYSTEM = `Je schat voedingswaarden van een maaltijd op een foto voor een Nederlandse fitness-app.
- Benoem elk herkenbaar onderdeel apart met een realistische hoeveelheid in gram. Gebruik bord-, bestek- en verpakkingsgrootte als referentie.
- Geef voedingswaarden per 100 gram volgens gangbare voedingstabellen (bereide staat zoals op de foto, bijv. gekookte rijst, gebakken kip).
- Reken bereidingsvet (olie, boter) mee als het zichtbaar of waarschijnlijk is: als apart onderdeel met een lage zekerheid.
- Wees eerlijk over onzekerheid via "confidence" en "notes". Is er geen eten te zien, geef dan een lege lijst en leg het uit in "notes".
- Namen en tekst in het Nederlands, zonder emoji's.`;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ANTHROPIC_API_KEY ontbreekt." }, { status: 500 });

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Niet ingelogd." }, { status: 401 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await sb.auth.getUser(token);
  if (!auth.user) return Response.json({ error: "Sessie verlopen, log opnieuw in." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { image?: string; hint?: string } | null;
  const match = body?.image?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!match) return Response.json({ error: "Stuur een foto (jpeg, png of webp)." }, { status: 400 });
  if (match[2].length > MAX_IMAGE_CHARS) return Response.json({ error: "Foto is te groot." }, { status: 413 });
  const hint = body?.hint?.trim().slice(0, 300);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count } = await sb
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("kind", "photo")
    .gte("created_at", startOfDay.toISOString());
  if ((count ?? 0) >= DAILY_LIMIT) {
    return Response.json({ error: `Je hebt vandaag al ${DAILY_LIMIT} foto's laten schatten. Morgen weer!` }, { status: 429 });
  }
  await sb.from("ai_usage").insert({ kind: "photo" });

  try {
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
    return Response.json(response.parsed_output);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return Response.json({ error: "Even te druk, probeer het zo opnieuw." }, { status: 429 });
    if (err instanceof Anthropic.APIError) return Response.json({ error: `De AI is even niet bereikbaar (${err.status ?? "netwerk"}).` }, { status: 502 });
    return Response.json({ error: "Er ging iets mis bij het schatten." }, { status: 500 });
  }
}
