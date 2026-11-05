"use client";

import { useEffect } from "react";
import { activitySettingsKey, fetchActivitySettings } from "@/lib/activity";
import { fetchCached } from "@/lib/cache";
import {
  disconnectHealth,
  getHealthLink,
  HEALTH_RESYNC_DAYS,
  healthPermissions,
  isNativeApp,
  nativePlatform,
  syncDaysSince,
  syncHealth,
} from "@/lib/native/health";

/** Hooguit eens per zoveel ms automatisch synchroniseren. */
const SYNC_THROTTLE_MS = 15 * 60_000;
/** Na een mislukte poging: eerst 15 minuten wachten, na herhaalde mislukkingen een uur. */
const RETRY_AFTER_MS = [15 * 60_000, 60 * 60_000];

/**
 * Laatste automatische poging en het aantal mislukkingen op rij (voor deze app-sessie). lastSyncAt in
 * de koppeling wordt alleen na een geslaagde sync gezet; zonder dit zou elke terugkeer naar de app bij
 * een blijvende fout (server weigert, rechten ingetrokken) opnieuw alles ophalen.
 */
let lastAttemptAt = 0;
let failures = 0;

/**
 * Achtergrond-sync met Health Connect in de Android-app. Eén keer gemonteerd (AuthProvider, alleen
 * met een sessie). Bij het openen en bij het terugkeren naar de app: als de gebruiker toestemming
 * heeft gegeven voor activiteit in Spotter én Health Connect op dit toestel heeft gekoppeld, en de
 * laatste sync langer dan 15 minuten geleden is, de laatste dagen opnieuw ophalen en opslaan.
 * Na een mislukte poging wacht hij 15 minuten, daarna een uur. Fouten blijven stil (de gebruiker ziet
 * de status en een knop "Nu synchroniseren" bij Profiel > Koppelingen).
 * Doet niets op het web.
 */
export function NativeHealthSync({ userId }: { userId: string }) {
  useEffect(() => {
    if (!userId || !isNativeApp() || nativePlatform() !== "android") return;
    let alive = true;
    let remove: (() => void) | null = null;

    async function maybeSync() {
      const link = getHealthLink(userId);
      if (!alive || !link.connected) return;
      const now = Date.now();
      const last = link.lastSyncAt ? Date.parse(link.lastSyncAt) : 0;
      if (last && now - last < SYNC_THROTTLE_MS) return;
      // Intussen wel gelukt (bijv. "Nu synchroniseren"): de wachttijd na fouten vervalt.
      if (last > lastAttemptAt) failures = 0;
      if (failures > 0 && now - lastAttemptAt < RETRY_AFTER_MS[Math.min(failures, RETRY_AFTER_MS.length) - 1]) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      lastAttemptAt = now;
      try {
        // Goedkoop eerst: zonder recht op stappen heeft niets anders zin (de gebruiker ziet "Geen toegang" bij Koppelingen).
        const perms = await healthPermissions();
        if (!alive) return;
        if (!perms.steps) {
          failures++;
          return;
        }
        // Toestemming in Spotter (AVG); de server controleert het ook.
        const settings = await fetchCached(activitySettingsKey(userId), () => fetchActivitySettings(userId), true, 60_000);
        if (!alive) return;
        if (!settings.available) {
          failures++;
          return;
        }
        if (!settings.consented) {
          // Toestemming ingetrokken (ook op een ander toestel): koppeling hier vergeten.
          disconnectHealth(userId);
          return;
        }
        // Lang niet geopend: alle gemiste dagen meenemen (hooguit 30).
        const days = syncDaysSince(link.lastSyncAt, HEALTH_RESYNC_DAYS);
        // syncHealth ververst daarna zelf de activiteit en ranglijsten in de cache.
        await syncHealth(userId, { days });
        failures = 0;
      } catch {
        // Stil: geen verbinding, rechten ingetrokken of server weigert. Na 15 minuten (later een uur) opnieuw.
        failures++;
      }
    }

    void maybeSync();

    (async () => {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) void maybeSync();
      });
      if (alive) remove = () => void handle.remove();
      else void handle.remove();
    })().catch(() => {});

    return () => {
      alive = false;
      remove?.();
    };
  }, [userId]);

  return null;
}
