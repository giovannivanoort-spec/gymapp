"use client";

import { useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { toast } from "@/components/ui/Toast";
import { avatarErrorMessage, removeAvatar, uploadAvatar } from "@/lib/avatars";
import { ConfirmSheet } from "./ConfirmSheet";
import { CameraIcon, TrashIcon } from "./icons";

/**
 * Profielfoto kiezen, wijzigen of verwijderen, met de grote avatar ernaast. `children` (naam,
 * e-mail) staat rechts van de foto, met de knoppen eronder. `onChanged` ververst het profiel,
 * zodat de nieuwe foto overal in de app verschijnt.
 */
export function AvatarPicker({
  userId,
  name,
  src,
  ring,
  onChanged,
  children,
}: {
  userId: string;
  name: string;
  src?: string | null;
  ring?: string;
  onChanged: () => Promise<void>;
  children?: React.ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Net geüploade foto alvast tonen; daarna neemt het ververste profiel het over.
  const [fresh, setFresh] = useState<{ from: string | null; url: string | null } | null>(null);
  const current = src ?? null;
  const shown = fresh && fresh.from === current ? fresh.url : current;
  const hasPhoto = !!shown;

  function pick() {
    if (!uploading) input.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Leegmaken, zodat dezelfde foto nog eens kiezen ook weer werkt.
    e.target.value = "";
    if (!file || !userId) return;
    setUploading(true);
    try {
      const url = await uploadAvatar(userId, file);
      setFresh({ from: current, url });
      await onChanged();
      toast.success("Profielfoto opgeslagen");
    } catch (err) {
      toast.error(avatarErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    try {
      await removeAvatar(userId);
    } catch (err) {
      throw new Error(avatarErrorMessage(err));
    }
    setFresh({ from: current, url: null });
    await onChanged();
    setConfirmOpen(false);
    toast.success("Profielfoto verwijderd");
  }

  return (
    <div className="relative flex items-center gap-4">
      <button
        type="button"
        onClick={pick}
        disabled={uploading || !userId}
        aria-label={hasPhoto ? "Profielfoto wijzigen" : "Profielfoto kiezen"}
        aria-busy={uploading}
        className="group relative shrink-0 rounded-full transition-transform active:scale-95 disabled:cursor-default"
      >
        <Avatar id={userId} name={name} src={shown} size={80} ring={ring} />
        {uploading && (
          <span className="animate-fade-in absolute inset-0 flex items-center justify-center rounded-full bg-bg/60" aria-hidden>
            <span className="spinner text-xl text-accent" />
          </span>
        )}
        <span
          className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-ink ring-[3px] ring-surface transition group-hover:brightness-110"
          aria-hidden
        >
          <CameraIcon size={14} />
        </span>
      </button>

      <div className="min-w-0 flex-1">
        {children}
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <button type="button" className="btn-ghost px-3 text-xs" onClick={pick} disabled={uploading || !userId}>
            {uploading ? (
              <>
                <span className="spinner" aria-hidden /> Uploaden…
              </>
            ) : hasPhoto ? (
              "Foto wijzigen"
            ) : (
              "Foto kiezen"
            )}
          </button>
          {hasPhoto && !uploading && (
            <button
              type="button"
              className="flex min-h-11 items-center gap-1 rounded-xl px-2.5 text-xs font-semibold text-muted transition hover:text-danger"
              onClick={() => setConfirmOpen(true)}
              aria-haspopup="dialog"
            >
              <TrashIcon size={13} /> Verwijderen
            </button>
          )}
        </div>
      </div>

      <input ref={input} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={onFile} />
      <span className="sr-only" aria-live="polite">
        {uploading ? "Profielfoto wordt geüpload" : ""}
      </span>

      <ConfirmSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Profielfoto verwijderen"
        body="Je foto wordt verwijderd. Vrienden en groepsleden zien daarna weer je initialen."
        confirmLabel="Verwijderen"
        busyLabel="Verwijderen…"
        danger
        onConfirm={remove}
      />
    </div>
  );
}
