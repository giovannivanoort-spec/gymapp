"use client";

/**
 * Widget op het startscherm van de Android-app (android/app/src/main/java/nl/myspotter/app/widget/).
 * De widget haalt zelf niets op: de site in de app stuurt een momentopname naar de lokale plugin
 * "SpotterWidget", die hem bewaart en alle widgets opnieuw tekent. Zie docs/android-app.md.
 *
 * ── Publieke API ────────────────────────────────────────────────────────────────────────────────
 * - WidgetSnapshot: wat de widget toont (versie 1; het Java-deel leest precies deze velden).
 * - buildWidgetSnapshot(input) → WidgetSnapshot (puur, los te testen).
 * - widgetSupported() → kan deze app een widget bijwerken (Android-APK met de plugin; false op het web
 *   en in oudere APK's).
 * - updateWidget(snapshot) → aantal geplaatste widgets, of null als het niet kan. Gooit nooit.
 * - clearWidget() → vergeet de momentopname (na uitloggen). Gooit nooit.
 * - isWidgetUrl(url): tik op de widget opent de app met deze URL (koude start: App.getLaunchUrl()).
 *
 * Doet niets op het web: @capacitor/core wordt alleen in de app dynamisch geladen.
 */

import { effectiveSteps, DEFAULT_STEP_GOAL, type ActivitySettingsState, type DailyActivity } from "@/lib/activity";
import { latestNight, type DailySleep } from "@/lib/sleep";
import { isNativeApp, nativePlatform } from "./health";

// ─────────────── Momentopname ───────────────

export type WidgetTraining = {
  /** YYYY-MM-DD. */
  date: string;
  title: string;
  /** Naam van de groep, of null. */
  group: string | null;
};

/** Versie 1. Bij een wijziging ook Snapshot.parse in SpotterWidgetProvider.java aanpassen. */
export type WidgetSnapshot = {
  v: 1;
  /** Wanneer de getoonde gegevens van de server kwamen (ms). "Bijgewerkt hh:mm" op de widget. */
  updatedAt: number;
  /** Lokale datum waar `steps` bij hoort (YYYY-MM-DD). Na middernacht toont de widget "–". */
  date: string;
  /** Stappen van vandaag, null = geen data of geen toestemming. */
  steps: number | null;
  stepGoal: number;
  /** De meest recente nacht (wakkerworddatum vandaag of gisteren), of null. */
  sleep: { date: string; minutes: number } | null;
  /** De eerstvolgende trainingen vanaf vandaag (hooguit 3), oplopend. */
  trainings: WidgetTraining[];
};

export type WidgetSnapshotInput = {
  /** Vandaag, YYYY-MM-DD (lokale tijd). */
  today: string;
  /** Activiteitsinstellingen (toestemming en stappendoel); undefined = onbekend. */
  settings: ActivitySettingsState | undefined;
  activity: DailyActivity[] | undefined;
  sleep: DailySleep[] | undefined;
  workouts: { date: string; title: string; groups?: { name: string } | null }[] | undefined;
  updatedAt: number;
};

/**
 * Bouwt de momentopname. Zonder toestemming voor activiteit (AVG) gaan er geen stappen en geen slaap
 * mee, ook niet als er nog iets in de cache staat.
 */
export function buildWidgetSnapshot({ today, settings, activity, sleep, workouts, updatedAt }: WidgetSnapshotInput): WidgetSnapshot {
  const consented = !!settings?.available && !!settings.consented;
  const day = consented ? (activity?.find((d) => d.date === today) ?? null) : null;
  const steps = effectiveSteps(day);
  // Slaap alleen met toestemming voor de tekst die slaap noemt (niet bij needsReconsent).
  const night = consented && !settings?.needsReconsent ? latestNight(sleep, today) : null;
  const goal = settings?.step_goal && settings.step_goal > 0 ? Math.round(settings.step_goal) : DEFAULT_STEP_GOAL;
  return {
    v: 1,
    updatedAt: Math.round(updatedAt),
    date: today,
    steps: steps == null ? null : Math.max(0, Math.round(steps)),
    stepGoal: goal,
    sleep: night && night.asleep_minutes > 0 ? { date: night.date, minutes: Math.round(night.asleep_minutes) } : null,
    trainings: (workouts ?? [])
      .filter((w) => w.date >= today && !!w.title?.trim())
      .slice(0, 3)
      .map((w) => ({ date: w.date, title: w.title.trim().slice(0, 80), group: w.groups?.name?.slice(0, 60) ?? null })),
  };
}

// ─────────────── Plugin ───────────────

type SpotterWidgetPlugin = {
  update(options: { json: string }): Promise<{ widgets: number }>;
  clear(): Promise<{ widgets: number }>;
};

type CapacitorGlobal = { isPluginAvailable?: (name: string) => boolean };

/** Alleen in een APK met de plugin (vanaf versionCode 2); oudere APK's hebben hem niet. */
function pluginAvailable(): boolean {
  if (!isNativeApp() || nativePlatform() !== "android") return false;
  try {
    return !!(window as Window & { Capacitor?: CapacitorGlobal }).Capacitor?.isPluginAvailable?.("SpotterWidget");
  } catch {
    return false;
  }
}

/** Eén keer geregistreerd (Capacitor waarschuwt bij een tweede registerPlugin met dezelfde naam). */
let registered: { SpotterWidget: SpotterWidgetPlugin } | null = null;

/**
 * Laadt de plugin, ingepakt als { SpotterWidget }. Nooit de plugin zelf teruggeven uit een async
 * functie: een Capacitor-plugin is een Proxy die ook voor `then` een native methode maakt, en `await`
 * blijft dan eeuwig hangen (zie healthPlugin in ./health.ts).
 */
async function widgetPlugin(): Promise<{ SpotterWidget: SpotterWidgetPlugin } | null> {
  if (!pluginAvailable()) return null;
  if (registered) return registered;
  const { registerPlugin } = await import("@capacitor/core");
  registered ??= { SpotterWidget: registerPlugin<SpotterWidgetPlugin>("SpotterWidget") };
  return registered;
}

/** Kan deze app de widget bijwerken? */
export function widgetSupported(): boolean {
  return pluginAvailable();
}

/** Stuurt de momentopname naar de widget. Geeft het aantal geplaatste widgets, of null als het niet kan. */
export async function updateWidget(snapshot: WidgetSnapshot): Promise<number | null> {
  try {
    const p = await widgetPlugin();
    if (!p) return null;
    const r = await p.SpotterWidget.update({ json: JSON.stringify(snapshot) });
    return typeof r?.widgets === "number" ? r.widgets : 0;
  } catch {
    return null;
  }
}

/** Vergeet de momentopname: de widget toont weer "Open Spotter om te synchroniseren". */
export async function clearWidget(): Promise<void> {
  try {
    const p = await widgetPlugin();
    if (p) await p.SpotterWidget.clear();
  } catch {
    // Stil: een oudere APK of geen widget.
  }
}

// ─────────────── Tik op de widget ───────────────

/** De widget opent de app met deze URL (SpotterWidgetProvider.OPEN_URL). */
export const WIDGET_URL = "nl.myspotter.app://widget";

export function isWidgetUrl(url: string | null | undefined): boolean {
  return !!url && url.replace(/\/+$/, "") === WIDGET_URL;
}
