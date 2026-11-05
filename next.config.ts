import type { NextConfig } from "next";

/** Supabase-adres (alleen de origin, geen sleutels) voor de CSP van de service worker. */
function supabaseOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return "https://*.supabase.co";
  }
}

const isProd = process.env.NODE_ENV === "production";

/** Websocket-variant van het Supabase-adres (realtime). */
function supabaseSocketOrigin(origin: string): string {
  return origin.replace(/^http/, "ws");
}

/**
 * Content-Security-Policy voor de pagina's (alleen in productie: de dev-server gebruikt eval en
 * eigen websockets). Zonder nonces, dus 'unsafe-inline' voor de inline scripts en stijlen van
 * Next.js (zie node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 * - connect-src: Supabase (REST, auth, realtime) en Open Food Facts (barcode en zoeken).
 * - img-src https: voor productfoto's en YouTube-thumbnails; frame-src voor de oefenvideo's.
 */
function pageCsp(): string {
  const sb = supabaseOrigin();
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${sb} ${supabaseSocketOrigin(sb)} https://world.openfoodfacts.org https://search.openfoodfacts.org`,
    "media-src 'self' blob: data:",
    "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera is nodig voor de barcodescanner en foto's van maaltijden; de rest staat uit.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), browsing-topics=()" },
  ...(isProd
    ? [
        { key: "Content-Security-Policy", value: pageCsp() },
        // Alleen via https (ook voor een eigen domein); twee jaar onthouden.
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      ]
    : []),
];

/**
 * Build-id voor de service worker (`/sw.js?v=<id>`, zie src/lib/platform/serviceWorker.ts): de
 * commit op Vercel, anders het moment van builden. Geen geheim, dus veilig in de browserbundel.
 */
function buildId(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 12);
  return isProd ? Date.now().toString(36) : "dev";
}

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId() },
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  experimental: {
    // Alle data wordt na het inloggen in de browser geladen, dus alleen pagina's
    // met een expliciete `instant`-export valideren op directe navigatie.
    instantInsights: { validationLevel: "manual-warning" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // De service worker moet altijd vers van de server komen, anders blijven updates hangen.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          {
            key: "Content-Security-Policy",
            // connect-src: de worker haalt pagina's en Supabase-data op (voor offline gebruik).
            value: `default-src 'self'; script-src 'self'; connect-src 'self' ${supabaseOrigin()}`,
          },
        ],
      },
      {
        // Naam, kleuren en iconen van de app: altijd even navragen, zodat een wijziging snel doorkomt.
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
      {
        // Iconen veranderen zelden; een dag cachen scheelt verzoeken bij elke melding.
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
    ];
  },
};

export default nextConfig;
