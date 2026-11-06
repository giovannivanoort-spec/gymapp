// Spotter service worker: offline gebruik en pushmeldingen.
//
// Caches (los van elkaar, elk met een maximum aantal items):
// - spotter-static-v2: app-bestanden uit /_next/static (namen bevatten een hash, dus nooit verouderd)
//   en iconen. Cache eerst. Bewust zonder build-versie in de naam: een pagina die nog op een oude
//   versie draait, kan zijn oude bestanden dan nog steeds laden.
// - spotter-pages-v2: pagina's (HTML/RSC). Netwerk eerst, met cache als terugval; bij zwak bereik
//   (sportschool-wifi, kelder) wacht een pagina maximaal ~3,5 s op het netwerk als er een bewaarde
//   versie is, het netwerkantwoord werkt de cache daarna alsnog bij.
// - spotter-data-v4: GET-antwoorden van Supabase (/rest/v1), zodat je de laatst geladen training
//   offline kunt zien. Per gebruiker gesleuteld (uit het login-token), privédata zoals voeding,
//   coachgesprekken en gezondheidsgegevens (stappen, kcal, slaap) wordt nooit bewaard, en alles wordt gewist bij uitloggen ("clear-data").
//   Alleen als het netwerk echt faalt komt de bewaarde kopie terug, gemarkeerd met de header
//   `x-sw-cache: hit` (en `x-sw-cached-at`). De app slaat zo'n kopie dan niet op als verse data en
//   toont eerlijk dat je offline bent. Geen time-out-race: een trage maar werkende verbinding geeft
//   altijd de nieuwste data, en pagina's van één lijst komen nooit uit twee verschillende momenten.
//   Niet bewaard: de (incrementele) trainingsgeschiedenis, die de app zelf al op het toestel bewaart
//   en die bij elke gelogde set een nieuw adres heeft, en een eigen profiel met voedingsdoelen.
//   Het totaal is begrensd op aantal items én op grootte.
// - Pagina die offline nog nooit geopend is: een eenvoudige offline-pagina (/offline.html) met
//   "Opnieuw" en een link naar de start, in plaats van de HTML van een andere pagina.

const VERSION = "spotter-v3";
// Optioneel: /sw.js?v=<build-id> bij het registreren, dan is de versie per build te herkennen.
const SW_VERSION = new URL(self.location.href).searchParams.get("v") || VERSION;
// v2: nieuwe favicon (de oude Next.js-favicon uit v1 wordt bij activeren opgeruimd).
const STATIC_CACHE = "spotter-static-v2";
const PAGES_CACHE = "spotter-pages-v2";
// v3: zonder geschiedenis en privé-profielkolommen (v2 wordt bij activeren opgeruimd).
// v4: zonder gezondheidsgegevens (daily_activity, daily_sleep, activity_settings); v3 kon die nog bevatten.
const DATA_CACHE = "spotter-data-v4";
const KEEP = [STATIC_CACHE, PAGES_CACHE, DATA_CACHE];

const OFFLINE_URL = "/offline.html";
const SHELL = ["/", OFFLINE_URL, "/manifest.webmanifest", "/icon.svg", "/icons/icon-192.png", "/icons/badge-96.png", "/apple-icon.png"];
const NETWORK_TIMEOUT_MS = 3500;
const MAX_STATIC = 300;
const MAX_PAGES = 40;
const MAX_DATA = 200;
/** Maximale totale grootte (bytes) van de data-cache en van één antwoord daarin. */
const MAX_DATA_BYTES = 12 * 1024 * 1024;
const MAX_DATA_ITEM_BYTES = 1.5 * 1024 * 1024;

// Privétabellen: nooit in Cache Storage (voeding blijft privé, ook op een gedeeld toestel).
// Gezondheidsgegevens (AVG art. 9: stappen, kcal, slaap en de toestemmingen daarvoor) ook niet: die moeten
// na intrekken of verwijderen direct van het toestel verdwijnen. Gelijk aan HEALTH_TABLE in src/lib/cache.ts.
const PRIVATE_TABLE = /\/rest\/v1\/(?:[a-z_]*(?:food|meal|nutrition|water|macro|coach|diet|sleep)[a-z_]*|daily_[a-z_]*|activity_settings|activity_consent_log|ai_usage|push_subscriptions|notification_prefs|push_log)(?:[/?]|$)/i;

// Kolommen met voedingsdoelen in profiles: zo'n antwoord niet bewaren.
const PRIVATE_PROFILE_COLUMNS = /(?:^|[,(])\s*(?:\*|kcal_target|protein_target|carbs_target|fat_target|nutrition_goal|activity_level)\s*(?:[,)]|$)/;

/**
 * Wordt dit Supabase-antwoord niet in de data-cache bewaard? Wel doorgegeven, alleen niet bewaard.
 * - Geschiedenis (set_logs met trainingen erbij of met een created_at-filter): elke gelogde set
 *   geeft een nieuw adres, dus de cache zou volstromen met eenmalige kopieën die de belangrijke
 *   items (training van vandaag, groep) wegdrukken. De app bewaart de geschiedenis zelf al.
 * - Profielen opgevraagd met * of met voedingskolommen: voeding blijft privé, ook offline.
 */
function skipDataCache(url) {
  const select = url.searchParams.get("select") || "";
  if (/\/rest\/v1\/set_logs(?:[/?]|$)/.test(url.pathname)) {
    if (url.searchParams.has("created_at") || /workouts!inner/.test(select)) return true;
  }
  if (/\/rest\/v1\/profiles(?:[/?]|$)/.test(url.pathname) && (!select || PRIVATE_PROFILE_COLUMNS.test(select))) return true;
  // Volledige profielen als onderdeel van een andere tabel (bijv. groepsleden met profiles(*)).
  if (/profiles(?:![a-z_]+)?\(\s*\*/i.test(select) || /profiles(?:![a-z_]+)?\([^)]*(?:kcal_target|protein_target|carbs_target|fat_target|nutrition_goal|activity_level)/i.test(select)) return true;
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGES_CACHE);
      // Eén mislukt bestand mag de installatie niet blokkeren.
      await Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" }))));
      // De vorige service workers gaven bij zwak bereik oude data terug alsof die vers was
      // (gymapp-v1 zelfs zonder onderscheid per gebruiker): die meteen vervangen. Latere updates
      // wachten op "Herladen" in de app (of tot alle vensters dicht zijn).
      if ((await caches.has("gymapp-v1")) || (await caches.has("spotter-data-v1"))) await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "skip-waiting") {
    self.skipWaiting();
  } else if (type === "clear-data") {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("spotter-data")).map((k) => caches.delete(k)))),
    );
  } else if (type === "version" && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: SW_VERSION });
  }
});

// ─────────── Hulpfuncties ───────────

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  // cache.keys() geeft de volgorde van toevoegen: de oudste eerst weg.
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

let lastDataTrim = 0;

/**
 * Data-cache begrenzen op aantal en grootte (bytes, uit de header x-sw-size). Hooguit eens per
 * 20 s, behalve als `force`. De oudste items gaan eerst weg.
 */
async function trimData(force = false) {
  const now = Date.now();
  if (!force && now - lastDataTrim < 20_000) return;
  lastDataTrim = now;
  const cache = await caches.open(DATA_CACHE);
  const keys = await cache.keys();
  const sizes = await Promise.all(
    keys.map(async (k) => {
      const r = await cache.match(k, { ignoreVary: true });
      return (r && Number(r.headers.get("x-sw-size"))) || 0;
    }),
  );
  let total = sizes.reduce((a, b) => a + b, 0);
  let count = keys.length;
  for (let i = 0; i < keys.length && (count > MAX_DATA || total > MAX_DATA_BYTES); i++) {
    await cache.delete(keys[i]);
    total -= sizes[i];
    count--;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Gebruikers-id (sub) uit het login-token van een Supabase-verzoek, of null zonder login. */
function userOf(request) {
  const header = request.headers.get("authorization") || "";
  const part = header.replace(/^Bearer\s+/i, "").split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")));
    return typeof json.sub === "string" && json.sub ? json.sub : null;
  } catch {
    return null;
  }
}

/** Cachesleutel voor data: zelfde URL maar per gebruiker (en per antwoordvorm) apart. */
function dataKey(request, userId) {
  const url = new URL(request.url);
  url.searchParams.set("__sw_user", userId);
  const accept = request.headers.get("accept") || "";
  // .single() vraagt hetzelfde adres op met een andere Accept-header (object i.p.v. lijst).
  if (accept.includes("vnd.pgrst")) url.searchParams.set("__sw_accept", accept.replace(/[^a-z0-9.+/-]/gi, ""));
  const profile = request.headers.get("accept-profile");
  if (profile) url.searchParams.set("__sw_profile", profile);
  return new Request(url.toString());
}

/**
 * Netwerk eerst, met een time-out als er een bewaarde versie is (voor pagina's). Het
 * netwerkantwoord werkt de cache ook bij als de bewaarde versie al getoond is.
 */
async function networkFirst(event, request, { cacheName, key = request, maxEntries, fallbackUrl, preload }) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key, { ignoreVary: true });

  const network = (async () => {
    const response = (preload && (await preload.catch(() => undefined))) || (await fetch(request));
    if (response.ok) {
      await cache.put(key, response.clone());
      event.waitUntil(trim(cacheName, maxEntries));
    }
    return response;
  })();

  if (!cached) {
    try {
      return await network;
    } catch (err) {
      const fallback = fallbackUrl && (await caches.match(fallbackUrl, { ignoreVary: true }));
      if (fallback) return fallback;
      throw err;
    }
  }

  // Netwerkantwoord altijd laten afmaken (cache bijwerken), ook als de time-out wint.
  event.waitUntil(network.catch(() => {}));
  const fromNetwork = network.then(
    (response) => (response.status >= 500 ? cached : response),
    () => cached,
  );
  return Promise.race([fromNetwork, sleep(NETWORK_TIMEOUT_MS).then(() => cached)]);
}

/** Bewaarde kopie met een markering, zodat de app weet dat het geen vers antwoord is. */
function markStale(cached) {
  const headers = new Headers();
  // Bij een CORS-antwoord zijn alleen de vrijgegeven headers leesbaar; dat zijn precies de headers
  // die supabase-js gebruikt (Content-Type, Content-Range).
  cached.headers.forEach((value, name) => {
    if (name !== "x-sw-cached-at") headers.set(name, value);
  });
  headers.set("x-sw-cache", "hit");
  headers.set("x-sw-cached-at", cached.headers.get("x-sw-cached-at") || "0");
  return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
}

/** Kopie om te bewaren, met het tijdstip van ophalen en de grootte erbij (null als te groot). */
async function stamped(response) {
  const headers = new Headers();
  response.headers.forEach((value, name) => headers.set(name, value));
  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_DATA_ITEM_BYTES) return null;
  headers.set("x-sw-cached-at", String(Date.now()));
  headers.set("x-sw-size", String(body.byteLength));
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Supabase-data: altijd het netwerk. Alleen als dat echt faalt (offline, verbinding weg, 5xx)
 * komt de bewaarde kopie terug, gemarkeerd als offline kopie.
 */
async function dataNetworkFirst(event, request, key, store = true) {
  const cache = await caches.open(DATA_CACHE);
  let response;
  try {
    response = await fetch(request);
  } catch (err) {
    const cached = await cache.match(key, { ignoreVary: true });
    if (cached) return markStale(cached);
    throw err;
  }
  if (response.ok && store) {
    const copy = response.clone();
    event.waitUntil(
      stamped(copy)
        .then((r) => (r ? cache.put(key, r).then(() => trimData()) : cache.delete(key)))
        .catch(() => trimData(true).catch(() => {})),
    );
  } else if (response.status >= 500) {
    const cached = await cache.match(key, { ignoreVary: true });
    if (cached) return markStale(cached);
  }
  return response;
}

async function cacheFirst(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    event.waitUntil(trim(STATIC_CACHE, MAX_STATIC));
  }
  return response;
}

// ─────────── Verzoeken ───────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;
    if (url.pathname === OFFLINE_URL) {
      event.respondWith(caches.match(OFFLINE_URL, { ignoreVary: true }).then((r) => r || fetch(request)));
      return;
    }
    if (
      url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname === "/icon.svg" ||
      url.pathname === "/favicon.ico"
    ) {
      event.respondWith(cacheFirst(event, request));
    } else if (request.mode === "navigate") {
      event.respondWith(
        networkFirst(event, request, {
          cacheName: PAGES_CACHE,
          maxEntries: MAX_PAGES,
          fallbackUrl: OFFLINE_URL,
          preload: event.preloadResponse,
        }),
      );
    } else if (!url.pathname.startsWith("/_next/") && !url.searchParams.has("_rsc") && !request.headers.get("rsc")) {
      // Overige bestanden (manifest e.d.). RSC-verzoeken van de router gaan direct naar het netwerk:
      // offline valt Next.js dan terug op een gewone paginalading, die hierboven uit de cache komt.
      event.respondWith(networkFirst(event, request, { cacheName: PAGES_CACHE, maxEntries: MAX_PAGES }));
    }
    return;
  }

  // Supabase-data (niet de login-, opslag- of realtime-endpoints), alleen met een ingelogde gebruiker.
  if (url.hostname.endsWith(".supabase.co") && url.pathname.startsWith("/rest/v1/")) {
    if (PRIVATE_TABLE.test(url.pathname)) return;
    const userId = userOf(request);
    if (!userId) return;
    event.respondWith(dataNetworkFirst(event, request, dataKey(request, userId), !skipDataCache(url)));
  }
});

// ─────────── Pushmeldingen ───────────

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Spotter", {
      body: data.body || "",
      // Android toont geen SVG in meldingen; de badge moet wit op transparant zijn.
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag,
      lang: "nl",
      timestamp: Date.now(),
      data: { url: data.url || "/" },
    }),
  );
});

/** Vraagt een open venster om zelf (zonder herladen) naar `url` te gaan; true als dat lukte. */
function askClientToNavigate(client, url) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 1000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(Boolean(e.data && e.data.ok));
    };
    try {
      client.postMessage({ type: "navigate", url }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

async function openOrFocus(target) {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const ours = list.filter((c) => {
    try {
      return new URL(c.url).origin === target.origin;
    } catch {
      return false;
    }
  });
  const exact = ours.find((c) => {
    const u = new URL(c.url);
    return u.pathname + u.search === target.pathname + target.search;
  });
  if (exact) return exact.focus();

  const client = ours.find((c) => c.focused) || ours[0];
  if (client) {
    const focused = await client.focus().catch(() => client);
    const path = target.pathname + target.search + target.hash;
    if (await askClientToNavigate(focused || client, path)) return focused;
    try {
      const navigated = await client.navigate(target.href);
      if (navigated) return navigated;
    } catch {
      // venster wordt niet door deze service worker beheerd: dan een nieuw venster
    }
  }
  return self.clients.openWindow(target.href);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target;
  try {
    target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
  } catch {
    target = new URL("/", self.location.origin);
  }
  if (target.origin !== self.location.origin) target = new URL("/", self.location.origin);
  event.waitUntil(openOrFocus(target));
});
