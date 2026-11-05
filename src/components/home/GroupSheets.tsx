"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlusIcon } from "@/components/Icons";
import { Sheet } from "@/components/Sheet";
import { invalidateMyGroups } from "@/lib/groups";
import { errorMessage, supabase } from "@/lib/supabase";

/** Code of volledige link (groep of vriend) naar de bestemming, of null als het geen geldige code is. */
export function parseInvite(input: string): string | null {
  const clean = input.trim().replace(/[?#].*$/, "");
  const parts = clean.split("/").filter(Boolean);
  const code = parts.pop() ?? "";
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(code)) return null;
  const kind = parts.pop();
  return kind === "friend" ? `/friend/${encodeURIComponent(code)}` : `/join/${encodeURIComponent(code)}`;
}

/** Kiezen tussen een nieuwe groep maken of lid worden met een code. */
export function GroupChoiceSheet({
  open,
  onClose,
  onNew,
  onJoin,
}: {
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  onJoin: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Groep">
      <div className="space-y-3">
        <p className="text-sm text-muted">In een groep plant de trainer de trainingen en zie je elkaars voortgang.</p>
        <button type="button" className="btn-primary w-full" onClick={onNew}>
          <PlusIcon size={16} /> Nieuwe groep maken
        </button>
        <button type="button" className="btn-ghost w-full" onClick={onJoin}>
          Code of link invoeren
        </button>
      </div>
    </Sheet>
  );
}

export function NewGroupSheet({
  open,
  userId,
  onClose,
  onCreated,
}: {
  open: boolean;
  userId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bij opnieuw openen een schoon formulier (niet bij sluiten: dan schuift het paneel nog weg).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName("");
      setError(null);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.from("groups").insert({ name: name.trim() }).select("id").single();
    setBusy(false);
    if (error) return setError(errorMessage(error));
    // Bij terugkomen op Home staat de nieuwe groep er meteen tussen.
    invalidateMyGroups(userId);
    onCreated(data.id);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Nieuwe groep">
      <form onSubmit={create} className="space-y-4">
        <div>
          <label className="label" htmlFor="gname">
            Naam
          </label>
          <input
            id="gname"
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="Bijv. Gym bros"
            maxLength={60}
            required
            autoFocus
            aria-invalid={!!error}
            aria-describedby={error ? "gname-error" : undefined}
          />
        </div>
        <p className="text-sm text-muted">Jij wordt de trainer van deze groep. Daarna kun je vrienden uitnodigen.</p>
        {error && (
          <p id="gname-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button className="btn-primary w-full" disabled={busy || !name.trim()}>
          {busy ? (
            <>
              <span className="spinner text-[14px]" aria-hidden /> Aanmaken
            </>
          ) : (
            "Groep aanmaken"
          )}
        </button>
      </form>
    </Sheet>
  );
}

export function JoinSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setCode("");
      setError(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Lid worden met code">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Accepteert ook een volledige uitnodigingslink (met of zonder / of ?… aan het eind).
          const target = parseInvite(code);
          if (!target) return setError("Dit lijkt geen geldige code of uitnodigingslink.");
          setError(null);
          router.push(target);
        }}
        className="space-y-4"
      >
        <div>
          <label className="label" htmlFor="invite">
            Code of link
          </label>
          <input
            id="invite"
            className="input"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
            placeholder="Bijv. a1b2c3d4 of de uitnodigingslink"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={!!error}
            aria-describedby={error ? "invite-error" : undefined}
            autoFocus
          />
        </div>
        {error && (
          <p id="invite-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button className="btn-primary w-full" disabled={!code.trim()}>
          Verder
        </button>
      </form>
    </Sheet>
  );
}
