"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useUserId } from "@/components/AuthProvider";
import { CalendarIcon, ChevronRightIcon, ClipboardIcon, SparkleIcon, UsersIcon } from "@/components/Icons";
import { fold } from "@/components/ExerciseFilter";
import { MuscleTag } from "@/components/MuscleChips";
import { peekFlash, takeFlash } from "@/components/planning/flash";
import { notify } from "@/components/planning/notify";
import { PlanTemplateSheet } from "@/components/planning/PlanTemplateSheet";
import { groupOf, useMyGroupsState } from "@/components/planning/sharing";
import { useTemplateList } from "@/components/planning/useTemplateList";
import { WeeklyProgram } from "@/components/planning/WeeklyProgram";
import { analyzePlan } from "@/lib/analysis";
import { useCached } from "@/lib/cache";
import { EXERCISE_BY_SLUG } from "@/lib/exercises";
import { GROUP_BY_ID, REGION_COLOR } from "@/lib/muscles";
import { errorMessage, supabase } from "@/lib/supabase";
import { estimateMinutes, insertTemplate, plural, totalSets } from "@/lib/templates";
import type { Template } from "@/lib/types";

const COACH_PROMPT =
  "Maak een trainingsschema voor mij en sla het op als schema. Vraag eerst kort naar mijn doel, ervaring en hoeveel dagen per week ik train.";

const exName = (slug: string) => EXERCISE_BY_SLUG[slug]?.name ?? slug;

function coachHref(t: Template, mine: boolean) {
  const q = [
    mine ? `Bekijk mijn schema "${t.name}":` : `Mijn trainer heeft het schema "${t.name}" gedeeld:`,
    ...t.exercises.map((p) => `- ${exName(p.slug)}: ${p.sets}×${p.reps}${p.notes ? ` (${p.notes})` : ""}`),
    mine ? "Wat zou je verbeteren?" : "Hoe pak ik dit het beste aan, en waar moet ik op letten?",
  ].join("\n");
  return `/coach?q=${encodeURIComponent(q)}`;
}

/** Namen van de trainers die een schema gedeeld hebben (profielen zijn voor ingelogde gebruikers leesbaar). */
async function fetchOwnerNames(ids: string[]): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("profiles").select("id, display_name").in("id", ids);
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as { id: string; display_name: string | null }[]).map((p) => [p.id, p.display_name ?? ""]));
}

export default function TemplatesPage() {
  const userId = useUserId();
  // Gedeelde cache onder `templates:<userId>`: de coach ververst deze lijst na save_template.
  // Met supabase/upgrade-planning.sql staan hier ook de schema's in die een trainer met je groep deelt.
  const { templates, error, retry, refreshing } = useTemplateList(userId);
  const { groups, trainerGroups, error: groupsError } = useMyGroupsState(userId);
  /**
   * Alleen als zeker is dat iemand geen trainer is. Zolang de groepen laden: de trainer-weergave;
   * mislukt het laden zonder bekende groepen, dan de veilige ledenweergave (geen doodlopende knop).
   */
  const memberOnly = groups !== undefined ? !trainerGroups?.length : !!groupsError;
  const trainerOf = useMemo(() => new Set((trainerGroups ?? []).map((g) => g.id)), [trainerGroups]);
  const groupName = useMemo(() => new Map((groups ?? []).map((g) => [g.id, g.name])), [groups]);
  const [query, setQuery] = useState("");
  const [planFor, setPlanFor] = useState<Template | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Melding van de vorige pagina (bijv. "Schema opgeslagen" na het bewerken).
  useEffect(() => {
    const msg = peekFlash();
    if (!msg) return;
    const t = setTimeout(() => {
      if (takeFlash()) notify(msg);
    }, 150);
    return () => clearTimeout(t);
  }, []);

  const mine = useMemo(() => (templates ?? []).filter((t) => t.owner_id === userId), [templates, userId]);
  const shared = useMemo(() => (templates ?? []).filter((t) => t.owner_id !== userId), [templates, userId]);
  const ownerIds = useMemo(() => [...new Set(shared.map((t) => t.owner_id))].sort(), [shared]);
  const owners = useCached(ownerIds.length ? `tpl-owners:${ownerIds.join(",")}` : null, () => fetchOwnerNames(ownerIds), {
    persist: true,
    maxAge: 5 * 60_000,
  });

  const q = fold(query.trim());
  const match = (t: Template) => !q || fold(`${t.name} ${t.exercises.map((p) => exName(p.slug)).join(" ")}`).includes(q);
  const visibleMine = mine.filter(match);
  const visibleShared = shared.filter(match);
  const total = (templates ?? []).length;

  function duplicate(t: Template, copyOfShared = false) {
    setBusyId(t.id);
    insertTemplate(userId, copyOfShared ? t.name : `${t.name} (kopie)`, t.exercises)
      .then(() => notify(copyOfShared ? `"${t.name}" staat nu bij je eigen schema's` : `"${t.name}" gedupliceerd`))
      .catch((err) => notify(`${copyOfShared ? "Kopiëren" : "Dupliceren"} mislukt: ${errorMessage(err)}`, { tone: "error" }))
      .finally(() => setBusyId(null));
  }

  const sharedSection = shared.length > 0 && (
    <section className="space-y-3" aria-labelledby="shared-heading">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="shared-heading" className="text-sm font-semibold uppercase tracking-wide text-muted">
          Van je trainer
        </h2>
        <span className="text-xs text-muted">{plural(shared.length, "schema", "schema's")}</span>
      </div>
      {visibleShared.length === 0 ? (
        <p className="text-sm text-muted">Geen gedeelde schema&apos;s voor deze zoekopdracht.</p>
      ) : (
        <ul className="space-y-3">
          {visibleShared.map((t, i) => {
            const gid = groupOf(t);
            return (
              <SharedTemplateCard
                key={t.id}
                template={t}
                index={i}
                owner={owners?.[t.owner_id] || "Je trainer"}
                group={gid ? groupName.get(gid) : undefined}
                canEdit={!!gid && trainerOf.has(gid)}
                busy={busyId === t.id}
                onCopy={() => duplicate(t, true)}
                onPlan={gid && trainerOf.has(gid) ? () => setPlanFor(t) : undefined}
              />
            );
          })}
        </ul>
      )}
    </section>
  );

  return (
    <AppShell
      title="Schema's"
      action={
        <Link href="/templates/new" className="btn-primary min-h-11 px-3.5 text-xs" aria-label="Nieuw schema">
          + Nieuw
        </Link>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-muted">
          {memberOnly ? (
            <>Een schema is een herbruikbare training. Maak er een, of laat de coach er een voor je opzetten en bespreken.</>
          ) : (
            <>
              Een schema is een herbruikbare training. Met <span className="text-ink">Plan deze training</span> zet je het in een
              keer klaar voor je groep, en via <span className="text-ink">Delen met groep</span> zien je leden het hier ook.
            </>
          )}
        </p>

        {memberOnly && shared.length === 0 && templates !== undefined && (
          <div className="animate-fade-up rounded-2xl border border-line bg-surface-2 p-3 text-sm text-muted">
            Plannen voor een groep doet je trainer. Deelt die een schema met je groep, dan zie je het hier onder &quot;Van je
            trainer&quot;. Je eigen schema&apos;s kun je wel bijhouden en met de coach bespreken.
          </div>
        )}

        {templates === undefined ? (
          error ? (
            <div className="card animate-fade-up space-y-3 text-sm" role="alert">
              <p className="font-semibold">Schema&apos;s konden niet geladen worden</p>
              <p className="text-muted">{error}</p>
              <button className="btn-ghost min-h-11 w-full" onClick={retry} disabled={refreshing}>
                {refreshing ? "Bezig…" : "Opnieuw proberen"}
              </button>
            </div>
          ) : (
            <div className="space-y-3" aria-busy aria-label="Schema's laden">
              <div className="skeleton h-40" />
              <div className="skeleton h-40" />
              <div className="skeleton h-40" />
            </div>
          )
        ) : (
          <>
            {error && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-danger/30 py-1 pl-3 pr-1 text-xs text-danger" role="alert">
                <span>Verversen mislukt, je ziet de laatst bekende schema&apos;s.</span>
                <button onClick={retry} disabled={refreshing} className="min-h-11 shrink-0 rounded-lg px-3 font-semibold underline">
                  {refreshing ? "Bezig…" : "Opnieuw"}
                </button>
              </div>
            )}
            {total > 4 && (
              <input
                className="input"
                type="search"
                placeholder="Zoek schema of oefening"
                aria-label="Zoek schema"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}

            {memberOnly && sharedSection}

            {mine.length === 0 ? (
              <div className="card animate-fade-up space-y-4 py-8 text-center">
                <div>
                  <p className="font-semibold">{shared.length ? "Nog geen eigen schema's" : "Nog geen schema's"}</p>
                  <p className="mt-1 text-sm text-muted">
                    {shared.length
                      ? "Kopieer een schema van je trainer om het aan te passen, of maak er zelf een."
                      : 'Maak je eerste, bijvoorbeeld "Push day" of "Legs".'}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <Link href="/templates/new" className="btn-primary min-h-11">
                    Nieuw schema
                  </Link>
                  <Link href={`/coach?q=${encodeURIComponent(COACH_PROMPT)}`} className="btn-ghost min-h-11">
                    <SparkleIcon className="text-accent" /> Laat de coach er een maken
                  </Link>
                </div>
              </div>
            ) : (
              <section className="space-y-3" aria-labelledby="mine-heading">
                {shared.length > 0 && (
                  <h2 id="mine-heading" className="text-sm font-semibold uppercase tracking-wide text-muted">
                    Mijn schema&apos;s
                  </h2>
                )}
                {visibleMine.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted">
                    <p>Geen schema&apos;s gevonden voor &quot;{query.trim()}&quot;.</p>
                    <button className="mt-2 min-h-11 px-3 font-medium text-ink underline" onClick={() => setQuery("")}>
                      Wis zoekopdracht
                    </button>
                  </div>
                ) : (
                  <ul className="space-y-3" aria-label={shared.length ? undefined : "Mijn schema's"}>
                    {visibleMine.map((t, i) => {
                      const gid = groupOf(t);
                      return (
                        <TemplateCard
                          key={t.id}
                          template={t}
                          index={i}
                          busy={busyId === t.id}
                          canPlan={!memberOnly}
                          sharedWith={gid ? (groupName.get(gid) ?? "je groep") : null}
                          onPlan={() => setPlanFor(t)}
                          onDuplicate={() => duplicate(t)}
                        />
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            {!memberOnly && sharedSection}

            {total >= 2 && <WeeklyProgram templates={templates} userId={userId} trainerGroups={trainerGroups} />}
            {mine.length > 0 && (
              <Link href={`/coach?q=${encodeURIComponent(COACH_PROMPT)}`} className="btn-ghost min-h-11 w-full">
                <SparkleIcon className="text-accent" /> Laat de coach een nieuw schema maken
              </Link>
            )}
          </>
        )}
      </div>

      <PlanTemplateSheet template={planFor} onClose={() => setPlanFor(null)} />
    </AppShell>
  );
}

function RegionBar({ template: t }: { template: Template }) {
  const analysis = analyzePlan(t.exercises);
  const regionTotal = Object.values(analysis.regions).reduce((a, b) => a + b, 0);
  if (regionTotal <= 0) return null;
  return (
    <div className="flex h-1.5 gap-px overflow-hidden rounded-full bg-surface-2" aria-hidden>
      {(["push", "pull", "legs", "core"] as const).map((r) =>
        analysis.regions[r] > 0 ? <div key={r} style={{ width: `${(analysis.regions[r] / regionTotal) * 100}%`, background: REGION_COLOR[r] }} /> : null,
      )}
    </div>
  );
}

function TemplateCard({
  template: t,
  index,
  busy,
  canPlan,
  sharedWith,
  onPlan,
  onDuplicate,
}: {
  template: Template;
  index: number;
  busy: boolean;
  canPlan: boolean;
  /** Naam van de groep waarmee dit schema gedeeld is. */
  sharedWith: string | null;
  onPlan: () => void;
  onDuplicate: () => void;
}) {
  const analysis = analyzePlan(t.exercises);
  const top = analysis.groups
    .filter((l) => l.sets >= 2)
    .sort((a, b) => b.sets - a.sets)
    .slice(0, 4);
  const sets = totalSets(t.exercises);
  const metaId = `tpl-meta-${t.id}`;

  return (
    <li className="card animate-fade-up space-y-3 p-0" style={{ "--i": Math.min(index, 8) } as React.CSSProperties}>
      <Link
        href={`/templates/${t.id}`}
        className="block space-y-2 rounded-t-2xl p-4 pb-1 transition-colors hover:bg-surface-2/40"
        aria-describedby={metaId}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 font-semibold leading-tight">
            {t.name}
            <span className="sr-only">, bewerken</span>
          </p>
          <ChevronRightIcon size={16} className="mt-0.5 shrink-0 text-muted" />
        </div>
        <p id={metaId} className="text-xs text-muted">
          {plural(t.exercises.length, "oefening", "oefeningen")} · {plural(sets, "set", "sets")} · ca. {estimateMinutes(t.exercises)} min
          {sharedWith && <span className="sr-only">. Gedeeld met {sharedWith}</span>}
        </p>
        <RegionBar template={t} />
        <p className="line-clamp-2 text-sm text-muted">
          {t.exercises.length === 0 ? "Nog leeg" : t.exercises.map((p) => exName(p.slug)).join(" · ")}
        </p>
        {(top.length > 0 || sharedWith) && (
          <div className="flex flex-wrap gap-1.5">
            {sharedWith && (
              <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 px-2 py-0.5 text-xs font-medium text-accent" aria-hidden>
                <UsersIcon size={12} /> {sharedWith}
              </span>
            )}
            {/*
              De zwaarst belaste spiergroepen van dit schema: de rode plekken op de heatmap. Rode tint
              zoals daar, maar zonder het blokje uit de legenda "Hoofdspier", want het gaat hier om
              belasting en niet om de rol van een spier in een oefening.
            */}
            {top.length > 0 && <span className="sr-only">Meest getraind: </span>}
            {top.map((l) => (
              <MuscleTag key={l.id} swatch={false} title="Meest getrainde spiergroep in dit schema">
                {GROUP_BY_ID[l.id].name}
              </MuscleTag>
            ))}
          </div>
        )}
      </Link>
      <div className="flex gap-2 px-4 pb-4">
        {canPlan ? (
          <button className="btn-primary min-h-11 flex-1 px-3 text-xs" onClick={onPlan} disabled={t.exercises.length === 0}>
            <CalendarIcon size={15} /> Plan deze training
          </button>
        ) : (
          <Link href={coachHref(t, true)} className="btn-primary min-h-11 flex-1 px-3 text-xs">
            <SparkleIcon /> Bespreek met coach
          </Link>
        )}
        <button className="btn-ghost min-h-11 px-3 text-xs" onClick={onDuplicate} disabled={busy}>
          {busy ? "Bezig…" : "Dupliceren"}
        </button>
      </div>
    </li>
  );
}

/** Een schema dat een trainer met je groep deelt: volledig leesbaar, met kopiëren naar je eigen lijst. */
function SharedTemplateCard({
  template: t,
  index,
  owner,
  group,
  canEdit,
  busy,
  onCopy,
  onPlan,
}: {
  template: Template;
  index: number;
  owner: string;
  group?: string;
  canEdit: boolean;
  busy: boolean;
  onCopy: () => void;
  onPlan?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const sets = totalSets(t.exercises);
  const listId = `shared-list-${t.id}`;
  const shown = open ? t.exercises : t.exercises.slice(0, 4);

  return (
    <li
      className="card animate-fade-up space-y-3 border-accent/25"
      style={{ "--i": Math.min(index, 8) } as React.CSSProperties}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-sm font-bold text-accent" aria-hidden>
          {owner.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          {canEdit ? (
            <Link href={`/templates/${t.id}`} className="font-semibold leading-tight hover:underline">
              {t.name}
            </Link>
          ) : (
            <p className="font-semibold leading-tight">{t.name}</p>
          )}
          <p className="mt-0.5 text-xs text-muted">
            Van {owner}
            {group ? ` · ${group}` : ""}
          </p>
        </div>
      </div>
      <p className="text-xs text-muted">
        {plural(t.exercises.length, "oefening", "oefeningen")} · {plural(sets, "set", "sets")} · ca. {estimateMinutes(t.exercises)} min
      </p>
      <RegionBar template={t} />
      <ol id={listId} className="space-y-1 text-sm">
        {shown.map((p, i) => (
          <li key={`${p.slug}-${i}`} className="flex items-baseline gap-2">
            <span className="w-4 shrink-0 text-right text-xs font-bold tabular-nums text-muted">{i + 1}</span>
            <Link href={`/exercises/${p.slug}`} className="min-w-0 flex-1 truncate hover:underline">
              {exName(p.slug)}
            </Link>
            <span className="shrink-0 text-xs tabular-nums text-muted">
              {p.sets}×{p.reps}
            </span>
          </li>
        ))}
      </ol>
      {t.exercises.length > 4 && (
        <button
          className="min-h-11 text-xs font-medium text-muted hover:text-ink"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={listId}
        >
          {open ? "Minder tonen" : `Alle ${t.exercises.length} oefeningen tonen`}
        </button>
      )}
      <div className="flex gap-2">
        <button className="btn-primary min-h-11 flex-1 px-3 text-xs" onClick={onCopy} disabled={busy || t.exercises.length === 0}>
          <ClipboardIcon size={15} /> {busy ? "Bezig…" : "Kopieer naar mijn schema's"}
        </button>
        {onPlan ? (
          <button className="btn-ghost min-h-11 px-3 text-xs" onClick={onPlan} disabled={t.exercises.length === 0}>
            <CalendarIcon size={15} /> Plannen
          </button>
        ) : (
          <Link href={coachHref(t, false)} className="btn-ghost min-h-11 px-3 text-xs" aria-label={`Bespreek ${t.name} met de coach`}>
            <SparkleIcon /> Coach
          </Link>
        )}
      </div>
    </li>
  );
}
