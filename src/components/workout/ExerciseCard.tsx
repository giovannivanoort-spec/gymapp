"use client";

import Link from "next/link";
import { useState } from "react";
import { ChatIcon, CheckIcon, ChevronRightIcon, CloseIcon, DumbbellIcon, PlayIcon } from "@/components/Icons";
import { MuscleChips } from "@/components/MuscleChips";
import { PlateCalculator } from "@/components/PlateCalculator";
import { DEFAULT_VIDEOS } from "@/lib/exercise-videos";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import type { WorkoutExercise } from "@/lib/types";
import { CommentThread } from "./CommentThread";
import type { CommentWithAuthor } from "./data";
import { fmtNum, fmtSet, isDone, type Best, type LogRow, type PrevSession } from "./logic";
import { PersonSets, type FillSet } from "./PersonSets";
import type { SaveResult } from "./SetRow";

export type PersonView = {
  uid: string;
  /** Naam boven de sets (alleen in groepsmodus). */
  name?: string;
  prev?: PrevSession;
  best: Best | null;
  readOnly: boolean;
};

const chipBtn =
  "inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-medium text-ink transition hover:border-muted active:scale-95";

export function ExerciseCard({
  index,
  we,
  people,
  logs,
  comments,
  nameOf,
  userId,
  isTrainer,
  canComment,
  groupMode,
  loading,
  onSave,
  onDelete,
  onUncomplete,
  onFill,
  onCommentsChange,
  onError,
}: {
  index: number;
  we: WorkoutExercise;
  /** Voor wie de sets getoond worden: één persoon, of iedereen in groepsmodus. */
  people: PersonView[];
  /** Alle sets van deze oefening (iedereen). */
  logs: LogRow[];
  comments: CommentWithAuthor[];
  nameOf: (uid: string) => string;
  userId: string;
  isTrainer: boolean;
  canComment: boolean;
  groupMode: boolean;
  /** Sets worden nog geladen. */
  loading?: boolean;
  onSave: (we: WorkoutExercise, uid: string, n: number, weight: string, reps: string) => Promise<SaveResult>;
  onDelete: (we: WorkoutExercise, uid: string, n: number, log: LogRow) => void;
  /** Afvinken ongedaan maken zonder de getallen te wissen. */
  onUncomplete?: (we: WorkoutExercise, uid: string, n: number, log: LogRow) => void;
  onFill: (we: WorkoutExercise, uid: string, sets: FillSet[]) => void;
  onCommentsChange: () => void;
  onError: (message: string) => void;
}) {
  const ex = EXERCISE_BY_SLUG[we.exercise_slug];
  const [showComments, setShowComments] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [plateOpen, setPlateOpen] = useState(false);
  // Gewicht uit de schijvencalculator per persoon: voorinvulling voor zijn of haar volgende sets
  // (een trainer die om de beurt voor iemand invult, krijgt zo niet andermans gewicht).
  const [plateWeights, setPlateWeights] = useState<Record<string, number>>({});
  const video = DEFAULT_VIDEOS[we.exercise_slug];
  const usesPlates = ex?.equipment === "barbell" || ex?.equipment === "ez_bar";

  const shownIds = new Set(people.map((p) => p.uid));
  const others = groupMode ? [] : [...new Set(logs.filter((l) => !shownIds.has(l.user_id)).map((l) => l.user_id))];
  const main = people[0];
  const plateWeight = !groupMode && main ? (plateWeights[main.uid] ?? null) : null;
  const plateSetter = (uid: string) => (w: number) => setPlateWeights((m) => ({ ...m, [uid]: w }));
  const mainLogs = main ? logs.filter((l) => l.user_id === main.uid) : [];
  const lastWeight =
    plateWeight ??
    [...mainLogs].sort((a, b) => b.set_number - a.set_number).find((l) => l.weight)?.weight ??
    main?.prev?.sets.at(-1)?.weight ??
    null;
  const complete = !groupMode && !!main && mainLogs.filter(isDone).length >= we.target_sets;
  const commentsId = `comments-${we.id}`;

  return (
    <li
      id={`exercise-${we.id}`}
      data-exercise-card
      className={`card animate-fade-up scroll-mt-40 space-y-4 ${complete ? "border-accent/40" : ""}`}
      style={{ "--i": Math.min(index, 8) } as React.CSSProperties}>
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors duration-300 ${
            complete ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"
          }`}
          aria-hidden
        >
          {complete ? <CheckIcon size={14} strokeWidth={3} /> : index + 1}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="space-y-0.5">
            <h2 className="text-lg font-bold leading-tight">
              <span className="sr-only">Oefening {index + 1}: </span>
              {ex?.name ?? we.exercise_slug}
              {complete && <span className="sr-only"> (alle sets gedaan)</span>}
            </h2>
            <p className="text-sm text-muted">
              {we.target_sets} × {we.target_reps} reps
            </p>
          </div>
          {ex && <MuscleChips primary={ex.primary} secondary={ex.secondary} limit={5} />}
          {we.notes && <p className="text-sm italic text-muted">“{we.notes}”</p>}
          {(usesPlates || video || ex) && (
            <div className="-ml-0.5 flex flex-wrap gap-2 pt-0.5">
              {usesPlates && (
                <button className={chipBtn} onClick={() => setPlateOpen(true)}>
                  <DumbbellIcon size={14} className="text-accent" /> Schijven
                  {plateWeight != null && <span className="tabular-nums text-muted">{fmtNum(plateWeight)} kg</span>}
                </button>
              )}
              {video && (
                <button className={chipBtn} onClick={() => setShowVideo((v) => !v)} aria-expanded={showVideo}>
                  {showVideo ? <CloseIcon size={13} className="text-accent" /> : <PlayIcon size={13} className="text-accent" />} Video
                </button>
              )}
              {ex && (
                <Link href={`/exercises/${ex.slug}`} className={chipBtn}>
                  Uitleg <ChevronRightIcon size={14} className="text-accent" />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {showVideo && video && (
        <div className="animate-fade-in aspect-video overflow-hidden rounded-xl bg-black">
          <iframe
            className="h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${video.id}`}
            title={`${ex?.name ?? we.exercise_slug} uitleg`}
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
      {usesPlates && plateOpen && (
        <PlateCalculator
          open
          onClose={() => setPlateOpen(false)}
          initial={lastWeight}
          equipment={ex?.equipment}
          onUse={!groupMode && main && !main.readOnly ? plateSetter(main.uid) : undefined}
        />
      )}

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Sets laden">
          {Array.from({ length: Math.min(Math.max(we.target_sets, 1), 5) }, (_, i) => (
            <div key={i} className="skeleton h-11" />
          ))}
        </div>
      ) : (
      <div className={groupMode ? "divide-y divide-line [&>*]:py-3 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0" : ""}>
        {people.map((p) => (
          <PersonSets
            key={p.uid}
            we={we}
            ex={ex}
            uid={p.uid}
            name={p.name}
            logs={logs.filter((l) => l.user_id === p.uid)}
            prev={p.prev}
            best={p.best}
            compact={groupMode}
            readOnly={p.readOnly}
            plateWeight={groupMode ? null : (plateWeights[p.uid] ?? null)}
            onSave={(n, w, r) => onSave(we, p.uid, n, w, r)}
            onDelete={(n, log) => onDelete(we, p.uid, n, log)}
            onUncomplete={onUncomplete ? (n, log) => onUncomplete(we, p.uid, n, log) : undefined}
            onFill={(sets) => onFill(we, p.uid, sets)}
          />
        ))}
      </div>
      )}

      {others.length > 0 && (
        <div className="space-y-1 border-t border-line pt-3">
          {others.map((uid) => (
            <p key={uid} className="text-sm">
              <span className="font-medium">{uid === userId ? "Jij" : nameOf(uid)}:</span>{" "}
              <span className="text-muted">
                {logs
                  .filter((l) => l.user_id === uid)
                  .sort((a, b) => a.set_number - b.set_number)
                  .map(fmtSet)
                  .join(" · ")}
              </span>
            </p>
          ))}
        </div>
      )}

      <div className="border-t border-line pt-2">
        <button
          className="-ml-1 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-1 text-sm text-muted hover:text-ink"
          onClick={() => setShowComments((v) => !v)}
          aria-expanded={showComments}
          aria-controls={commentsId}
        >
          <ChatIcon size={15} />
          {comments.length > 0 ? `${comments.length} opmerking${comments.length === 1 ? "" : "en"}` : canComment ? "Opmerking plaatsen" : "Geen opmerkingen"}
        </button>
        {showComments && (
          <div id={commentsId} className="animate-fade-in mt-2">
            <CommentThread
              workoutId={we.workout_id}
              workoutExerciseId={we.id}
              comments={comments}
              userId={userId}
              isTrainer={isTrainer}
              canPost={canComment}
              nameOf={nameOf}
              onChange={onCommentsChange}
              onError={onError}
            />
          </div>
        )}
      </div>
    </li>
  );
}
