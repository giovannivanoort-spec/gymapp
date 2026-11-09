"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { analyzePlan } from "@/lib/analysis";
import { useCachedState } from "@/lib/cache";
import { formatDate, toISODate } from "@/lib/dates";
import type { MyGroup } from "@/lib/groups";
import { GROUP_BY_ID } from "@/lib/muscles";
import { supabase } from "@/lib/supabase";
import { planTemplateHref } from "@/lib/templates";
import type { Template } from "@/lib/types";
import { WEEKLY_SETS_MAX, WEEKLY_SETS_MIN, volumeStatus, type VolumeStatus } from "@/lib/week";
import { CalendarIcon, CheckIcon, ChevronRightIcon } from "../Icons";

/** Oude, apparaatbrede sleutel (alleen gekozen schema's). Wordt eenmalig overgenomen. */
const LEGACY_STORE = "gymapp-weekprogram:v1";
const storeKey = (userId: string) => `gymapp-weekprogram:v2:${userId}`;

const DAYS = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
const DAY_NAMES = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];

/** Statuskleuren tegen het doel van 10-20 sets per week; bewust niet de spierkleuren (MUSCLE_COLOR). */
const STATUS: Record<VolumeStatus, { label: string; text: string; bar: string }> = {
  low: { label: "te weinig", text: "text-muted", bar: "bg-muted/70" },
  good: { label: "goed", text: "text-accent", bar: "bg-accent" },
  high: { label: "veel", text: "text-warn", bar: "bg-warn" },
};

/** Gekozen schema's en per schema de weekdagen (0 = maandag). */
type Program = { ids: string[]; days: Record<string, number[]> };

function readProgram(userId: string): Program | null {
  try {
    const raw = localStorage.getItem(storeKey(userId));
    if (raw) {
      const p = JSON.parse(raw) as Partial<Program>;
      return { ids: Array.isArray(p.ids) ? p.ids : [], days: p.days && typeof p.days === "object" ? p.days : {} };
    }
    const legacy = localStorage.getItem(LEGACY_STORE);
    if (legacy) return { ids: JSON.parse(legacy) as string[], days: {} };
  } catch {
    // geen opslag: standaardkeuze
  }
  return null;
}

function writeProgram(userId: string, p: Program) {
  try {
    localStorage.setItem(storeKey(userId), JSON.stringify(p));
  } catch {
    // alleen voor deze sessie
  }
}

const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7;

type PlannedRow = { id: string; date: string; title: string };

/**
 * Weekprogramma: kies de schema's die je in een week doet en zet ze op weekdagen. Per spiergroep zie
 * je of je per week tussen de 10 en 20 sets uitkomt (een schema op twee dagen telt twee keer).
 * Trainers kunnen de komende 7 dagen in een keer voor hun groep inplannen.
 */
export function WeeklyProgram({
  templates,
  userId,
  trainerGroups,
}: {
  templates: Template[];
  userId: string;
  /** Groepen waarvan je trainer bent; met minstens een groep verschijnt "Plan deze week". */
  trainerGroups?: MyGroup[];
}) {
  const [stored, setStored] = useState<Program | null>(() => (typeof window === "undefined" ? null : readProgram(userId)));
  const ids = new Set(templates.map((t) => t.id));
  const program: Program = stored ?? { ids: templates.slice(0, 3).map((t) => t.id), days: {} };
  const selected = program.ids.filter((id) => ids.has(id));
  const chosen = templates.filter((t) => selected.includes(t.id));
  const daysOf = (id: string) => (program.days[id] ?? []).filter((d) => d >= 0 && d < 7);

  // Goedkope berekening (een paar schema's), dus gewoon per render.
  const { groups } = analyzePlan(chosen.flatMap((t) => Array.from({ length: Math.max(1, daysOf(t.id).length) }, () => t.exercises).flat()));
  const rows = groups.filter((g) => GROUP_BY_ID[g.id].major || g.sets > 0).sort((a, b) => b.sets - a.sets);
  const scale = Math.max(25, Math.ceil(Math.max(0, ...rows.map((g) => g.sets)) / 5) * 5);

  function save(next: Program) {
    setStored(next);
    writeProgram(userId, next);
  }

  function toggle(id: string) {
    save({ ...program, ids: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] });
  }

  function toggleDay(id: string, day: number) {
    const cur = daysOf(id);
    const next = cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day].sort((a, b) => a - b);
    save({ ...program, days: { ...program.days, [id]: next } });
  }

  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const major = rows.filter((g) => GROUP_BY_ID[g.id].major);
  const inBand = major.filter((g) => volumeStatus(g.sets) === "good").length;
  const low = major.filter((g) => volumeStatus(g.sets) === "low").map((g) => GROUP_BY_ID[g.id].name);
  const scheduled = chosen.some((t) => daysOf(t.id).length > 0);

  return (
    <section className="space-y-3" aria-labelledby="week-program">
      <h2 id="week-program" className="text-sm font-semibold uppercase tracking-wide text-muted">
        Weekprogramma
      </h2>
      <div className="card space-y-4">
        <p className="text-sm text-muted">
          Kies de schema&apos;s die je in een week doet en zet ze op een dag. Per spiergroep zie je of je tussen{" "}
          {WEEKLY_SETS_MIN} en {WEEKLY_SETS_MAX} sets per week uitkomt.
        </p>
        <div className="flex flex-wrap gap-x-1.5" role="group" aria-label="Schema's in de week">
          {templates.map((t) => {
            const on = selected.includes(t.id);
            return (
              <button key={t.id} onClick={() => toggle(t.id)} aria-pressed={on} className="group flex min-h-11 max-w-full items-center active:scale-95">
                <span
                  className={`flex h-9 max-w-full items-center truncate rounded-full border px-3.5 text-xs font-medium transition-colors ${
                    on ? "border-accent bg-accent text-accent-ink" : "border-line text-muted group-hover:text-ink"
                  }`}
                >
                  <span className="truncate">{t.name}</span>
                </span>
              </button>
            );
          })}
        </div>

        {chosen.length > 0 && (
          <ul className="space-y-3 border-t border-line pt-3" aria-label="Dagen per schema">
            {chosen.map((t) => {
              const days = daysOf(t.id);
              return (
                <li key={t.id} className="space-y-1">
                  <p className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate font-medium">{t.name}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {days.length === 0 ? "nog geen dag" : days.length === 1 ? "1x per week" : `${days.length}x per week`}
                    </span>
                  </p>
                  <div className="grid grid-cols-7 gap-1" role="group" aria-label={`Dagen voor ${t.name}`}>
                    {DAYS.map((d, i) => {
                      const on = days.includes(i);
                      return (
                        <button
                          key={d}
                          onClick={() => toggleDay(t.id, i)}
                          aria-pressed={on}
                          aria-label={`${t.name} op ${DAY_NAMES[i]}`}
                          className={`min-h-11 rounded-xl border text-xs font-semibold transition-colors active:scale-95 ${
                            on ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink"
                          }`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {chosen.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted">Kies minstens een schema.</p>
        ) : (
          <>
            <p className="text-xs text-muted">
              <span className="text-base font-extrabold tabular-nums text-ink">{inBand}</span> van {major.length} grote
              spiergroepen in bereik
              {low.length > 0 && low.length <= 4 ? `. Te weinig: ${low.join(", ")}.` : "."}
            </p>
            <div>
              <div className="relative h-4 text-[10px] font-medium tabular-nums text-muted sm:ml-[9.5rem] sm:mr-10" aria-hidden>
                <span className="absolute -translate-x-1/2" style={{ left: pct(WEEKLY_SETS_MIN) }}>
                  {WEEKLY_SETS_MIN}
                </span>
                <span className="absolute -translate-x-1/2" style={{ left: pct(WEEKLY_SETS_MAX) }}>
                  {WEEKLY_SETS_MAX}
                </span>
              </div>
              <ul className="space-y-2.5">
                {rows.map((g) => {
                  const st = volumeStatus(g.sets);
                  const s = STATUS[st];
                  const empty = g.sets === 0;
                  return (
                    <li key={g.id} className="sm:grid sm:grid-cols-[9rem_1fr] sm:items-center sm:gap-2">
                      <div className="mb-1 flex items-baseline gap-2 text-sm sm:mb-0">
                        <span className={`min-w-0 flex-1 truncate font-medium ${empty ? "text-muted" : ""}`}>
                          {GROUP_BY_ID[g.id].name}
                        </span>
                        <span className="tabular-nums font-semibold sm:hidden">{fmt(g.sets)}</span>
                        <span className={`w-16 shrink-0 text-right text-[11px] font-semibold sm:hidden ${empty ? "text-muted/70" : s.text}`}>
                          {s.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className="absolute inset-y-0 bg-accent/10"
                            style={{ left: pct(WEEKLY_SETS_MIN), width: `calc(${pct(WEEKLY_SETS_MAX)} - ${pct(WEEKLY_SETS_MIN)})` }}
                          />
                          {!empty && <div className={`relative h-full rounded-full ${s.bar}`} style={{ width: pct(g.sets) }} />}
                        </div>
                        <span className="hidden w-8 text-right text-xs tabular-nums text-muted sm:block">{fmt(g.sets)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <p className="text-xs text-muted">
              Een spier die meehelpt telt als een halve set. Een schema op meerdere dagen telt per dag mee. Het bereik is een
              richtlijn, geen harde grens.
            </p>
          </>
        )}
      </div>

      {scheduled && trainerGroups && trainerGroups.length > 0 && (
        <PlanWeek templates={chosen} daysOf={daysOf} groups={trainerGroups} />
      )}
    </section>
  );
}

/** De komende 7 dagen met de schema's die erop staan, per dag in een tik in te plannen voor de groep. */
function PlanWeek({ templates, daysOf, groups }: { templates: Template[]; daysOf: (id: string) => number[]; groups: MyGroup[] }) {
  const [groupId, setGroupId] = useState<string | null>(null);
  const group = groups.find((g) => g.id === groupId) ?? groups[0];

  const days = useMemo(() => {
    const out: { iso: string; weekday: number }[] = [];
    const d = new Date();
    for (let i = 0; i < 7; i++) {
      out.push({ iso: toISODate(d), weekday: weekdayIndex(d) });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, []);
  const from = days[0].iso;
  const to = days[6].iso;

  // Wat er de komende week al gepland staat, zodat je niets dubbel inplant.
  const planned = useCachedState<PlannedRow[]>(
    `weekplan:${group.id}:${from}`,
    async () => {
      const { data, error } = await supabase.from("workouts").select("id, date, title").eq("group_id", group.id).gte("date", from).lte("date", to);
      if (error) throw error;
      return (data ?? []) as PlannedRow[];
    },
    { maxAge: 15_000 },
  );

  const slots = days.flatMap((d) => templates.filter((t) => daysOf(t.id).includes(d.weekday)).map((t) => ({ ...d, template: t })));
  const isPlanned = (iso: string, name: string) =>
    planned.data?.find((w) => w.date === iso && w.title.trim().toLowerCase() === name.trim().toLowerCase());
  const open = slots.filter((s) => !isPlanned(s.iso, s.template.name)).length;

  return (
    <div className="card animate-fade-up space-y-3">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent" aria-hidden>
          <CalendarIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Plan deze week</p>
          <p className="text-xs text-muted">
            {slots.length === 0
              ? "In de komende 7 dagen staat nog niets op een dag."
              : planned.data === undefined
                ? "De komende 7 dagen volgens je weekprogramma."
                : open === 0
                  ? "Alles voor de komende 7 dagen staat gepland."
                  : `Nog ${open} ${open === 1 ? "training" : "trainingen"} te plannen voor ${group.name}.`}
          </p>
        </div>
      </div>

      {groups.length > 1 && (
        <div className="flex flex-wrap gap-x-1.5" role="group" aria-label="Groep">
          {groups.map((g) => (
            <button key={g.id} onClick={() => setGroupId(g.id)} aria-pressed={g.id === group.id} className="group flex min-h-11 items-center active:scale-95">
              <span
                className={`flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors ${
                  g.id === group.id ? "border-accent text-accent" : "border-line text-muted group-hover:text-ink"
                }`}
              >
                {g.name}
              </span>
            </button>
          ))}
        </div>
      )}

      {planned.error !== null && planned.data === undefined && (
        <p className="text-xs text-muted">Kon niet controleren wat er al gepland staat.</p>
      )}

      {slots.length > 0 && (
        <ul className="divide-y divide-line">
          {slots.map((s) => {
            const done = isPlanned(s.iso, s.template.name);
            const label = formatDate(s.iso, { weekday: "short", day: "numeric", month: "short" });
            return (
              <li key={`${s.iso}:${s.template.id}`}>
                {done ? (
                  <Link href={`/workouts/${done.id}`} className="-mx-2 flex min-h-12 items-center gap-3 rounded-lg px-2 hover:bg-surface-2/60">
                    <span className="w-20 shrink-0 text-xs capitalize text-muted">{label}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{s.template.name}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-accent">
                      <CheckIcon size={14} /> Gepland
                    </span>
                  </Link>
                ) : (
                  <Link
                    href={planTemplateHref(group.id, s.iso, s.template.id)}
                    className="-mx-2 flex min-h-12 items-center gap-3 rounded-lg px-2 hover:bg-surface-2/60"
                    aria-label={`${s.template.name} plannen op ${label} voor ${group.name}`}
                  >
                    <span className="w-20 shrink-0 text-xs capitalize text-muted">{label}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.template.name}</span>
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-ink">
                      Plannen <ChevronRightIcon size={14} />
                    </span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted">Elke training opent ingevuld; je kunt nog alles aanpassen voordat je opslaat.</p>
    </div>
  );
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
