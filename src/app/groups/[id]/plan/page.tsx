"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { toBuilderItem, WorkoutBuilder, type BuilderValue } from "@/components/WorkoutBuilder";
import { toISODate } from "@/lib/dates";
import { errorMessage, supabase } from "@/lib/supabase";
import type { WorkoutExercise } from "@/lib/types";

export default function PlanPage() {
  return (
    <Suspense>
      <Plan />
    </Suspense>
  );
}

/** Nieuwe training plannen, of met ?edit=<workoutId> een bestaande aanpassen. */
function Plan() {
  const { id: groupId } = useParams<{ id: string }>();
  const params = useSearchParams();
  const editId = params.get("edit");
  const router = useRouter();
  const [initial, setInitial] = useState<BuilderValue | null>(() =>
    editId ? null : { title: "", date: params.get("date") ?? toISODate(), notes: "", items: [] },
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      const { data } = await supabase
        .from("workouts")
        .select("*, workout_exercises(*)")
        .eq("id", editId)
        .single();
      if (!data) return router.replace(`/groups/${groupId}`);
      const wex = (data.workout_exercises as WorkoutExercise[]).sort((a, b) => a.position - b.position);
      setInitial({
        title: data.title,
        date: data.date,
        notes: data.notes ?? "",
        items: wex.map((we) =>
          toBuilderItem({ slug: we.exercise_slug, sets: we.target_sets, reps: we.target_reps, notes: we.notes ?? "" }, we.id),
        ),
      });
    })();
  }, [editId, groupId, router]);

  async function save(v: BuilderValue) {
    setSaving(true);
    try {
      const fields = { title: v.title, date: v.date, notes: v.notes || null };
      let workoutId = editId;
      if (workoutId) {
        const { error } = await supabase.from("workouts").update(fields).eq("id", workoutId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("workouts").insert({ ...fields, group_id: groupId }).select("id").single();
        if (error) throw error;
        workoutId = data.id;
      }

      // Bestaande oefeningen bijwerken (zodat gelogde sets behouden blijven), nieuwe toevoegen, verwijderde weghalen.
      const rows = v.items.map((it, position) => ({
        workout_id: workoutId,
        exercise_slug: it.slug,
        position,
        target_sets: it.sets,
        target_reps: it.reps || "8-12",
        notes: it.notes?.trim() || null,
      }));
      if (editId) {
        const keep = v.items.filter((it) => it.id).map((it) => it.id!);
        let del = supabase.from("workout_exercises").delete().eq("workout_id", workoutId!);
        if (keep.length) del = del.not("id", "in", `(${keep.join(",")})`);
        const { error: delErr } = await del;
        if (delErr) throw delErr;
        for (let i = 0; i < v.items.length; i++) {
          if (!v.items[i].id) continue;
          const { error } = await supabase.from("workout_exercises").update(rows[i]).eq("id", v.items[i].id!);
          if (error) throw error;
        }
      }
      const fresh = rows.filter((_, i) => !v.items[i].id);
      if (fresh.length) {
        const { error } = await supabase.from("workout_exercises").insert(fresh);
        if (error) throw error;
      }
      router.replace(`/workouts/${workoutId}`);
    } catch (err) {
      alert(errorMessage(err));
      setSaving(false);
    }
  }

  async function remove() {
    if (!editId || !confirm("Deze training en alle gelogde sets verwijderen?")) return;
    setSaving(true);
    const { error } = await supabase.from("workouts").delete().eq("id", editId);
    if (error) {
      alert(errorMessage(error));
      return setSaving(false);
    }
    router.replace(`/groups/${groupId}`);
  }

  return (
    <AppShell title={editId ? "Training aanpassen" : "Training plannen"} back>
      {initial ? (
        <WorkoutBuilder mode="workout" initial={initial} saving={saving} onSave={save} onDelete={editId ? remove : undefined} />
      ) : (
        <div className="space-y-3"><div className="skeleton h-24" /><div className="skeleton h-40" /></div>
      )}
    </AppShell>
  );
}
