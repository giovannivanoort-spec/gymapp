"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useUserId } from "@/components/AuthProvider";
import { ClipboardIcon, RefreshIcon, UsersIcon } from "@/components/Icons";
import { ConfirmSheet } from "@/components/planning/ConfirmSheet";
import { ActionIcons, ExerciseActionsSheet, type ExerciseAction } from "@/components/planning/ExerciseActionsSheet";
import { setFlash } from "@/components/planning/flash";
import { notify } from "@/components/planning/notify";
import { groupOf, setTemplateGroup, sharingError, useMyGroupsState } from "@/components/planning/sharing";
import { Sheet } from "@/components/Sheet";
import { clearBuilderDraft, toBuilderItem, WorkoutBuilder, type BuilderValue } from "@/components/WorkoutBuilder";
import { getCached } from "@/lib/cache";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import type { MyGroup } from "@/lib/groups";
import { errorMessage, supabase } from "@/lib/supabase";
import { cleanPlan, insertTemplate, plural, putTemplateInCache, removeTemplateFromCache, templatesKey } from "@/lib/templates";
import type { Template } from "@/lib/types";

type State =
  | { status: "loading" }
  | { status: "ready"; initial: BuilderValue; template: Template | null }
  | { status: "notfound" }
  | { status: "error"; message: string };

/** Wat de server zegt over een schema dat uit de cache is geopend. */
type Remote = { kind: "newer"; template: Template } | { kind: "gone" } | null;

function toInitial(t: Template): BuilderValue {
  return { title: t.name, date: "", notes: "", items: t.exercises.map((p) => toBuilderItem(p)) };
}

/** Zelfde inhoud? (Vergelijkt naam, de opgeschoonde oefeningen en met wie het gedeeld is.) */
function sameContent(a: Template, b: Template) {
  return (
    a.name === b.name &&
    groupOf(a) === groupOf(b) &&
    JSON.stringify(cleanPlan(a.exercises ?? [])) === JSON.stringify(cleanPlan(b.exercises ?? []))
  );
}

/**
 * /templates/new maakt een nieuw schema (met ?add=<slug> alvast een oefening erin),
 * /templates/<id> bewerkt een bestaand schema. Trainers kunnen een schema hier delen met hun groep.
 */
export default function TemplateEditPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const userId = useUserId();
  const router = useRouter();
  const { groups, trainerGroups } = useMyGroupsState(userId);
  // Uit de lijst van de vorige pagina: direct bewerken zonder laadscherm (en op de achtergrond controleren).
  const [seed] = useState<Template | null>(() =>
    !isNew && userId ? (getCached<Template[]>(templatesKey(userId))?.find((t) => t.id === id) ?? null) : null,
  );
  const [state, setState] = useState<State>(() => {
    if (isNew) {
      const add = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("add") : null;
      const ex = add ? EXERCISE_BY_SLUG[add] : undefined;
      return {
        status: "ready",
        template: null,
        initial: { title: "", date: "", notes: "", items: ex ? [toBuilderItem({ slug: ex.slug, sets: 3, reps: "8-12" })] : [] },
      };
    }
    return seed ? { status: "ready", initial: toInitial(seed), template: seed } : { status: "loading" };
  });
  const [builderKey, setBuilderKey] = useState(0);
  const [remote, setRemote] = useState<Remote>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);

  const needsFetch = !isNew && state.status === "loading";
  useEffect(() => {
    if (!needsFetch) return;
    let cancelled = false;
    supabase
      .from("templates")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setState({ status: "error", message: errorMessage(error) });
        else if (!data) setState({ status: "notfound" });
        else setState({ status: "ready", initial: toInitial(data as Template), template: data as Template });
      });
    return () => {
      cancelled = true;
    };
  }, [id, needsFetch, attempt]);

  // Geopend vanuit de cache: toch even bij de server kijken. Is het schema intussen ergens anders
  // aangepast (ander toestel, de coach, een andere trainer), dan bieden we de nieuwste versie aan
  // in plaats van die stil te overschrijven.
  useEffect(() => {
    if (!seed) return;
    let cancelled = false;
    supabase
      .from("templates")
      .select("*")
      .eq("id", seed.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error) return;
        if (!data) {
          setRemote({ kind: "gone" });
          return;
        }
        const fresh = data as Template;
        if (!sameContent(fresh, seed)) {
          if (userId) putTemplateInCache(userId, fresh);
          // Alleen het delen is veranderd: dat is geen bewerkconflict, gewoon bijwerken.
          if (fresh.name === seed.name && JSON.stringify(cleanPlan(fresh.exercises)) === JSON.stringify(cleanPlan(seed.exercises))) {
            setState((s) => (s.status === "ready" ? { ...s, template: fresh } : s));
          } else {
            setRemote({ kind: "newer", template: fresh });
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [seed, userId]);

  const template = state.status === "ready" ? state.template : null;
  const sharedGroup = template ? groupOf(template) : null;
  const isOwner = !template || template.owner_id === userId;
  const trainerOfShared = !!sharedGroup && !!trainerGroups?.some((g) => g.id === sharedGroup);
  const canEdit = isOwner || trainerOfShared;
  const canShare = !!template && !!trainerGroups?.length && (isOwner || trainerOfShared) && remote?.kind !== "gone";
  const sharedName = sharedGroup ? (groups?.find((g) => g.id === sharedGroup)?.name ?? "je groep") : null;

  function loadNewest(t: Template) {
    // Het lokale concept hoort bij de versie die je nu weggooit: niet opnieuw aanbieden.
    clearBuilderDraft("template");
    setState({ status: "ready", initial: toInitial(t), template: t });
    setBuilderKey((k) => k + 1);
    setRemote(null);
  }

  async function save(v: BuilderValue) {
    setSaving(true);
    setSaveError(null);
    const row = { name: v.title.trim(), exercises: cleanPlan(v.items) };
    const { data, error } = isNew
      ? await supabase.from("templates").insert(row).select("*").single()
      : await supabase.from("templates").update(row).eq("id", id).select("*").single();
    if (error || !data) {
      setSaveError(
        error
          ? `Opslaan mislukt: ${errorMessage(error)}`
          : "Opslaan mislukt: dit schema bestaat niet meer. Bewaar je oefeningen via een nieuw schema.",
      );
      return setSaving(false);
    }
    putTemplateInCache(userId, data as Template);
    setFlash(isNew ? `Schema "${row.name}" aangemaakt` : sharedName ? `Schema opgeslagen, ook voor ${sharedName}` : "Schema opgeslagen");
    router.replace("/templates");
  }

  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    const { error } = await supabase.from("templates").delete().eq("id", id);
    if (error) {
      setDeleteError(errorMessage(error));
      return setDeleting(false);
    }
    removeTemplateFromCache(userId, id);
    setFlash("Schema verwijderd");
    router.replace("/templates");
  }

  function copyToMine(t: Template, asDuplicate: boolean) {
    setCopying(true);
    insertTemplate(userId, asDuplicate ? `${t.name} (kopie)` : t.name, t.exercises)
      .then((created) => {
        notify(asDuplicate ? `"${t.name}" gedupliceerd` : `"${t.name}" staat nu bij je eigen schema's`);
        router.push(`/templates/${created.id}`);
      })
      .catch((err) => notify(`Kopiëren mislukt: ${errorMessage(err)}`, { tone: "error" }))
      .finally(() => setCopying(false));
  }

  const menuActions: ExerciseAction[] = template
    ? [
        ...(canShare
          ? [
              {
                id: "share",
                label: sharedGroup ? "Delen wijzigen" : "Delen met groep",
                hint: sharedGroup ? `Nu gedeeld met ${sharedName}` : "Je leden zien het onder Van je trainer",
                icon: <UsersIcon size={20} />,
                run: () => setShareOpen(true),
              },
            ]
          : []),
        {
          id: "copy",
          label: "Dupliceren",
          hint: "Kopie van de laatst opgeslagen versie",
          icon: ActionIcons.copy,
          disabled: copying,
          run: () => copyToMine(template, true),
        },
        ...(isOwner && remote?.kind !== "gone"
          ? [
              {
                id: "delete",
                label: "Verwijderen",
                icon: ActionIcons.trash,
                danger: true,
                run: () => {
                  setDeleteError(null);
                  setConfirmDelete(true);
                },
              },
            ]
          : []),
      ]
    : [];

  const title = isNew ? "Nieuw schema" : state.status === "ready" && !canEdit ? "Schema" : "Schema bewerken";

  return (
    <AppShell
      title={title}
      back="/templates"
      action={
        template && canEdit ? (
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Meer opties voor dit schema"
            aria-haspopup="menu"
            className="-my-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink active:scale-90"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="5" cy="12" r="1.9" />
              <circle cx="12" cy="12" r="1.9" />
              <circle cx="19" cy="12" r="1.9" />
            </svg>
          </button>
        ) : undefined
      }
    >
      {remote && state.status === "ready" && (
        <div className="animate-fade-up mb-4 space-y-2 rounded-2xl border border-warn/40 bg-warn/5 p-3 text-sm" role="status">
          {remote.kind === "newer" ? (
            <>
              <p>
                <span className="font-semibold">Er is een nieuwere versie van dit schema.</span>{" "}
                <span className="text-muted">Het is ergens anders aangepast, bijvoorbeeld op een ander toestel of door de coach.</span>
              </p>
              <div className="flex gap-2">
                <button className="btn-primary min-h-11 flex-1" onClick={() => loadNewest(remote.template)}>
                  <RefreshIcon size={15} /> Nieuwste laden
                </button>
                <button className="btn-ghost min-h-11 flex-1" onClick={() => setRemote(null)}>
                  Mijn versie houden
                </button>
              </div>
            </>
          ) : (
            <p>
              <span className="font-semibold">Dit schema is intussen verwijderd.</span>{" "}
              <span className="text-muted">Opslaan lukt niet meer; maak eventueel een nieuw schema met deze oefeningen.</span>
            </p>
          )}
        </div>
      )}

      {state.status === "ready" && sharedName && canEdit && (
        <div className="animate-fade-up mb-4 flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/5 py-1 pl-3 pr-1 text-sm">
          <UsersIcon size={16} className="shrink-0 text-accent" />
          <p className="min-w-0 flex-1 py-2">
            Gedeeld met <span className="font-semibold">{sharedName}</span>.{" "}
            <span className="text-muted">Wat je opslaat, zien je leden ook.</span>
          </p>
          {canShare && (
            <button onClick={() => setShareOpen(true)} className="min-h-11 shrink-0 rounded-xl px-3 text-xs font-semibold text-muted hover:text-ink">
              Wijzigen
            </button>
          )}
        </div>
      )}

      {state.status === "ready" && !canEdit && template ? (
        <ReadOnlyTemplate template={template} busy={copying} onCopy={() => copyToMine(template, false)} />
      ) : state.status === "ready" ? (
        <WorkoutBuilder key={builderKey} mode="template" initial={state.initial} saving={saving} error={saveError} onSave={save} />
      ) : state.status === "loading" ? (
        <div className="space-y-3" aria-busy aria-label="Schema laden">
          <div className="skeleton h-24" />
          <div className="skeleton h-36" />
          <div className="skeleton h-36" />
        </div>
      ) : state.status === "notfound" ? (
        <div className="card animate-fade-up space-y-3 text-sm">
          <p className="font-semibold">Dit schema bestaat niet (meer)</p>
          <p className="text-muted">Misschien is het verwijderd, of niet meer gedeeld met je groep. Je kunt een nieuw schema maken.</p>
          <div className="flex gap-2">
            <Link href="/templates" className="btn-ghost min-h-11 flex-1">
              Schema&apos;s
            </Link>
            <Link href="/templates/new" className="btn-primary min-h-11 flex-1">
              Nieuw schema
            </Link>
          </div>
        </div>
      ) : (
        <div className="card animate-fade-up space-y-3 text-sm" role="alert">
          <p className="font-semibold">Schema laden mislukt</p>
          <p className="text-muted">{state.message}</p>
          <button
            className="btn-ghost min-h-11 w-full"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((a) => a + 1);
            }}
          >
            Opnieuw proberen
          </button>
        </div>
      )}

      <ExerciseActionsSheet title={template?.name ?? "Schema"} open={menuOpen} onClose={() => setMenuOpen(false)} actions={menuActions} />

      {template && trainerGroups && (
        <ShareSheet
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          template={template}
          groups={trainerGroups}
          userId={userId}
          onShared={(t) => {
            setState((s) => (s.status === "ready" ? { ...s, template: t } : s));
            const gid = groupOf(t);
            notify(gid ? `Gedeeld met ${trainerGroups.find((g) => g.id === gid)?.name ?? "je groep"}` : "Niet meer gedeeld");
          }}
        />
      )}

      <ConfirmSheet
        open={confirmDelete}
        title="Schema verwijderen?"
        confirmLabel="Verwijderen"
        danger
        busy={deleting}
        error={deleteError}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
      >
        <p>
          Het schema verdwijnt uit je lijst{sharedName ? ` en uit die van ${sharedName}` : ""}. Trainingen die je er al mee gepland hebt
          blijven gewoon bestaan.
        </p>
      </ConfirmSheet>
    </AppShell>
  );
}

/** Kiezen met welke groep (waarvan je trainer bent) dit schema gedeeld wordt. Slaat direct op. */
function ShareSheet({
  open,
  onClose,
  template,
  groups,
  userId,
  onShared,
}: {
  open: boolean;
  onClose: () => void;
  template: Template;
  groups: MyGroup[];
  userId: string;
  onShared: (t: Template) => void;
}) {
  const current = groupOf(template);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setError(null);
  }

  function pick(groupId: string | null) {
    if (busy) return;
    if (groupId === current) return onClose();
    setBusy(groupId ?? "none");
    setError(null);
    setTemplateGroup(userId, template.id, groupId)
      .then((t) => {
        onShared(t);
        onClose();
      })
      .catch((err) => setError(sharingError(err)))
      .finally(() => setBusy(null));
  }

  const options: { id: string | null; name: string; meta: string }[] = [
    ...groups.map((g) => ({ id: g.id as string | null, name: g.name, meta: `${g.memberCount} ${g.memberCount === 1 ? "lid" : "leden"}` })),
    { id: null, name: "Niet delen", meta: "Alleen jij ziet dit schema" },
  ];

  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} title="Delen met groep">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Leden zien een gedeeld schema onder <span className="text-ink">Van je trainer</span> en kunnen het naar hun eigen schema&apos;s
          kopiëren. Alleen jij en andere trainers van de groep kunnen het aanpassen.
        </p>
        <div className="space-y-2" role="radiogroup" aria-label="Delen met">
          {options.map((o) => {
            const on = o.id === current;
            const loading = busy === (o.id ?? "none");
            return (
              <button
                key={o.id ?? "none"}
                role="radio"
                aria-checked={on}
                onClick={() => pick(o.id)}
                disabled={!!busy}
                className={`flex min-h-14 w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${
                  on ? "border-accent bg-accent/5" : "border-line hover:border-muted"
                }`}
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold ${o.id ? "bg-surface-2 text-accent" : "bg-surface-2 text-muted"}`}
                  aria-hidden
                >
                  {o.id ? o.name.slice(0, 1).toUpperCase() : "-"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{o.name}</span>
                  <span className="text-xs text-muted">{loading ? "Opslaan…" : o.meta}</span>
                </span>
                <span
                  className={`h-5 w-5 shrink-0 rounded-full border-2 ${on ? "border-accent bg-accent shadow-[inset_0_0_0_3px_var(--color-surface)]" : "border-line"}`}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>
        {error && (
          <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/** Schema van een trainer dat je niet zelf mag aanpassen: bekijken en kopiëren. */
function ReadOnlyTemplate({ template: t, busy, onCopy }: { template: Template; busy: boolean; onCopy: () => void }) {
  return (
    <div className="space-y-4">
      <div className="card animate-fade-up space-y-3">
        <div>
          <p className="text-lg font-bold leading-tight">{t.name}</p>
          <p className="mt-0.5 text-xs text-muted">
            Gedeeld door je trainer · {plural(t.exercises.length, "oefening", "oefeningen")}
          </p>
        </div>
        <ol className="divide-y divide-line">
          {t.exercises.map((p, i) => (
            <li key={`${p.slug}-${i}`}>
              <Link href={`/exercises/${p.slug}`} className="-mx-2 flex min-h-12 items-center gap-3 rounded-lg px-2 hover:bg-surface-2/60">
                <span className="w-4 shrink-0 text-right text-xs font-bold tabular-nums text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{EXERCISE_BY_SLUG[p.slug]?.name ?? p.slug}</span>
                  {p.notes && <span className="block truncate text-xs text-muted">{p.notes}</span>}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {p.sets}×{p.reps}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
      <button className="btn-primary min-h-11 w-full" onClick={onCopy} disabled={busy}>
        <ClipboardIcon size={16} /> {busy ? "Bezig…" : "Kopieer naar mijn schema's"}
      </button>
      <p className="text-center text-xs text-muted">Je kopie kun je daarna zelf aanpassen. Het origineel blijft van je trainer.</p>
    </div>
  );
}
