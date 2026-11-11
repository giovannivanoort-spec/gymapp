"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, RefreshIcon, TrophyIcon } from "@/components/Icons";
import { fmtNum, isDone, parseReps, parseWeight, type LogRow } from "./logic";

export type SaveResult = "saved" | "queued" | "skipped" | "invalid" | "error";

export const SET_GRID = "grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-center gap-2";
/** Met een kolom "Vorige" (wat je vorige keer bij deze set deed). */
export const SET_GRID_PREV = "grid grid-cols-[1.75rem_3.25rem_minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-center gap-1.5";

type Value = { weight: number | null; reps: number | null };

/**
 * Eén set: gewicht, reps en afvinken. Opslaan gebeurt bij het verlaten van de rij (niet bij
 * het springen van gewicht naar reps), bij afvinken, en als vangnet bij het verlaten van de pagina.
 * Een afgevinkte set opnieuw aantikken zet hem terug op "niet gedaan", maar de getallen blijven staan.
 */
export function SetRow({
  setNumber,
  log,
  hint,
  prev,
  showPrev,
  anchorId,
  exerciseName,
  personName,
  isRecord,
  readOnly,
  timed,
  onSave,
  onDelete,
  onUncomplete,
  onCompleted,
}: {
  setNumber: number;
  log?: LogRow;
  /** Voorinvulling: advies voor deze set, je vorige set of wat je vorige keer deed. */
  hint?: Value;
  /** Wat je vorige keer bij deze set deed (kolom "Vorige"). */
  prev?: Value | null;
  /** Toon de kolom "Vorige" (ook als er voor deze set niets was, voor een rechte tabel). */
  showPrev?: boolean;
  /** Id van de rij, om er vanuit een melding naartoe te springen. */
  anchorId?: string;
  exerciseName: string;
  /** Voor schermlezers in groepsmodus. */
  personName?: string;
  /** Deze set is beter dan alles daarvoor. */
  isRecord?: boolean;
  readOnly?: boolean;
  /** Statische oefening: het tweede veld is seconden in plaats van reps. */
  timed?: boolean;
  onSave: (weight: string, reps: string) => Promise<SaveResult>;
  onDelete: () => void;
  /** Afvinken ongedaan maken (de getallen blijven in de velden staan). Zonder: wissen. */
  onUncomplete?: () => void;
  /**
   * De set is bewust afgevinkt en opgeslagen of offline bewaard. Alleen via het vinkje: niet bij het
   * verlaten van een veld en niet met "Klaar" op het toetsenbord (dat sluit alleen het toetsenbord).
   * `startedAt` (performance.now()) is het moment van afvinken, zodat een trage opslag een latere
   * eigen keuze niet overschrijft.
   */
  onCompleted?: (startedAt: number) => void;
}) {
  const [weight, setWeight] = useState(fmtNum(log?.weight));
  const [reps, setReps] = useState(log?.reps?.toString() ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [pop, setPop] = useState(0);
  // Na "niet gedaan": de getallen in de velden houden als de opgeslagen set verdwijnt.
  const [hold, setHold] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const repsRef = useRef<HTMLInputElement>(null);
  /** Er is iets getypt (of overgenomen) dat nog niet is opgeslagen. */
  const dirty = useRef(false);

  // Bijwerken wanneer de opgeslagen waarde verandert (bijv. de trainer past deze set aan).
  // Per veld, zodat een veld waarin je nog typt niet wordt overschreven.
  const [seen, setSeen] = useState({ weight: log?.weight ?? null, reps: log?.reps ?? null });
  if ((log?.weight ?? null) !== seen.weight || (log?.reps ?? null) !== seen.reps) {
    if (!(hold && !log)) {
      if ((log?.weight ?? null) !== seen.weight) setWeight(fmtNum(log?.weight));
      if ((log?.reps ?? null) !== seen.reps) setReps(log?.reps?.toString() ?? "");
    }
    if (hold) setHold(false);
    setSeen({ weight: log?.weight ?? null, reps: log?.reps ?? null });
  }

  const failed = !!log?.failed;
  const done = isDone(log);
  const pending = !!log?.pending;
  const who = personName ? ` van ${personName}` : "";
  const grid = showPrev ? SET_GRID_PREV : SET_GRID;

  async function commit(w = weight, r = reps): Promise<SaveResult> {
    dirty.current = false;
    // Alleen een laadindicator als het echt even duurt (geen geflikker bij snelle saves).
    const slow = setTimeout(() => setStatus("saving"), 180);
    const res = await onSave(w, r);
    clearTimeout(slow);
    if (res === "invalid" || res === "error") {
      dirty.current = true;
      setStatus("error");
      return res;
    }
    setStatus("idle");
    if (res === "saved" || res === "queued") setPop((p) => p + 1);
    return res;
  }

  // Vangnet: niet-opgeslagen invoer alsnog bewaren als de rij verdwijnt (pagina verlaten, andere persoon).
  const flushOnUnmount = useRef<() => void>(() => {});
  useEffect(() => {
    flushOnUnmount.current = () => {
      if (readOnly || !dirty.current) return;
      const w = parseWeight(weight);
      const r = parseReps(reps);
      if (w !== (log?.weight ?? null) || r !== (log?.reps ?? null)) onSave(weight, reps);
    };
  });
  useEffect(() => () => flushOnUnmount.current(), []);

  function onBlur(e: React.FocusEvent) {
    // Van gewicht naar reps (of naar de afvinkknop) is nog geen moment om op te slaan.
    if (e.relatedTarget && rowRef.current?.contains(e.relatedTarget as Node)) return;
    if (dirty.current) commit();
  }

  /** Snel afvinken: gebruikt de voorinvulling als je niets hebt ingevuld. */
  function complete() {
    const w = weight.trim() ? weight : fmtNum(hint?.weight);
    const r = reps.trim() ? reps : hint?.reps != null ? String(hint.reps) : "";
    if (!r) {
      repsRef.current?.focus();
      return;
    }
    setWeight(w);
    setReps(r);
    commitCompleted(w, r);
  }

  /** Opslaan als bewust afgevinkte set: daarna (opgeslagen of offline bewaard) `onCompleted`. */
  function commitCompleted(w = weight, r = reps) {
    const startedAt = performance.now();
    commit(w, r).then((res) => {
      if (res === "saved" || res === "queued") onCompleted?.(startedAt);
    });
  }

  /** Terug naar "niet gedaan": de getallen blijven staan, zodat opnieuw afvinken genoeg is. */
  function uncomplete() {
    if (!onUncomplete) return onDelete();
    dirty.current = false;
    setHold(true);
    onUncomplete();
  }

  /** Neemt over wat je vorige keer bij deze set deed. */
  function takePrev() {
    if (!prev) return;
    setWeight(fmtNum(prev.weight));
    setReps(prev.reps?.toString() ?? "");
    dirty.current = true;
    if (status === "error") setStatus("idle");
    navigator.vibrate?.(8);
    repsRef.current?.focus();
  }

  const prevText = prev && (prev.reps != null || prev.weight != null) ? prev : null;
  const prevCell = showPrev ? (
    readOnly || !prevText ? (
      <span className="text-center text-[11px] leading-tight tabular-nums text-muted">
        {prevText ? <PrevValue v={prevText} timed={timed} /> : "–"}
      </span>
    ) : (
      <button
        type="button"
        onClick={takePrev}
        className="flex min-h-11 flex-col items-center justify-center rounded-lg text-[11px] leading-tight tabular-nums text-muted transition hover:bg-surface-2 hover:text-ink active:scale-95"
        aria-label={`Vorige keer set ${setNumber}: ${describe(prevText, timed)}. Overnemen`}
      >
        <PrevValue v={prevText} timed={timed} />
      </button>
    )
  ) : null;

  if (readOnly) {
    // Alleen-lezen met een set die nog wacht of mislukte: die kan hier niet meer worden opgeslagen
    // (bijv. geen lid meer van de groep). Niet als afgerond tonen.
    const unsaved = failed || pending;
    const shownDone = done && !unsaved;
    return (
      <div id={anchorId} className={`${grid} min-h-11 rounded-xl ${unsaved ? "bg-danger/5" : shownDone ? "bg-accent/5" : ""}`}>
        <SetNumber n={setNumber} done={shownDone} record={isRecord && !unsaved} />
        {prevCell}
        <span className="text-center tabular-nums">{log?.weight != null ? fmtNum(log.weight) : <span className="text-muted">–</span>}</span>
        <span className="text-center tabular-nums">{log?.reps != null ? log.reps : <span className="text-muted">–</span>}</span>
        <span className="flex justify-center">{shownDone && <CheckIcon size={16} className="text-accent" />}</span>
        {unsaved && (
          <p className="col-span-full -mt-1 pl-9 text-[11px] text-danger" role="status">
            Niet opgeslagen
          </p>
        )}
      </div>
    );
  }

  const label = failed
    ? `Set ${setNumber} ${exerciseName}${who} niet opgeslagen, opnieuw proberen`
    : done
      ? `Set ${setNumber} ${exerciseName}${who} gedaan, tik om terug te zetten`
      : `Set ${setNumber} ${exerciseName}${who} afronden`;

  return (
    <div
      ref={rowRef}
      id={anchorId}
      className={`${grid} scroll-mt-40 rounded-xl transition-colors duration-300 ${failed ? "bg-danger/5" : done ? "bg-accent/5" : ""}`}
    >
      <SetNumber n={setNumber} done={done} record={isRecord} />
      {prevCell}
      <input
        className={`input h-11 py-0 text-center tabular-nums ${failed ? "border-danger/60" : ""}`}
        inputMode="decimal"
        enterKeyHint="next"
        autoComplete="off"
        data-set-input
        value={weight}
        placeholder={hint?.weight != null ? fmtNum(hint.weight) : "–"}
        onChange={(e) => {
          setWeight(e.target.value);
          dirty.current = true;
          if (status === "error") setStatus("idle");
        }}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            repsRef.current?.focus();
          }
        }}
        aria-label={`Gewicht set ${setNumber} ${exerciseName}${who}`}
        aria-invalid={status === "error" || undefined}
      />
      <input
        ref={repsRef}
        className={`input h-11 py-0 text-center tabular-nums ${failed ? "border-danger/60" : ""}`}
        inputMode="numeric"
        enterKeyHint="done"
        autoComplete="off"
        data-set-input
        value={reps}
        placeholder={hint?.reps != null ? String(hint.reps) : "–"}
        onChange={(e) => {
          setReps(e.target.value);
          dirty.current = true;
          if (status === "error") setStatus("idle");
        }}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label={`${timed ? "Seconden" : "Reps"} set ${setNumber} ${exerciseName}${who}`}
        aria-invalid={status === "error" || undefined}
      />
      <button
        type="button"
        onClick={failed ? () => commit() : done ? uncomplete : complete}
        aria-pressed={failed ? undefined : done}
        aria-label={label}
        title={
          failed
            ? "Niet opgeslagen. Tik om het opnieuw te proberen."
            : pending
              ? "Offline bewaard, wordt verstuurd zodra er verbinding is"
              : undefined
        }
        className={`relative flex h-11 w-11 items-center justify-center rounded-xl border transition-colors duration-200 active:scale-90 ${
          status === "error" || failed
            ? "border-danger text-danger"
            : pending
              ? "border-dashed border-accent text-accent"
              : done
                ? "border-accent bg-accent text-accent-ink"
                : "border-line text-muted hover:border-muted hover:text-ink"
        }`}
      >
        {status === "saving" ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
        ) : failed ? (
          <RefreshIcon size={17} strokeWidth={2.4} />
        ) : (
          <span key={pop} className={pop ? "animate-pop" : ""}>
            <CheckIcon size={18} strokeWidth={2.6} />
          </span>
        )}
        {pending && <span className="sr-only">Offline bewaard</span>}
      </button>
      {failed && (
        <p className="col-span-full -mt-1 pl-9 text-[11px] text-danger" role="status">
          Niet opgeslagen. Tik op het pijltje om het opnieuw te proberen.
        </p>
      )}
    </div>
  );
}

function describe(v: Value, timed?: boolean) {
  const w = v.weight != null && Number(v.weight) !== 0 ? `${fmtNum(v.weight)} kilo` : "";
  const r = v.reps != null ? `${v.reps} ${timed ? "seconden" : "reps"}` : "";
  return [w, r].filter(Boolean).join(" bij ") || "niets";
}

function PrevValue({ v, timed }: { v: Value; timed?: boolean }) {
  const w = v.weight != null && Number(v.weight) !== 0 ? fmtNum(v.weight) : null;
  return (
    <>
      <span className="block">{w ?? (v.reps != null ? v.reps : "–")}</span>
      <span className="block text-muted/80">{w ? (v.reps != null ? `× ${v.reps}${timed ? " s" : ""}` : "") : timed ? "s" : "reps"}</span>
    </>
  );
}

function SetNumber({ n, done, record }: { n: number; done: boolean; record?: boolean }) {
  if (record && done) {
    return (
      <span className="flex justify-center text-accent" title="Persoonlijk record">
        <TrophyIcon size={16} />
        <span className="sr-only">Set {n}, persoonlijk record</span>
      </span>
    );
  }
  return <span className={`text-center text-sm font-bold tabular-nums ${done ? "text-accent" : "text-muted"}`}>{n}</span>;
}
