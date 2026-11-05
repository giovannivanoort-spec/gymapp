"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getMyGroups, invalidateMyGroups, type MyGroup } from "@/lib/groups";
import { errorMessage, supabase } from "@/lib/supabase";
import { useUserId } from "./AuthProvider";
import { ChevronRightIcon, PlusIcon } from "./Icons";
import { Sheet } from "./Sheet";

/**
 * Groene plusknop in de onderbalk: nieuwe training plannen. Bij één groep waar je trainer bent
 * ga je direct naar het plannen, bij meer kies je eerst de groep.
 */
export function NewWorkoutButton() {
  const userId = useUserId();
  const router = useRouter();
  const [choices, setChoices] = useState<MyGroup[] | null>(null);
  const [open, setOpen] = useState(false);

  async function start() {
    const groups = await getMyGroups(userId);
    const trainer = groups.filter((g) => g.role === "trainer");
    if (trainer.length === 1) return router.push(`/groups/${trainer[0].id}/plan`);
    setChoices(trainer);
    setOpen(true);
  }

  return (
    <>
      <div className="flex items-start justify-center">
        <button
          onClick={start}
          aria-label="Nieuwe training"
          className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-ink transition duration-200 hover:brightness-110 active:scale-90"
          style={{ boxShadow: "0 0 0 4px var(--color-bg), 0 10px 28px -6px rgb(200 245 58 / 0.55)" }}
        >
          <PlusIcon size={26} strokeWidth={2.6} />
        </button>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Nieuwe training">
        {choices && choices.length > 0 ? (
          <div className="space-y-2">
            <p className="pb-1 text-sm text-muted">Voor welke groep?</p>
            {choices.map((g) => (
              <button
                key={g.id}
                onClick={() => {
                  setOpen(false);
                  router.push(`/groups/${g.id}/plan`);
                }}
                className="card flex w-full items-center gap-3 text-left hover:border-muted"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-lg font-bold text-accent">
                  {g.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{g.name}</span>
                  <span className="text-xs text-muted">
                    {g.memberCount} {g.memberCount === 1 ? "lid" : "leden"}
                  </span>
                </span>
                <ChevronRightIcon className="text-muted" />
              </button>
            ))}
          </div>
        ) : (
          <NewGroupForm
            onCreated={(id) => {
              setOpen(false);
              router.push(`/groups/${id}/plan`);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

/** Nog geen groep waar je trainer bent: eerst een groep maken. */
function NewGroupForm({ onCreated }: { onCreated: (id: string) => void }) {
  const userId = useUserId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const { data, error } = await supabase.from("groups").insert({ name: name.trim() }).select("id").single();
        setBusy(false);
        if (error) return setError(errorMessage(error));
        invalidateMyGroups(userId);
        onCreated(data.id);
      }}
    >
      <p className="text-sm text-muted">
        Trainingen plan je voor een groep waar jij trainer bent. Je bent dat nog nergens, dus maak eerst een groep aan. Daarna
        kun je vrienden uitnodigen.
      </p>
      <div>
        <label className="label" htmlFor="ngname">
          Naam van de groep
        </label>
        <input id="ngname" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bijv. Gym bros" required />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full" disabled={busy || !name.trim()}>
        {busy ? "Aanmaken…" : "Groep aanmaken en training plannen"}
      </button>
    </form>
  );
}
