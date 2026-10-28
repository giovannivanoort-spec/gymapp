/**
 * Doorgeefluik naar Open Food Facts (alleen product- en zoek-endpoints), omdat de zoek-API
 * geen verzoeken vanuit de browser toestaat en OFF graag een herkenbare User-Agent ziet.
 */

const ALLOWED = [
  { host: "world.openfoodfacts.org", path: "/api/v2/product/" },
  { host: "search.openfoodfacts.org", path: "/search" },
];

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url");
  let target: URL;
  try {
    target = new URL(raw ?? "");
  } catch {
    return Response.json({ error: "Ongeldige url" }, { status: 400 });
  }
  if (target.protocol !== "https:" || !ALLOWED.some((a) => target.hostname === a.host && target.pathname.startsWith(a.path))) {
    return Response.json({ error: "Niet toegestaan" }, { status: 400 });
  }

  const res = await fetch(target, {
    headers: { Accept: "application/json", "User-Agent": "GymApp/1.0 (https://gymapp-eight-kappa.vercel.app)" },
  }).catch(() => null);
  if (!res) return Response.json({ error: "Open Food Facts niet bereikbaar" }, { status: 502 });

  return new Response(await res.text(), {
    status: res.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Zelfde zoekopdracht of barcode even uit de cache van Vercel.
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
