"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { refreshTrainingData } from "@/components/groups/groupData";
import { isRecentOwnSave, planContent } from "@/components/groups/saveGroupWorkout";
import { toast } from "@/components/ui/Toast";
import { getCached, invalidate } from "@/lib/cache";
import { dropForWex, dropGoneWex, goneWex } from "@/lib/offlineQueue";
import { liveTopic } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import type { WorkoutExercise } from "@/lib/types";
import { workoutKey } from "./data";
import type { WorkoutBundle } from "./logic";

/** Een trainer past vaak meerdere dingen kort na elkaar aan: één verversing en één melding. */
const DEBOUNCE_MS = 800;
/** Zo lang na een live signaal of verversing geeft een gevonden planwijziging een melding. */
const NOTICE_WINDOW_MS = 15_000;
/** Meldingen over hetzelfde plan binnen deze tijd worden samengevoegd tot één melding. */
const MERGE_MS = 6_000;
/** Een melding over niet bewaarde sets blijft langer staan: die moet je kunnen lezen tussen twee sets. */
const LOST_TOAST_MS = 6_000;

function ordered(b: WorkoutBundle | null | undefined): WorkoutExercise[] | null {
  const list = b?.workout?.workout_exercises;
  return list ? [...list].sort((a, c) => a.position - c.position) : null;
}

/**
 * Volgorde, oefening en doel (sets x herhalingen) per oefening, om een planwijziging te herkennen.
 * Titel, datum en notities tellen niet mee (die verversen stil). `null` = geen plan bekend.
 */
function planSignature(b: WorkoutBundle | null | undefined): string | null {
  const list = ordered(b);
  return list ? list.map((e) => `${e.id}:${e.exercise_slug}:${e.target_sets}:${e.target_reps}`).join("|") : null;
}

function noticeText(plan: boolean, lost: number): string {
  if (!lost) return "De trainer heeft de training aangepast";
  const sets = `${lost} ${lost === 1 ? "set" : "sets"}`;
  return plan
    ? `De trainer heeft de training aangepast. ${sets} van een weggehaalde oefening ${lost === 1 ? "is" : "zijn"} niet bewaard.`
    : `${sets} niet bewaard: de oefening staat niet meer in het plan`;
}

export type DeletedWorkout = {
  /**
   * `true`: de verwijdering kwam live binnen. `false`: de training was er bij het verversen niet
   * meer (verwijderd terwijl je offline of weg was, of je hebt er geen toegang meer toe).
   */
  certain: boolean;
  /** Op dit toestel zelf verwijderd (bijv. in een ander tabblad op het planscherm). */
  byMe: boolean;
  /** Deze kijker kon sets loggen (lid van de groep), dus er kan onopgeslagen invoer verloren zijn. */
  couldLog: boolean;
};

type Options = {
  id: string;
  bundle: WorkoutBundle | null | undefined;
  /** De oefeningen (workout_exercise-ids) van `bundle`. */
  wexSet: ReadonlySet<string>;
  canLog: boolean;
  /** Het plan opnieuw ophalen via useLoad (zodat de foutstatus van de pagina klopt). */
  retry: () => Promise<WorkoutBundle | null | undefined>;
  /** Extra opruimwerk van de pagina zodra de training is verwijderd. */
  onDeleted?: () => void;
};

/**
 * Houdt de trainingspagina live bij met het plan van de trainer: aanpassingen (oefeningen erbij of
 * eraf, ander doel) komen binnen met een rustige melding, en een verwijderde training wordt gemeld.
 *
 * Het signaal is de rij in `workouts`: opslaan van het plan werkt die altijd bij (ook als alleen de
 * oefeningen veranderen), en verwijderen geeft een DELETE. Wat er daarna verandert, wordt bepaald
 * aan de hand van het plan zelf, hoe het nieuwe plan ook binnenkomt (live, terug in de app, weer
 * online). Zo wordt ook een gemiste verwijdering herkend: een plan dat er was en bij het verversen
 * niet meer bestaat.
 *
 * Een eigen kanaal, los van het sets-kanaal van de pagina: dat verbindt opnieuw zodra de oefeningen
 * veranderen (ander filter) en bestaat niet zolang er nog niets gepland is. Dit kanaal blijft dus
 * verbonden terwijl het plan verandert, en vangt ook de eerste oefeningen van een lege training.
 *
 * Wachtende of mislukte sets worden alleen weggehaald als vaststaat dat hun oefening weg is: na een
 * live verwijdering, of nadat de server bevestigt dat de oefening er niet meer is (dropGoneWex).
 * Een afwijkend plan in de cache of een leeg antwoord is daarvoor nooit genoeg.
 */
export function useLivePlan({ id, bundle, wexSet, canLog, retry, onDeleted }: Options) {
  const [deleted, setDeleted] = useState<(DeletedWorkout & { id: string }) | null>(null);
  /** Zelfde als `deleted`, maar direct bij te lezen door oudere versies van de opslagfunctie. */
  const deletedFor = useRef<string | null>(null);
  const noticeUntil = useRef(0);
  /** De laatst getoonde melding over het plan: een volgende vult hem aan of vervangt hem, nooit twee. */
  const notice = useRef<{ id: string; toastId: number; plan: boolean; lost: number; at: number } | null>(null);
  /** Het plan dat deze pagina het laatst toonde. */
  const seen = useRef<{ id: string; sig: string; ids: ReadonlySet<string> } | null>(null);
  /** Groep en rechten bij het laatst bekende plan (nodig als het plan er niet meer is). */
  const known = useRef<{ id: string; groupId: string; canLog: boolean } | null>(null);
  const groupId = bundle?.workout.group_id ?? null;
  useEffect(() => {
    if (groupId) known.current = { id, groupId, canLog };
  }, [id, groupId, canLog]);

  /**
   * Eén rustige melding over het plan. Wat kort na elkaar binnenkomt (de planwijziging, en sets die
   * daardoor niet bewaard konden worden) komt samen in één tekst. Niet bewaarde sets als
   * waarschuwing en langer in beeld.
   */
  function showNotice(part: { plan?: boolean; lost?: number }) {
    if (deletedFor.current === id) return;
    const now = Date.now();
    const prev = notice.current && notice.current.id === id && now - notice.current.at < MERGE_MS ? notice.current : null;
    const plan = !!part.plan || !!prev?.plan;
    const lost = (part.lost ?? 0) + (prev?.lost ?? 0);
    if (!plan && !lost) return;
    if (notice.current) toast.dismiss(notice.current.toastId);
    const message = noticeText(plan, lost);
    const toastId = lost ? toast.warn(message, { duration: LOST_TOAST_MS }) : toast(message);
    notice.current = { id, toastId, plan, lost, at: now };
  }

  /**
   * Het plan opnieuw ophalen. `live`: na een signaal kan een verzoek dat al liep van vóór de
   * wijziging zijn, dus zacht ongeldig maken (de training blijft zichtbaar en dat verzoek schrijft
   * niets weg). Anders een lopend verzoek gewoon delen. Geeft het plan (`null` = weg of geen
   * toegang), of undefined als ophalen mislukte.
   */
  function refreshPlan(live: boolean): Promise<WorkoutBundle | null | undefined> {
    if (deletedFor.current === id) return Promise.resolve(undefined);
    noticeUntil.current = Date.now() + NOTICE_WINDOW_MS;
    if (live) invalidate(workoutKey(id), { soft: true });
    return retry();
  }

  /**
   * Hoort deze oefening nog bij de training? Gekeken in de cache, niet in een weergave: een rij die
   * verdwijnt na een planwijziging, roept nog een oudere versie van de opslagfunctie aan. Zonder
   * bekend plan: proberen (mislukt het, dan bevestigt `confirmGone` het).
   */
  function inCurrentPlan(wexId: string): boolean {
    if (deletedFor.current === id) return false;
    const fresh = getCached<WorkoutBundle | null>(workoutKey(id));
    return fresh ? fresh.workout.workout_exercises.some((e) => e.id === wexId) : true;
  }

  /**
   * Na een opslag die definitief mislukte: is de oefening intussen weggehaald (of de training
   * verwijderd)? De server beslist (bij twijfel: nee). Haalt ook het plan opnieuw op, zodat de
   * andere rijen bijwerken.
   */
  async function confirmGone(wexId: string): Promise<boolean> {
    if (deletedFor.current === id) return true;
    void refreshPlan(true);
    return (await goneWex([wexId])).has(wexId);
  }

  // ─── Planwijziging herkennen (één keer per wijziging) ───
  const sig = planSignature(bundle);
  const onSignature = useEffectEvent((next: string) => {
    const prev = seen.current;
    seen.current = { id, sig: next, ids: wexSet };
    if (!prev || prev.id !== id || prev.sig === next) return;
    // Bij het openen (oud plan uit de cache, daarna het nieuwe) stil bijwerken.
    const live = Date.now() <= noticeUntil.current;
    noticeUntil.current = 0;
    // Niet melden aan wie dit plan zelf opsloeg (een ander plan kort daarna, van een tweede trainer, wel).
    const plan = planContent((ordered(bundle) ?? []).map((e) => ({ slug: e.exercise_slug, sets: e.target_sets, reps: e.target_reps })));
    if (live && !isRecentOwnSave(id, { kind: "save", plan })) showNotice({ plan: true });
    // Wat nog wachtte of mislukte voor oefeningen die uit het plan lijken te zijn: alleen weghalen
    // als de server bevestigt dat ze weg zijn (een oud plan uit een ander tabblad telt niet).
    const removed = [...prev.ids].filter((x) => !wexSet.has(x));
    if (removed.length) {
      void dropGoneWex(removed).then((lost) => {
        if (lost) showNotice({ lost });
      });
    }
  });
  useEffect(() => {
    if (sig !== null) onSignature(sig);
  }, [sig]);

  // ─── Verwijderd ───
  const markDeleted = useEffectEvent((certain: boolean) => {
    if (deletedFor.current === id) return;
    const ctx = known.current?.id === id ? known.current : null;
    deletedFor.current = id;
    setDeleted({ id, certain, byMe: isRecentOwnSave(id, { kind: "delete" }), couldLog: ctx?.canLog ?? canLog });
    noticeUntil.current = 0;
    if (notice.current) toast.dismiss(notice.current.toastId);
    notice.current = null;
    // Het laatst getoonde plan: na een gemiste verwijdering is `wexSet` al leeg.
    const ids = new Set(wexSet);
    if (seen.current?.id === id) for (const x of seen.current.ids) ids.add(x);
    // Live verwijderd: die sets kunnen nergens meer heen. Alleen afgeleid (geen plan meer bij het
    // verversen, wat ook kan door een tijdelijk probleem met de sessie): eerst de server vragen.
    if (certain) dropForWex(ids);
    else void dropGoneWex(ids);
    onDeleted?.();
    // Home, de groep, vandaag en de geschiedenis tonen hem niet meer (ook deze pagina zelf).
    if (ctx) refreshTrainingData(ctx.groupId);
    else invalidate(workoutKey(id));
    invalidate("home:workouts:");
    invalidate("shell:today:");
  });

  // Een gemiste verwijdering (offline, app op de achtergrond): realtime speelt die niet opnieuw af,
  // maar het verversen geeft dan geen plan meer terwijl deze pagina er net nog een toonde. Vóór het
  // tekenen, zodat niet eerst "Training niet gevonden" in beeld flitst.
  const planGone = bundle === null;
  const onPlanGone = useEffectEvent(() => {
    if (seen.current?.id === id) markDeleted(false);
  });
  useLayoutEffect(() => {
    if (planGone) onPlanGone();
  }, [planGone]);

  // ─── Live signaal ───
  const onPlanChanged = useEffectEvent(() => void refreshPlan(true));
  const onReconnect = useEffectEvent(() => void refreshPlan(false));
  const hasWorkout = !!bundle;
  useEffect(() => {
    if (!hasWorkout) return;
    let timer: number | undefined;
    let joined = false;
    const channel = supabase
      .channel(liveTopic(`workout-plan-${id}`))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "workouts", filter: `id=eq.${id}` }, () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => onPlanChanged(), DEBOUNCE_MS);
      })
      // Verwijderingen zijn onder RLS niet te filteren (alleen het id komt mee): zelf op het id letten.
      // Kost: elke verwijderde training in de hele database komt (als kaal id) bij elke open
      // trainingspagina binnen. Bij deze paar gebruikers verwaarloosbaar; het is alleen de snelle weg,
      // want een gemiste verwijdering wordt hierboven ook herkend aan het verdwenen plan.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "workouts" }, (p) => {
        if ((p.old as { id?: string } | null)?.id !== id) return;
        window.clearTimeout(timer);
        markDeleted(true);
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        // Na een herverbinding kan een signaal gemist zijn.
        if (joined) onReconnect();
        joined = true;
      });
    return () => {
      window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [id, hasWorkout]);

  return {
    deleted: deleted?.id === id ? (deleted as DeletedWorkout) : null,
    refreshPlan,
    inCurrentPlan,
    confirmGone,
    /**
     * Invoer die niet bewaard kon worden omdat de oefening uit het plan is (de rij verdween, of de
     * opslag kwam te laat). Komt in dezelfde melding als de planwijziging.
     */
    reportLost: (n = 1) => showNotice({ lost: n }),
  };
}
