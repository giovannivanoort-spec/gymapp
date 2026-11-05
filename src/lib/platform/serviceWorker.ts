"use client";

/**
 * Eén plek om de service worker te registreren, met de build-id in het adres (`/sw.js?v=<id>`).
 * Zo is per build te zien welke versie draait (bericht "version") en geeft elke nieuwe build een
 * update, ook als sw.js zelf niet veranderde (de pagina-shell in de cache wordt dan ververst).
 *
 * Gebruik overal registerServiceWorker() in plaats van navigator.serviceWorker.register("/sw.js"):
 * twee verschillende adressen zouden elkaar steeds als "nieuwe versie" vervangen.
 */

/** Build-id uit next.config (geen geheim), "dev" tijdens ontwikkelen. */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
export const SW_URL = `/sw.js?v=${encodeURIComponent(BUILD_ID)}`;

let registering: Promise<ServiceWorkerRegistration | undefined> | null = null;

/** Service workers zijn beschikbaar (en we zitten niet in de dev-server). */
export function serviceWorkerSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && process.env.NODE_ENV === "production";
}

/** Registreert de service worker (één keer per sessie); undefined als dat niet kan. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (!serviceWorkerSupported()) return Promise.resolve(undefined);
  registering ??= navigator.serviceWorker.register(SW_URL, { scope: "/" }).catch(() => {
    registering = null;
    return undefined;
  });
  return registering;
}

/** Versie van de service worker die deze pagina nu beheert, of null (geen worker of geen antwoord). */
export function serviceWorkerVersion(timeoutMs = 1_500): Promise<string | null> {
  const controller = typeof navigator !== "undefined" ? navigator.serviceWorker?.controller : null;
  if (!controller) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (e: MessageEvent<{ version?: unknown }>) => {
      clearTimeout(timer);
      resolve(typeof e.data?.version === "string" ? e.data.version : null);
    };
    try {
      controller.postMessage({ type: "version" }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}
