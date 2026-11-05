"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useUserId } from "@/components/AuthProvider";
import { UsersIcon } from "@/components/Icons";
import { groupKey, plural } from "@/components/groups/groupData";
import { invalidate } from "@/lib/cache";
import { invalidateMyGroups } from "@/lib/groups";
import { errorMessage, supabase } from "@/lib/supabase";
import { toast } from "@/components/ui/Toast";

type Preview = { id: string; name: string; member_count: number };

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "missing" }
  | { status: "ready"; preview: Preview; isMember: boolean };

function friendly(err: unknown): string {
  const msg = errorMessage(err);
  if (/failed to fetch|network|load failed/i.test(msg)) return "Geen verbinding. Probeer het opnieuw.";
  if (/ongeldige/i.test(msg)) return "Deze uitnodiging is niet meer geldig. Vraag om een nieuwe link.";
  return msg;
}

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const userId = useUserId();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("group_preview", { code });
      if (cancelled) return;
      if (error) return setState({ status: "error" });
      const preview = (data as Preview[] | null)?.[0];
      if (!preview) return setState({ status: "missing" });
      // Al lid? Dan zie je je eigen lidmaatschap (RLS laat leden elkaars rij zien).
      const { data: membership } = userId
        ? await supabase.from("group_members").select("user_id").eq("group_id", preview.id).eq("user_id", userId).maybeSingle()
        : { data: null };
      if (cancelled) return;
      setState({ status: "ready", preview: { ...preview, member_count: Number(preview.member_count) }, isMember: !!membership });
    })();
    return () => {
      cancelled = true;
    };
  }, [code, userId, attempt]);

  async function join() {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("join_group", { code });
    if (error) {
      setBusy(false);
      return setError(friendly(error));
    }
    const gid = data as string;
    invalidateMyGroups(userId);
    invalidate(groupKey(gid));
    navigator.vibrate?.(10);
    if (state.status === "ready") toast.success(`Welkom bij ${state.preview.name}`);
    router.replace(`/groups/${gid}`);
  }

  return (
    <AppShell title="Uitnodiging" back="/">
      {state.status === "loading" ? (
        <div className="card space-y-4" aria-busy aria-label="Uitnodiging laden">
          <div className="skeleton mx-auto h-16 w-16 rounded-2xl" />
          <div className="skeleton mx-auto h-4 w-32" />
          <div className="skeleton mx-auto h-7 w-48" />
          <div className="skeleton h-11" />
        </div>
      ) : state.status === "error" ? (
        <div className="card animate-fade-up space-y-3 text-center">
          <p className="font-semibold">Kan uitnodiging niet laden</p>
          <p className="text-sm text-muted">Controleer je verbinding en probeer het opnieuw.</p>
          <button
            className="btn-primary w-full"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((a) => a + 1);
            }}
          >
            Opnieuw proberen
          </button>
        </div>
      ) : state.status === "missing" ? (
        <div className="card animate-fade-up space-y-3 text-center">
          <p className="font-semibold">Uitnodiging niet gevonden</p>
          <p className="text-sm text-muted">
            Deze link bestaat niet (meer). Misschien heeft de trainer een nieuwe link gemaakt. Vraag om de nieuwste uitnodiging.
          </p>
          <Link href="/" className="btn-ghost w-full">
            Naar home
          </Link>
        </div>
      ) : (
        <div className="card animate-scale-in space-y-5 py-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/15 text-2xl font-bold text-accent">
            {state.preview.name.trim().slice(0, 1).toUpperCase() || <UsersIcon size={28} />}
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted">{state.isMember ? "Je bent al lid van" : "Je bent uitgenodigd voor"}</p>
            <h2 className="break-words text-2xl font-bold">{state.preview.name}</h2>
            <p className="inline-flex items-center gap-1.5 text-sm text-muted">
              <UsersIcon size={14} />
              {plural(state.preview.member_count, "lid", "leden")}
            </p>
          </div>
          {!state.isMember && (
            <p className="text-sm text-muted">
              Als lid zie je de geplande trainingen, log je je eigen sets en doe je mee in de ranglijst. Je voeding blijft privé.
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {state.isMember ? (
            <Link href={`/groups/${state.preview.id}`} className="btn-primary min-h-11 w-full">
              Open groep
            </Link>
          ) : (
            <button className="btn-primary min-h-11 w-full" onClick={join} disabled={busy}>
              {busy ? "Bezig…" : "Lid worden"}
            </button>
          )}
        </div>
      )}
    </AppShell>
  );
}
