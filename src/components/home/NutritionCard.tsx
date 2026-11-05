"use client";

import Link from "next/link";
import { ChevronRightIcon, FlameIcon } from "@/components/Icons";
import { MACRO_COLORS } from "@/components/nutrition/MacroSummary";
import { toISODate } from "@/lib/dates";
import { computeTargets, type NutritionProfile } from "@/lib/nutrition/targets";
import { supabase } from "@/lib/supabase";
import { addDays, parseISODate } from "@/lib/week";

const MACROS = [
  ["protein", "Eiwit"],
  ["carbs", "Koolh."],
  ["fat", "Vet"],
] as const;

export type FoodRow = { date: string; kcal: number; protein: number; carbs: number; fat: number; planned: boolean };

/** Je eigen eten (RLS) van de afgelopen 7 dagen: vandaag voor de kaart, de rest om te zien of je voeding bijhoudt. */
export async function fetchFoodWeek(today: string): Promise<FoodRow[]> {
  const from = toISODate(addDays(parseISODate(today), -6));
  const { data, error } = await supabase
    .from("food_logs")
    .select("date, kcal, protein, carbs, fat, planned")
    .gte("date", from)
    .lte("date", today)
    .limit(1000);
  if (error) throw error;
  const n = (v: unknown) => (v == null ? 0 : Number(v));
  return (data ?? []).map((r) => ({
    date: String(r.date),
    kcal: n(r.kcal),
    protein: n(r.protein),
    carbs: n(r.carbs),
    fat: n(r.fat),
    planned: !!r.planned,
  }));
}

const pct = (value: number, target: number) => (target > 0 ? Math.min(100, (value / target) * 100) : 0);
const fmt = (n: number) => Math.round(n).toLocaleString("nl-NL");
const BAR = "width 0.8s cubic-bezier(0.2,0.8,0.2,1)";

/**
 * Voeding van vandaag (alleen zichtbaar voor jou). Wie de afgelopen week niets logde, krijgt één
 * rustige regel in plaats van een kaart met nullen; zolang dat nog niet bekend is, staat er een
 * skeleton van die regel (de meeste mensen loggen geen eten), zodat de pagina niet verspringt.
 */
export function NutritionCard({
  week,
  failed,
  today,
  profile,
}: {
  week: FoodRow[] | undefined;
  failed: boolean;
  today: string;
  profile: NutritionProfile | null;
}) {
  if (!week) {
    if (!failed) return <div className="skeleton h-[62px]" aria-label="Voeding laden" />;
    return <CompactRow title="Voeding" text="Nog niet geladen. Dit verschijnt zodra je verbinding hebt." />;
  }

  // De bewaarde week kan van gisteren zijn: zelf op datum filteren. Gepland eten telt pas mee als het bevestigd is.
  const weekAgo = toISODate(addDays(parseISODate(today), -6));
  if (!week.some((l) => l.date >= weekAgo && l.date <= today)) {
    return <CompactRow title="Voeding bijhouden" text="Calorieën en macro's, alleen zichtbaar voor jou" />;
  }

  const food = week.filter((l) => l.date === today);
  const eaten = food
    .filter((l) => !l.planned)
    .reduce((a, l) => ({ kcal: a.kcal + l.kcal, protein: a.protein + l.protein, carbs: a.carbs + l.carbs, fat: a.fat + l.fat }), {
      kcal: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
  const plannedToday = food.filter((l) => l.planned).length;
  const targets = computeTargets(profile);
  const over = !!targets && targets.kcal > 0 && eaten.kcal > targets.kcal;

  return (
    <Link href="/nutrition" className="card animate-fade-up block space-y-3 hover:border-muted" aria-label="Voeding vandaag, naar voeding">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">Voeding vandaag</p>
        <span className="flex items-center gap-2">
          {plannedToday > 0 && (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">{plannedToday} te bevestigen</span>
          )}
          <ChevronRightIcon className="text-muted" />
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-extrabold tabular-nums">{fmt(eaten.kcal)}</span>
        <span className="text-sm text-muted">{targets ? <>/ {fmt(targets.kcal)} kcal</> : "kcal"}</span>
        {targets && targets.kcal > 0 && (
          <span className="ml-auto text-xs tabular-nums text-muted">
            {over ? `${fmt(eaten.kcal - targets.kcal)} boven doel` : `nog ${fmt(targets.kcal - eaten.kcal)}`}
          </span>
        )}
      </div>
      {targets ? (
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            className={`h-full rounded-full ${over ? "bg-warn" : "bg-accent"}`}
            style={{ width: `${pct(eaten.kcal, targets.kcal)}%`, transition: BAR }}
          />
        </div>
      ) : (
        <p className="text-xs text-muted">Vul je profiel aan voor een persoonlijk dagdoel.</p>
      )}
      <div className="grid grid-cols-3 gap-3">
        {MACROS.map(([k, label]) => (
          <div key={k} className="space-y-1">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted">{label}</span>
              <span className="font-semibold tabular-nums">
                {Math.round(eaten[k])}
                {targets && targets[k] > 0 && <span className="font-normal text-muted">/{targets[k]}</span>}g
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full"
                style={{ width: `${targets ? pct(eaten[k], targets[k]) : 0}%`, background: MACRO_COLORS[k], transition: BAR }}
              />
            </div>
          </div>
        ))}
      </div>
    </Link>
  );
}

function CompactRow({ title, text }: { title: string; text: string }) {
  return (
    <Link href="/nutrition" className="card animate-fade-in flex min-h-[62px] items-center gap-3 py-3 hover:border-muted">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
        <FlameIcon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted">{text}</span>
      </span>
      <ChevronRightIcon className="shrink-0 text-muted" />
    </Link>
  );
}
