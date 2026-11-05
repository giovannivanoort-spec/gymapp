"use client";

import { useState } from "react";
import { CloseIcon } from "@/components/Icons";
import { timeAgo } from "@/lib/dates";
import { errorMessage, supabase } from "@/lib/supabase";
import type { CommentWithAuthor } from "./data";

/** Opmerkingen bij een oefening of de hele training. */
export function CommentThread({
  workoutId,
  workoutExerciseId,
  comments,
  userId,
  isTrainer,
  canPost,
  nameOf,
  onChange,
  onError,
}: {
  workoutId: string;
  workoutExerciseId: string | null;
  comments: CommentWithAuthor[];
  userId: string;
  isTrainer: boolean;
  /** Alleen groepsleden kunnen reageren. */
  canPost: boolean;
  nameOf: (uid: string) => string;
  onChange: () => void;
  onError: (message: string) => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    const { error } = await supabase.from("comments").insert({ workout_id: workoutId, workout_exercise_id: workoutExerciseId, body: text });
    setBusy(false);
    if (error) return onError(`Plaatsen mislukt: ${errorMessage(error)}`);
    setBody("");
    onChange();
  }

  async function remove(id: string) {
    setRemoving(id);
    const { error } = await supabase.from("comments").delete().eq("id", id);
    setRemoving(null);
    setConfirming(null);
    if (error) return onError(`Verwijderen mislukt: ${errorMessage(error)}`);
    onChange();
  }

  return (
    <div className="space-y-3">
      {comments.length === 0 && !canPost && <p className="text-sm text-muted">Nog geen opmerkingen.</p>}
      {comments.map((c, i) => (
        <div
          key={c.id}
          className={`animate-fade-up rounded-xl bg-surface-2 px-3 py-2 transition-opacity ${removing === c.id ? "opacity-50" : ""}`}
          style={{ "--i": Math.min(i, 6) } as React.CSSProperties}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-semibold">{c.user_id === userId ? "Jij" : (c.profiles?.display_name ?? nameOf(c.user_id))}</p>
            <div className="flex shrink-0 items-center gap-1">
              <span className="text-xs text-muted">{timeAgo(c.created_at)}</span>
              {(c.user_id === userId || isTrainer) &&
                (confirming === c.id ? (
                  <span className="animate-fade-in flex items-center gap-1">
                    <button
                      className="min-h-8 rounded-lg px-2 text-xs font-semibold text-danger hover:bg-danger/10"
                      onClick={() => remove(c.id)}
                      disabled={removing === c.id}
                    >
                      Verwijderen
                    </button>
                    <button className="min-h-8 rounded-lg px-2 text-xs text-muted hover:text-ink" onClick={() => setConfirming(null)}>
                      Annuleer
                    </button>
                  </span>
                ) : (
                  <button
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-danger"
                    onClick={() => setConfirming(c.id)}
                    aria-label="Opmerking verwijderen"
                  >
                    <CloseIcon size={13} />
                  </button>
                ))}
            </div>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
        </div>
      ))}
      {canPost && (
        <form onSubmit={post} className="flex gap-2">
          <input
            className="input min-w-0 flex-1"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={workoutExerciseId ? "Bijv. voelde zwaar, volgende keer +2,5 kg" : "Schrijf een opmerking…"}
            maxLength={2000}
            aria-label="Opmerking"
            enterKeyHint="send"
          />
          <button className="btn-primary shrink-0" disabled={busy || !body.trim()}>
            {busy ? "Bezig…" : "Plaats"}
          </button>
        </form>
      )}
    </div>
  );
}
