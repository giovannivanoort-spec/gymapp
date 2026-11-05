"use client";

import { useRef, useState } from "react";
import { ShareIcon } from "@/components/Icons";
import { Sheet } from "@/components/Sheet";
import { FriendQR } from "@/components/social/FriendQR";
import type { Group } from "@/lib/types";
import { APP_NAME } from "./groupData";

/**
 * Uitnodigen: QR-code (voor een vriend naast je in de gym), de link om te delen en de code.
 */
export function InviteSheet({
  group,
  open,
  onClose,
  onMessage,
}: {
  group: Group;
  open: boolean;
  onClose: () => void;
  /** Korte bevestiging via de toast van de pagina. */
  onMessage: (text: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const url = `${typeof window !== "undefined" ? window.location.origin : ""}/join/${group.invite_code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onMessage("Link gekopieerd");
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      onMessage("Kopieer de geselecteerde link");
    }
  }

  async function share() {
    const text = `Train mee met "${group.name}" in ${APP_NAME}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: APP_NAME, text, url });
        return;
      } catch (e) {
        // Zelf geannuleerd: niets doen. Andere fout: terugvallen op kopiëren.
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    await copy();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Vrienden uitnodigen">
      <div className="space-y-5">
        <div className="space-y-2 text-center">
          <FriendQR value={url} label={`QR-code om lid te worden van ${group.name}`} />
          <p className="text-sm text-muted">Laat een vriend deze code scannen met de camera. Na het inloggen tikt diegene op &ldquo;Lid worden&rdquo;.</p>
        </div>

        <div className="space-y-2">
          <label className="label" htmlFor="invite-link">
            Of stuur de link
          </label>
          <div className="flex items-center gap-2">
            <input
              id="invite-link"
              ref={inputRef}
              readOnly
              value={url}
              className="input min-w-0 flex-1 truncate py-2 font-mono text-sm"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button className="btn-ghost min-h-11 w-[5.5rem] shrink-0 px-3" onClick={copy} aria-live="polite">
              {copied ? "Gekopieerd" : "Kopieer"}
            </button>
          </div>
          <p className="text-xs text-muted">
            Code: <span className="select-all font-mono text-sm tracking-wider text-ink">{group.invite_code}</span>
          </p>
        </div>

        <button className="btn-primary min-h-11 w-full" onClick={share}>
          <ShareIcon size={16} />
          Deel uitnodiging
        </button>
      </div>
    </Sheet>
  );
}
