"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { toBuilderItem, WorkoutBuilder, type BuilderValue } from "@/components/WorkoutBuilder";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Template } from "@/lib/types";

/** /templates/new maakt een nieuw schema, /templates/<id> bewerkt een bestaand schema. */
export default function TemplateEditPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const [initial, setInitial] = useState<BuilderValue | null>(() =>
    isNew ? { title: "", date: "", notes: "", items: [] } : null,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew) return;
    supabase
      .from("templates")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (!data) return router.replace("/templates");
        const t = data as Template;
        setInitial({ title: t.name, date: "", notes: "", items: t.exercises.map((p) => toBuilderItem(p)) });
      });
  }, [id, isNew, router]);

  async function save(v: BuilderValue) {
    setSaving(true);
    const row = {
      name: v.title,
      exercises: v.items.map(({ slug, sets, reps, notes }) => ({ slug, sets, reps, notes: notes?.trim() || undefined })),
    };
    const { error } = isNew
      ? await supabase.from("templates").insert(row)
      : await supabase.from("templates").update(row).eq("id", id);
    if (error) {
      alert(errorMessage(error));
      return setSaving(false);
    }
    router.replace("/templates");
  }

  async function remove() {
    if (!confirm("Dit schema verwijderen? Geplande trainingen blijven bestaan.")) return;
    setSaving(true);
    await supabase.from("templates").delete().eq("id", id);
    router.replace("/templates");
  }

  return (
    <AppShell title={isNew ? "Nieuw schema" : "Schema bewerken"} back="/templates">
      {initial ? (
        <WorkoutBuilder mode="template" initial={initial} saving={saving} onSave={save} onDelete={isNew ? undefined : remove} />
      ) : (
        <div className="space-y-3"><div className="skeleton h-24" /><div className="skeleton h-40" /></div>
      )}
    </AppShell>
  );
}
