"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "@/components/ui/Toast";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { setTakesPart, setTurnsPref, useTurnsPref, useTurnsSkip } from "@/lib/turns";
import type { WorkoutExercise } from "@/lib/types";
import { firstOpenIn, hasOpenSet, nextWithOpenSet, type JustDone, type LogRow } from "./logic";
import { setAnchorId } from "./PersonSets";

/** Pauze na het afvinken, zodat het vinkje zichtbaar blijft voordat er wordt gewisseld. */
const TURN_DELAY_MS = 350;
/** Een oefening telt als "in beeld" zodra de onderkant onder de vaste kop en de personenbalk ligt. */
const IN_VIEW_OFFSET = 150;

/** De oefening die nu bovenaan in beeld is. */
export function cardInView(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>("[data-exercise-card]")) {
    if (el.getBoundingClientRect().bottom > IN_VIEW_OFFSET) return el;
  }
  return null;
}

/**
 * Id van de oefening die nu bovenaan in beeld is, voor het label van de knop "Volgende". Geen
 * scroll-luisteraar: een IntersectionObserver meldt zich alleen als een kaart de lijn onder de vaste
 * balk passeert, precies wanneer een andere oefening bovenaan kan komen. `watch`: opnieuw koppelen
 * als de oefeningen veranderen.
 */
export function useCardInView(enabled: boolean, watch: string): string | null {
  const [card, setCard] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(() => setCard(cardInView()?.id ?? null), {
      rootMargin: `-${IN_VIEW_OFFSET}px 0px 0px 0px`,
    });
    for (const el of document.querySelectorAll("[data-exercise-card]")) io.observe(el);
    return () => io.disconnect();
  }, [enabled, watch]);
  return enabled ? card : null;
}

type FocusSet = (we: WorkoutExercise, uid: string, n: number, opts?: { focus?: boolean }) => void;

export type TurnsParams = {
  workoutId: string;
  /** Een trainer met meer dan één lid: alleen dan kan er om de beurt worden gewisseld. */
  available: boolean;
  showGroup: boolean;
  /** Persoon die nu in beeld is (niet in de groepsmodus). */
  forUser: string;
  userId: string;
  /** Alle leden in de volgorde van de groep. */
  members: string[];
  /** Mag je voor deze persoon sets invullen? Anders nooit aan de beurt. */
  canEdit: (uid: string) => boolean;
  /** Altijd de nieuwste sets (ook van net opgeslagen of offline bewaarde sets). */
  logsRef: RefObject<LogRow[] | undefined>;
  /** Oefeningen van deze training (een wissel voor een verwijderde oefening vervalt). */
  wexSet: Set<string>;
  nameOf: (uid: string) => string;
  focusSet: FocusSet;
};

/**
 * Om de beurt trainen: na een bewust afgevinkte set (na een korte pauze) door naar de volgende
 * persoon, in de volgorde van de groep, die bij deze oefening nog een open set heeft. Alleen wie
 * vandaag meedoet (instelbaar per training) en wie je mag invullen. In de groepsmodus wordt niet
 * gewisseld, alleen naar diens set gescrold. Iedereen klaar: één melding per oefening.
 */
export function useTurns(p: TurnsParams) {
  const pref = useTurnsPref(p.userId);
  const skip = useTurnsSkip(p.userId, p.workoutId);
  const on = p.available && pref;
  const takesPart = (uid: string) => !skip.includes(uid);

  /** Wissel die na het afvinken nog moet gebeuren. */
  const timer = useRef<number | undefined>(undefined);
  /**
   * Moment (performance.now()) van de laatste eigen keuze of verwerkte afvinkactie. Een afvinkactie
   * die daarvóór begon (bijv. een opslag die op trage wifi pas veel later klaar is) wisselt niet meer.
   */
  const mark = useRef(0);
  /** Oefeningen waarvoor "Iedereen klaar" al is gemeld. */
  const finished = useRef(new Set<string>());
  /** Voor schermlezers: wie er na een automatische wissel aan de beurt is. */
  const [note, setNote] = useState("");
  const noteFrame = useRef(0);

  /** Personen die mee kunnen draaien na `after` (die zelf telt altijd mee als beginpunt). */
  function pool(after: string, s: readonly string[] = skip, ps: TurnsParams = p): string[] {
    return ps.members.filter((u) => u === after || (ps.canEdit(u) && !s.includes(u)));
  }

  /** Volgende persoon met een open set bij deze oefening (of null als niemand anders nog sets heeft). */
  function pickNext(we: WorkoutExercise, after: string, logs: LogRow[], justDone?: JustDone, s: readonly string[] = skip, ps: TurnsParams = p) {
    if (we.target_sets < 1) return null;
    return nextWithOpenSet(we, after, pool(after, s, ps), logs, justDone);
  }

  /**
   * Voor de knop "Volgende": wie bij deze oefening nog een open set heeft, anders gewoon de
   * volgende in de rij (met om de beurt aan: de volgende die vandaag meedoet).
   */
  function nextFor(we: WorkoutExercise | undefined, after: string, logs: LogRow[]): string {
    const open = we ? (on ? pickNext(we, after, logs) : nextWithOpenSet(we, after, p.members.filter(p.canEdit), logs)) : null;
    if (open) return open;
    const all = p.members;
    const start = all.indexOf(after);
    for (let i = 1; i <= all.length; i++) {
      const uid = all[(start + i) % all.length];
      if (uid !== after && (!on || takesPart(uid))) return uid;
    }
    return all[(start + 1) % all.length] ?? after;
  }

  /** Melden voor schermlezers; eerst leegmaken, zodat dezelfde tekst ook een tweede keer wordt voorgelezen. */
  function announce(text: string) {
    window.cancelAnimationFrame(noteFrame.current);
    setNote("");
    noteFrame.current = window.requestAnimationFrame(() => setNote(text));
  }

  /** Wissel uitvoeren, met de stand van dat moment (de pauze is dan voorbij). */
  function step(we: WorkoutExercise, uid: string, n: number) {
    const ps = latest.current.params;
    const s = latest.current.skip;
    if (!latest.current.on || we.target_sets < 1 || !ps.wexSet.has(we.id)) return;
    // Niet meer bij de persoon die afvinkte: de trainer niet wegtrekken.
    if (!ps.showGroup && ps.forUser !== uid) return;
    // Al in een andere set aan het typen: niet wegtrekken. Het veld van de net afgevinkte set
    // (sommige browsers houden daar na het vinkje de focus) telt niet: die set is opgeslagen.
    const active = document.activeElement;
    const typing = active instanceof HTMLElement && active.matches("input[data-set-input]") ? active : null;
    if (typing && !document.getElementById(setAnchorId(we.id, uid, n))?.contains(typing)) return;
    const logs = ps.logsRef.current ?? [];
    // De zojuist afgevinkte set telt als gedaan, ook als de lijst hem nog niet bevat.
    const justDone = { uid, n };
    const next = pickNext(we, uid, logs, justDone, s, ps);
    const exerciseName = EXERCISE_BY_SLUG[we.exercise_slug]?.name ?? we.exercise_slug;
    if (next) {
      finished.current.delete(we.id);
      // Na een trage opslag al naar een andere oefening gescrold: niet terugtrekken.
      const card = document.getElementById(`exercise-${we.id}`)?.getBoundingClientRect();
      if (!card || card.bottom <= IN_VIEW_OFFSET || card.top >= window.innerHeight) return;
      const set = firstOpenIn(we, next, logs, justDone);
      // Toetsenbord dicht: de volgende persoon is aan de beurt, niet het veld van de vorige.
      typing?.blur();
      ps.focusSet(we, next, set, { focus: false });
      announce(`Nu aan de beurt: ${next === ps.userId ? "jij" : ps.nameOf(next)}, set ${set} van ${exerciseName}`);
      return;
    }
    // Alleen deze persoon heeft nog sets open: blijven staan.
    if (hasOpenSet(we, uid, logs, justDone) || finished.current.has(we.id)) return;
    finished.current.add(we.id);
    // Wie vandaag is overgeslagen maar nog sets open heeft: dan is niet letterlijk iedereen klaar.
    const skippedOpen = ps.members.some((u) => u !== uid && ps.canEdit(u) && hasOpenSet(we, u, logs, justDone));
    toast(skippedOpen ? `Iedereen die meedoet is klaar met ${exerciseName}` : `Iedereen klaar met ${exerciseName}`);
  }

  const latest = useRef({ params: p, skip, on, step });
  useEffect(() => {
    latest.current = { params: p, skip, on, step };
  });

  // Andere training (zonder de pagina te verlaten) of weg van de pagina: niets van hiervoor mag nog wisselen.
  useEffect(() => {
    const t = timer;
    const frame = noteFrame;
    const m = mark;
    const done = finished;
    m.current = performance.now();
    return () => {
      window.clearTimeout(t.current);
      t.current = undefined;
      window.cancelAnimationFrame(frame.current);
      m.current = Number.POSITIVE_INFINITY;
      done.current.clear();
    };
  }, [p.workoutId]);

  /** Zelf gekozen (persoon gewisseld, set teruggezet, om de beurt uit): een geplande of nog lopende wissel vervalt. */
  function cancel() {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    mark.current = performance.now();
  }

  /** Set bewust afgevinkt: na een korte pauze (het vinkje blijft zichtbaar) door naar de volgende persoon. */
  function onCompleted(we: WorkoutExercise, uid: string, n: number, startedAt: number) {
    // Intussen zelf iets gekozen, of al een nieuwere set afgevinkt: deze (trage) opslag wisselt niet meer.
    if (!latest.current.on || startedAt < mark.current) return;
    // Iemand die was overgeslagen, traint toch mee: weer meenemen.
    if (latest.current.skip.includes(uid)) setTakesPart(latest.current.params.userId, latest.current.params.workoutId, uid, true);
    // Snel nog een set afgevinkt: die vervangt de geplande wissel, opnieuw bepalen wie er aan de beurt is.
    window.clearTimeout(timer.current);
    mark.current = startedAt;
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      latest.current.step(we, uid, n);
    }, TURN_DELAY_MS);
  }

  return {
    /** Staat om de beurt aan (en kan het hier)? */
    on,
    takesPart,
    setOn(next: boolean) {
      if (!next) cancel();
      setTurnsPref(p.userId, next);
    },
    setTakesPart: (uid: string, part: boolean) => setTakesPart(p.userId, p.workoutId, uid, part),
    /** Alleen doorgeven als om de beurt aanstaat, anders blijft alles zoals het was. */
    onCompleted: on ? onCompleted : undefined,
    cancel,
    /** Een set van deze oefening is teruggezet of gewist: "Iedereen klaar" mag opnieuw worden gemeld. */
    reopen: (weId: string) => {
      finished.current.delete(weId);
    },
    /** Tekst voor een aria-live gebied. */
    note: on ? note : "",
    nextFor,
  };
}
