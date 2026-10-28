"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ACTIVITY, computeTargets, GOALS, type ActivityLevel, type NutritionGoal, type NutritionProfile } from "@/lib/nutrition/targets";
import { errorMessage, supabase } from "@/lib/supabase";

const nl = (n: number) => Math.round(n).toLocaleString("nl-NL");

/** Activiteit, doel en (optioneel) eigen dagdoelen. */
export function NutritionSettings() {
  const { profile, session, refreshProfile } = useAuth();
  const p = profile as NutritionProfile | null;
  const [activity, setActivity] = useState<ActivityLevel>(p?.activity_level ?? "moderate");
  const [goal, setGoal] = useState<NutritionGoal>(p?.nutrition_goal ?? "maintain");
  const [manual, setManual] = useState(p?.kcal_target != null);
  const [custom, setCustom] = useState({
    kcal: p?.kcal_target?.toString() ?? "",
    protein: p?.protein_target?.toString() ?? "",
    carbs: p?.carbs_target?.toString() ?? "",
    fat: p?.fat_target?.toString() ?? "",
  });
  const [saved, setSaved] = useState(false);

  const toInt = (s: string) => (s.trim() ? Math.round(Number(s.replace(",", "."))) : null);
  const preview = computeTargets(
    p && {
      ...p,
      activity_level: activity,
      nutrition_goal: goal,
      kcal_target: manual ? toInt(custom.kcal) : null,
      protein_target: manual ? toInt(custom.protein) : null,
      carbs_target: manual ? toInt(custom.carbs) : null,
      fat_target: manual ? toInt(custom.fat) : null,
    },
  );

  async function save() {
    const { error } = await supabase
      .from("profiles")
      .update({
        activity_level: activity,
        nutrition_goal: goal,
        kcal_target: manual ? toInt(custom.kcal) : null,
        protein_target: manual ? toInt(custom.protein) : null,
        carbs_target: manual ? toInt(custom.carbs) : null,
        fat_target: manual ? toInt(custom.fat) : null,
      })
      .eq("id", session!.user.id);
    if (error) return alert(errorMessage(error));
    await refreshProfile();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <section id="voeding" className="card scroll-mt-20 space-y-4">
      <div>
        <h2 className="font-bold">Voeding</h2>
        <p className="text-xs text-muted">Je dagdoel wordt berekend uit je gewicht, lengte, leeftijd en geslacht (Mifflin-St Jeor).</p>
      </div>

      <div>
        <span className="label">Activiteit</span>
        <div className="grid grid-cols-1 gap-1">
          {ACTIVITY.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setActivity(a.id)}
              className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
                activity === a.id ? "border-accent bg-accent/10" : "border-line hover:border-muted"
              }`}
            >
              <span className={activity === a.id ? "font-semibold text-accent" : ""}>{a.label}</span>
              <span className="text-xs text-muted">{a.detail}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label">Doel</span>
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-surface-2 p-1">
          {GOALS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGoal(g.id)}
              className={`rounded-lg px-1 py-1.5 text-xs font-semibold transition ${goal === g.id ? "bg-accent text-accent-ink" : "text-muted"}`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">{GOALS.find((g) => g.id === goal)?.detail}</p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
        Eigen doelen instellen (bijv. van een diëtist)
      </label>
      {manual && (
        <div className="grid grid-cols-4 gap-2">
          {(
            [
              ["kcal", "kcal"],
              ["protein", "Eiwit g"],
              ["carbs", "Koolh. g"],
              ["fat", "Vet g"],
            ] as const
          ).map(([k, label]) => (
            <div key={k}>
              <input
                className="input px-2 text-center tabular-nums"
                inputMode="numeric"
                value={custom[k]}
                onChange={(e) => setCustom({ ...custom, [k]: e.target.value })}
                placeholder="auto"
                aria-label={label}
              />
              <p className="mt-1 text-center text-[10px] uppercase tracking-wide text-muted">{label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl bg-surface-2 p-3 text-sm">
        {preview ? (
          <>
            <p>
              <span className="font-bold tabular-nums">{nl(preview.kcal)} kcal</span>
              <span className="text-muted">
                {" "}
                · eiwit {nl(preview.protein)} g · koolh. {nl(preview.carbs)} g · vet {nl(preview.fat)} g
              </span>
            </p>
            {preview.bmr && preview.tdee && (
              <p className="mt-1 text-xs text-muted">
                Rustverbruik {nl(preview.bmr)} kcal · dagelijks verbruik {nl(preview.tdee)} kcal
              </p>
            )}
          </>
        ) : (
          <p className="text-muted">Vul hierboven je gewicht, lengte, geboortedatum en geslacht in (en sla op) om je dagdoel te zien.</p>
        )}
      </div>

      <button type="button" className="btn-primary w-full" onClick={save}>
        {saved ? "Opgeslagen" : "Voedingsdoelen opslaan"}
      </button>
    </section>
  );
}
