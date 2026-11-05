/**
 * Doorgeefluik naar Open Food Facts (alleen product- en zoek-endpoints), omdat de zoek-API
 * geen verzoeken vanuit de browser toestaat en OFF graag een herkenbare User-Agent ziet.
 */

const ALLOWED = [
  { host: "world.openfoodfacts.org", path: "/api/v2/product/" },
  { host: "search.openfoodfacts.org", path: "/search" },
];

const USER_AGENT = "Spotter/1.0 (https://gymapp-eight-kappa.vercel.app)";
const TIMEOUT_MS = 12_000;

/**
 * Alleen geslaagde antwoorden lang cachen. Een storing of rate limit van OFF mag niet een uur
 * lang in de CDN blijven hangen; een onbekende barcode (404) wel even.
 */
function cacheControl(status: number): string {
  if (status >= 200 && status < 300) return "public, s-maxage=3600, stale-while-revalidate=86400";
  if (status === 404) return "public, s-maxage=300";
  return "no-store";
}

/** Per IP maximaal zoveel verzoeken per minuut (per serverinstantie, als eenvoudige rem). */
const RATE_LIMIT = 90;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; start: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (now - v.start > RATE_WINDOW_MS) hits.delete(k);
  }
  const h = hits.get(ip);
  if (!h || now - h.start > RATE_WINDOW_MS) {
    hits.set(ip, { count: 1, start: now });
    return false;
  }
  h.count++;
  return h.count > RATE_LIMIT;
}

/**
 * Alleen verzoeken vanuit de app zelf: zo wordt de server geen open doorgeefluik naar OFF onder
 * onze User-Agent. Moderne browsers sturen Sec-Fetch-Site; oudere vallen terug op de Referer.
 */
function fromOwnSite(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const ref = req.headers.get("origin") ?? req.headers.get("referer");
  if (!host || !ref) return false;
  try {
    return new URL(ref).host === host;
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const noStore = { "Cache-Control": "no-store" };
  if (!fromOwnSite(req)) return Response.json({ error: "Niet toegestaan" }, { status: 403, headers: noStore });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "onbekend";
  if (rateLimited(ip)) {
    return Response.json({ error: "Te veel zoekopdrachten" }, { status: 429, headers: { ...noStore, "Retry-After": "60" } });
  }

  const raw = new URL(req.url).searchParams.get("url");
  let target: URL;
  try {
    target = new URL(raw ?? "");
  } catch {
    return Response.json({ error: "Ongeldige url" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (target.protocol !== "https:" || !ALLOWED.some((a) => target.hostname === a.host && target.pathname.startsWith(a.path))) {
    return Response.json({ error: "Niet toegestaan" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const res = await fetch(target, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  if (!res) return Response.json({ error: "Open Food Facts niet bereikbaar" }, { status: 502, headers: { "Cache-Control": "no-store" } });

  const body = await res.text().catch(() => "");
  const isJson = (res.headers.get("content-type") ?? "").includes("json") || /^\s*[[{]/.test(body);
  if (!isJson) {
    // Bijv. een HTML-foutpagina bij drukte: geef een nette JSON-fout terug in plaats van onleesbare HTML.
    const status = res.ok ? 502 : res.status;
    return Response.json({ error: "Onverwacht antwoord van Open Food Facts" }, { status, headers: { "Cache-Control": "no-store" } });
  }

  return new Response(body, {
    status: res.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl(res.status),
    },
  });
}
