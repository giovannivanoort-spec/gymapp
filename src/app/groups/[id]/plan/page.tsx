"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useUserId } from "@/components/AuthProvider";
import { toBuilderItem, WorkoutBuilder, type BuilderValue } from "@/components/WorkoutBuilder";
import { ConfirmSheet } from "@/components/planning/ConfirmSheet";
import { refreshTrainingData, useGroupData } from "@/components/groups/groupData";
import { notifyGroupWorkout, saveGroupWorkout } from "@/components/groups/saveGroupWorkout";
import { toISODate } from "@/lib/dates";
import { errorMessage, supabase } from "@/lib/supabase";
import type { WorkoutExercise } from "@/lib/types";

export default function PlanPage() {
  return (
    <Suspense fallback={<PlanSkeleton />}>
      <Plan />
    </Suspense>
  );
}

function friendly(err: unknown): string {
  const msg = errorMessage(err);
  if (/failed to fetch|network|load failed/i.test(msg)) return "Geen verbinding. Je training is niet opgeslagen; probeer het opnieuw.";
  if (/row-level security|permission/i.test(msg)) return "Alleen trainers van deze groep kunnen trainingen plannen.";
  return msg;
}

/**
 * Nieuwe training plannen, met ?edit=<workoutId> een bestaande aanpassen, of met
 * ?from=<workoutId> een eerdere training opnieuw plannen (zelfde oefeningen, nieuwe datum).
 */
function Plan() {
  const { id: groupId } = useParams<{ id: string }>();
  const params = useSearchParams();
  const editId = params.get("edit");
  const fromId = editId ? null : params.get("from");
  const sourceId = editId ?? fromId;
  const presetDate = params.get("date");
  const router = useRouter();
  const userId = useUserId();
  const { data: groupData, error: groupError } = useGroupData(groupId);

  const [initial, setInitial] = useState<BuilderValue | null>(() =>
    sourceId ? null : { title: "", date: presetDate ?? toISODate(), notes: "", items: [] },
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Id van een training die bij een eerdere (deels mislukte) poging al is aangemaakt.
  const createdId = useRef<string | null>(null);

  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;
    supabase
      .from("workouts")
      .select("*, workout_exercises(*)")
      .eq("id", sourceId)
      .eq("group_id", groupId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) return setLoadError("Kan de training niet laden. Controleer je verbinding.");
        if (!data) return setLoadError("Deze training bestaat niet (meer) of hoort niet bij deze groep.");
        const wex = [...(data.workout_exercises as WorkoutExercise[])].sort((a, b) => a.position - b.position);
        setInitial({
          title: data.title,
          date: editId ? data.date : (presetDate ?? toISODate()),
          notes: data.notes ?? "",
          items: wex.map((we) =>
            toBuilderItem(
              { slug: we.exercise_slug, sets: we.target_sets, reps: we.target_reps, notes: we.notes ?? "" },
              // Bij opnieuw plannen zijn het nieuwe oefeningen (geen id), anders blijven gelogde sets gekoppeld.
              editId ? we.id : undefined,
            ),
          ),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId, editId, groupId, presetDate, attempt]);

  const role = groupData?.members.find((m) => m.user_id === userId)?.role;
  const notTrainer = groupData !== undefined && role !== "trainer";
  const groupName = groupData?.group.name;
  const otherMembers = (groupData?.members.length ?? 1) - 1;
  // Leden een pushmelding sturen: standaard aan bij een nieuwe training, uit bij aanpassen.
  const [notify, setNotify] = useState(() => !editId);

  // Eigen concept per soort plan: een verlaten nieuw plan duikt dan niet op bij "opnieuw plannen",
  // en een dag gekozen in de weekstrook wordt niet overschreven door een oud concept.
  const draftKey = `gymapp-draft:v1:plan:${groupId}:${
    editId ? `edit:${editId}` : fromId ? `from:${fromId}${presetDate ? `:${presetDate}` : ""}` : presetDate ? `date:${presetDate}` : "new"
  }`;

  async function save(v: BuilderValue) {
    setSaving(true);
    setSaveError(null);
    try {
      const workoutId = await saveGroupWorkout(groupId, editId ?? createdId.current, v, (id) => {
        createdId.current = id;
      });
      refreshTrainingData(groupId);
      if (notify && otherMembers > 0 && v.date >= toISODate()) void notifyGroupWorkout(workoutId, editId ? "edit" : "new");
      router.replace(`/workouts/${workoutId}`);
    } catch (err) {
      setSaveError(friendly(err));
      setSaving(false);
    }
  }

  async function remove() {
    if (!editId) return;
    setSaving(true);
    setDeleteError(null);
    const { data: deleted, error } = await supabase.from("workouts").delete().eq("id", editId).eq("group_id", groupId).select("id");
    if (error || !deleted?.length) {
      // Niets verwijderd zonder fout: geen rechten (meer), of de training is al weg.
      if (!error) {
        const { data: still } = await supabase.from("workouts").select("id").eq("id", editId).maybeSingle();
        if (!still) {
          refreshTrainingData(groupId);
          setSaving(false);
          setConfirmDelete(false);
          setDeleteError(null);
          setLoadError("Deze training bestaat niet meer. Misschien is hij net op een ander apparaat verwijderd.");
          return;
        }
      }
      setDeleteError(error ? friendly(error) : "Alleen trainers van deze groep kunnen trainingen verwijderen.");
      setSaving(false);
      return;
    }
    refreshTrainingData(groupId);
    router.replace(`/groups/${groupId}`);
  }

  const title = editId ? "Training aanpassen" : fromId ? "Opnieuw plannen" : "Training plannen";

  if (groupError?.kind === "notfound" || notTrainer) {
    return (
      <AppShell title={title} back={`/groups/${groupId}`}>
        <div className="card animate-fade-up space-y-3 text-center">
          <p className="font-semibold">Alleen trainers kunnen trainingen plannen</p>
          <p className="text-sm text-muted">
            {groupError?.kind === "notfound"
              ? "Je bent geen lid van deze groep."
              : "Vraag een trainer van de groep om een training klaar te zetten. Daarna kun je er je sets in loggen."}
          </p>
          <Link href={groupError?.kind === "notfound" ? "/" : `/groups/${groupId}`} className="btn-ghost w-full">
            {groupError?.kind === "notfound" ? "Naar home" : "Terug naar de groep"}
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={title} back={`/groups/${groupId}`}>
      {loadError ? (
        <div className="card animate-fade-up space-y-3 text-center">
          <p className="font-semibold">Training niet geladen</p>
          <p className="text-sm text-muted">{loadError}</p>
          <div className="grid grid-cols-2 gap-2">
            <Link href={`/groups/${groupId}`} className="btn-ghost">
              Terug
            </Link>
            <button
              className="btn-primary"
              onClick={() => {
                setLoadError(null);
                setAttempt((a) => a + 1);
              }}
            >
              Opnieuw
            </button>
          </div>
        </div>
      ) : initial && (groupData !== undefined || groupError) ? (
        <div className="space-y-3">
          {fromId ? (
            <p className="rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-muted">
              Zelfde oefeningen als de eerdere training. Controleer de datum, pas aan wat je wilt en sla op.
            </p>
          ) : (
            groupName && (
              <p className="text-sm text-muted">
                Voor <span className="font-medium text-ink">{groupName}</span>
              </p>
            )
          )}
          {otherMembers > 0 && (
            <button
              type="button"
              role="switch"
              aria-checked={notify}
              onClick={() => setNotify((n) => !n)}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-left transition hover:border-muted active:scale-[0.99]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Leden een melding sturen</span>
                <span className="block text-xs text-muted">
                  {notify
                    ? `${otherMembers === 1 ? "Je trainingsmaat krijgt" : `${otherMembers} leden krijgen`} na het opslaan een pushmelding.`
                    : "Opslaan zonder melding."}
                </span>
              </span>
              <span
                className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${notify ? "bg-accent" : "bg-surface-2 ring-1 ring-line"}`}
                aria-hidden
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full shadow transition-[left] duration-200 motion-reduce:transition-none ${
                    notify ? "left-[18px] bg-accent-ink" : "left-0.5 bg-muted"
                  }`}
                />
              </span>
            </button>
          )}
          <WorkoutBuilder
            key={draftKey}
            mode="workout"
            initial={initial}
            saving={saving}
            error={saveError}
            draftKey={draftKey}
            onSave={save}
            onDelete={
              editId
                ? () => {
                    setDeleteError(null);
                    setConfirmDelete(true);
                  }
                : undefined
            }
          />
        </div>
      ) : (
        <PlanSkeleton bare />
      )}

      <ConfirmSheet
        open={confirmDelete}
        title="Training verwijderen?"
        danger
        busy={saving}
        error={deleteError}
        confirmLabel="Verwijderen"
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      >
        <p>
          De training en alle sets die leden erin hebben gelogd worden verwijderd. Records en ranks worden opnieuw berekend. Dit kan
          niet ongedaan worden gemaakt.
        </p>
      </ConfirmSheet>
    </AppShell>
  );
}

function PlanSkeleton({ bare = false }: { bare?: boolean }) {
  const body = (
    <div className="space-y-3" aria-busy aria-label="Laden">
      <div className="skeleton h-24" />
      <div className="skeleton h-16" />
      <div className="skeleton h-16" />
      <div className="skeleton h-40" />
    </div>
  );
  if (bare) return body;
  return (
    <AppShell title="Training plannen" back>
      {body}
    </AppShell>
  );
}
