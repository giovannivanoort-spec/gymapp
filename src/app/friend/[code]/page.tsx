"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useUserId } from "@/components/AuthProvider";
import { Avatar } from "@/components/Avatar";
import { REQUEST_MESSAGES, requestFriendByCode } from "@/lib/friends";
import { errorMessage, supabase } from "@/lib/supabase";

type Preview = { id: string; display_name: string };

/** Uitnodigingslink voor een vriendschap: /friend/<code>. */
export default function FriendInvitePage() {
  const { code } = useParams<{ code: string }>();
  const me = useUserId();
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("friend_code_preview", { code }).then(({ data }) => setPreview((data as Preview[] | null)?.[0] ?? null));
  }, [code]);

  async function add() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await requestFriendByCode(code);
      if (res === "accepted" || res === "already") return router.replace(`/friends/${preview.id}`);
      setDone(REQUEST_MESSAGES[res]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Vriendschapsverzoek" back="/">
      {preview === undefined ? (
        <div className="skeleton h-64" />
      ) : preview === null ? (
        <div className="card text-sm text-muted">Deze vriendcode bestaat niet. Vraag om een nieuwe link.</div>
      ) : preview.id === me ? (
        <div className="card space-y-3 text-center text-sm text-muted">
          <p>Dit is je eigen link. Stuur hem naar een vriend zodat die jou kan toevoegen.</p>
          <Link href="/friends" className="btn-ghost w-full">
            Naar vrienden
          </Link>
        </div>
      ) : (
        <div className="card animate-scale-in space-y-5 py-8 text-center">
          <Avatar id={preview.id} name={preview.display_name} size={80} className="mx-auto" />
          <div>
            <h2 className="text-2xl font-bold">{preview.display_name}</h2>
            <p className="mt-1 text-sm text-muted">heeft je uitgenodigd. Als vrienden zien jullie elkaars trainingen, ranks en progressie.</p>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          {done ? (
            <div className="space-y-3">
              <p className="font-semibold text-accent">{done}</p>
              <Link href="/friends" className="btn-ghost w-full">
                Naar vrienden
              </Link>
            </div>
          ) : (
            <button className="btn-primary w-full" onClick={add} disabled={busy}>
              {busy ? "Bezig…" : "Vriend toevoegen"}
            </button>
          )}
        </div>
      )}
    </AppShell>
  );
}
