"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { fetchUpcoming } from "@/components/home/data";
import { useClock } from "@/components/home/live";
import { useActivitySettings, useRecentActivity } from "@/lib/activity";
import { useCachedState } from "@/lib/cache";
import { useHealthLink } from "@/lib/native/health";
import { buildWidgetSnapshot, clearWidget, isWidgetUrl, updateWidget } from "@/lib/native/widget";
import { useLatestSleep } from "@/lib/sleep";
import { supabase } from "@/lib/supabase";

/** Na een wijziging even wachten: na een sync komen activiteit en slaap vlak na elkaar binnen. */
const PUSH_DEBOUNCE_MS = 800;
/** Zelfde inhoud: pas na zoveel tijd opnieuw sturen (alleen om "Bijgewerkt" bij te werken). */
const SAME_CONTENT_MIN_MS = 5 * 60_000;

/**
 * Houdt de widget op het startscherm bij (alleen in de Android-app met de plugin; NativeHealthSync
 * monteert dit). Leest dezelfde cache als Home (stappen van de laatste 7 dagen, slaap, komende
 * trainingen, instellingen) en stuurt bij elke wijziging een momentopname naar de widget. Omdat de
 * cache bij elke Health Connect-sync, handmatige invoer en terugkeer naar de app ververst, volgt de
 * widget vanzelf.
 *
 * "Bijgewerkt" op de widget gaat over de gezondheidsgegevens zelf: met Health Connect gekoppeld de laatste
 * geslaagde sync (lastSyncAt), anders wanneer stappen en slaap het laatst van de server kwamen. Zo blijft
 * de tijd staan als de sync al dagen mislukt, ook al ververst de cache van instellingen en trainingen wel.
 *
 * Uitloggen wist de widget. Een tik op de widget opent de app: bij een koude start op Home; draaide de app
 * al, dan blijft hij op de pagina waar je was (bijv. midden in een training).
 */
export function NativeWidgetSync({ userId }: { userId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { today } = useClock();
  const link = useHealthLink(userId);
  const settings = useActivitySettings(userId);
  const activity = useRecentActivity(userId, 7);
  const sleep = useLatestSleep(userId);
  // Zelfde sleutel en fetcher als Home (app/page.tsx), zodat ze één kopie delen.
  const workouts = useCachedState(`home:workouts:${userId}`, () => fetchUpcoming(today), { persist: true, maxAge: 5 * 60_000 });

  const pushed = useRef<{ content: string; at: number; updatedAt: number } | null>(null);
  const signedOut = useRef(false);

  const states = [settings, activity, sleep, workouts];
  // Pas sturen als elke bron iets weet (data of een fout): anders even "–" voor wat nog laadt.
  const ready = states.every((s) => s.data !== undefined || !!s.error);
  // Versheid van stappen en slaap zelf (zie boven); zonder toestemming voor activiteit: van de trainingen.
  const syncedAt = link.connected && link.lastSyncAt ? Date.parse(link.lastSyncAt) : NaN;
  const healthAt = Number.isFinite(syncedAt) ? syncedAt : Math.max(0, activity.updatedAt ?? 0, sleep.updatedAt ?? 0);
  const updatedAt = settings.data?.consented ? healthAt : Math.max(0, ...states.map((s) => s.updatedAt ?? 0));

  useEffect(() => {
    if (!ready || signedOut.current) return;
    const snapshot = buildWidgetSnapshot({
      today,
      settings: settings.data,
      activity: activity.data,
      sleep: sleep.data,
      workouts: workouts.data,
      updatedAt: updatedAt || Date.now(),
    });
    const content = JSON.stringify({ ...snapshot, updatedAt: 0 });
    const prev = pushed.current;
    if (prev && prev.content === content && (prev.updatedAt === snapshot.updatedAt || Date.now() - prev.at < SAME_CONTENT_MIN_MS)) return;
    const t = setTimeout(() => {
      if (signedOut.current) return;
      pushed.current = { content, at: Date.now(), updatedAt: snapshot.updatedAt };
      void updateWidget(snapshot);
    }, PUSH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [ready, today, settings.data, activity.data, sleep.data, workouts.data, updatedAt]);

  // Uitloggen: geen gegevens van deze gebruiker op het startscherm laten staan.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      signedOut.current = true;
      pushed.current = null;
      void clearWidget();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Tik op de widget bij een koude start: naar Home. Draaide de app al (MainActivity is singleTask, dus
  // appUrlOpen via onNewIntent), dan komt hij alleen naar voren en blijft de pagina staan: wie midden in
  // een training even naar de widget kijkt, raakt die niet kwijt. Eén keer bij het monteren.
  const coldStartChecked = useRef(false);
  useEffect(() => {
    if (coldStartChecked.current) return;
    coldStartChecked.current = true;
    (async () => {
      const { App } = await import("@capacitor/app");
      const launch = await App.getLaunchUrl();
      if (isWidgetUrl(launch?.url) && pathname !== "/") router.push("/");
    })().catch(() => {});
  }, [router, pathname]);

  return null;
}
