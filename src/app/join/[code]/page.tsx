"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { errorMessage, supabase } from "@/lib/supabase";

type Preview = { id: string; name: string; member_count: number };

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("group_preview", { code }).then(({ data }) => setPreview((data as Preview[] | null)?.[0] ?? null));
  }, [code]);

  async function join() {
    setBusy(true);
    const { data, error } = await supabase.rpc("join_group", { code });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    router.replace(`/groups/${data}`);
  }

  return (
    <AppShell title="Uitnodiging" back="/">
      {preview === undefined ? (
        <div className="space-y-3"><div className="skeleton h-24" /><div className="skeleton h-40" /></div>
      ) : preview === null ? (
        <div className="card text-sm text-muted">Deze uitnodiging bestaat niet (meer). Vraag om een nieuwe link.</div>
      ) : (
        <div className="card space-y-4 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-2 text-2xl font-bold text-accent">
            {preview.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className="text-sm text-muted">Je bent uitgenodigd voor</p>
            <h2 className="text-2xl font-bold">{preview.name}</h2>
            <p className="text-sm text-muted">{preview.member_count} leden</p>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button className="btn-primary w-full" onClick={join} disabled={busy}>
            {busy ? "Bezig…" : "Lid worden"}
          </button>
        </div>
      )}
    </AppShell>
  );
}
