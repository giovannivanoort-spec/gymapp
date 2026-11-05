"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { invalidateNutrition } from "@/lib/nutrition/log";
import { fmt, parseAmount } from "@/lib/nutrition/format";
import {
  ACTIVITY,
  computeTargets,
  GOALS,
  TARGET_LIMITS,
  type ActivityLevel,
  type NutritionGoal,
  type NutritionProfile,
} from "@/lib/nutrition/targets";
import { errorMessage, supabase } from "@/lib/supabase";

type Key = keyof typeof TARGET_LIMITS;
const KEYS: { k: Key; label: string }[] = [
  { k: "kcal", label: "kcal" },
  { k: "protein", label: "Eiwit g" },
  { k: "carbs", label: "Koolh. g" },
  { k: "fat", label: "Vet g" },
];

/** Activiteit, doel en (optioneel) eigen dagdoelen. */
export function NutritionSettings() {
  const { profile } = useAuth();
  // Pas tonen als het profiel er is: anders zou opslaan de echte instellingen overschrijven met de standaardwaarden.
  if (!profile) {
    return (
      <section id="voeding" className="card scroll-mt-20 space-y-3" aria-busy>
        <h2 className="font-bold">Voeding</h2>
        <div className="skeleton h-40" />
        <div className="skeleton h-11" />
      </section>
    );
  }
  return <SettingsForm key={profile.id} profile={profile as NutritionProfile} />;
}

function SettingsForm({ profile: p }: { profile: NutritionProfile }) {
  const { session, refreshProfile } = useAuth();
  const [activity, setActivity] = useState<ActivityLevel>(p.activity_level ?? "moderate");
  const [goal, setGoal] = useState<NutritionGoal>(p.nutrition_goal ?? "maintain");
  const [manual, setManual] = useState(p.kcal_target != null || p.protein_target != null || p.carbs_target != null || p.fat_target != null);
  const [custom, setCustom] = useState<Record<Key, string>>({
    kcal: p.kcal_target?.toString() ?? "",
    protein: p.protein_target?.toString() ?? "",
    carbs: p.carbs_target?.toString() ?? "",
    fat: p.fat_target?.toString() ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toInt = (s: string) => {
    const n = parseAmount(s);
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  /** Foutmelding per veld (leeg = automatisch, dat is altijd goed). */
  const fieldError = (k: Key): string | null => {
    if (!manual || !custom[k].trim()) return null;
    const n = toInt(custom[k]);
    const { min, max } = TARGET_LIMITS[k];
    if (n == null) return "Vul een getal in";
    if (n < min || n > max) return `Tussen ${fmt(min)} en ${fmt(max)}`;
    return null;
  };
  const errors = KEYS.map(({ k }) => fieldError(k));
  const invalid = errors.some(Boolean);
  const value = (k: Key) => (manual && !fieldError(k) ? toInt(custom[k]) : null);

  const preview = computeTargets({
    ...p,
    activity_level: activity,
    nutrition_goal: goal,
    kcal_target: value("kcal"),
    protein_target: value("protein"),
    carbs_target: value("carbs"),
    fat_target: value("fat"),
  });

  async function save() {
    if (invalid || busy || !session) return;
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          activity_level: activity,
          nutrition_goal: goal,
          kcal_target: value("kcal"),
          protein_target: value("protein"),
          carbs_target: value("carbs"),
          fat_target: value("fat"),
        })
        .eq("id", session.user.id);
      if (error) throw error;
      await refreshProfile();
      invalidateNutrition();
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="voeding" className="card scroll-mt-20 space-y-4">
      <div>
        <h2 className="font-bold">Voeding</h2>
        <p className="text-xs text-muted">Je dagdoel wordt berekend uit je gewicht, lengte, leeftijd en geslacht (Mifflin-St Jeor).</p>
      </div>

      <div>
        <span className="label" id="ns-activity">Activiteit</span>
        <div className="grid grid-cols-1 gap-1" role="radiogroup" aria-labelledby="ns-activity">
          {ACTIVITY.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={activity === a.id}
              onClick={() => setActivity(a.id)}
              className={`flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${
                activity === a.id ? "border-accent bg-accent/10" : "border-line hover:border-muted"
              }`}
            >
              <span className={`shrink-0 ${activity === a.id ? "font-semibold text-accent" : ""}`}>{a.label}</span>
              <span className="text-right text-xs text-muted">{a.detail}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label" id="ns-goal">Doel</span>
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-surface-2 p-1" role="radiogroup" aria-labelledby="ns-goal">
          {GOALS.map((g) => (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={goal === g.id}
              onClick={() => setGoal(g.id)}
              className={`min-h-11 truncate rounded-lg px-1 py-2.5 text-xs font-semibold transition ${goal === g.id ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">{GOALS.find((g) => g.id === goal)?.detail}</p>
      </div>

      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} className="h-5 w-5 shrink-0 accent-[var(--color-accent)]" />
        Eigen doelen instellen (bijv. van een diëtist)
      </label>
      {manual && (
        <div className="animate-fade-up space-y-1">
          <div className="grid grid-cols-4 gap-2">
            {KEYS.map(({ k, label }, i) => (
              <div key={k}>
                <input
                  className={`input px-2 text-center tabular-nums ${errors[i] ? "border-danger focus:border-danger" : ""}`}
                  inputMode="numeric"
                  value={custom[k]}
                  onChange={(e) => setCustom({ ...custom, [k]: e.target.value })}
                  placeholder="auto"
                  aria-label={label}
                  aria-invalid={!!errors[i]}
                  aria-describedby={errors[i] ? `ns-err-${k}` : undefined}
                />
                <p className="mt-1 text-center text-[10px] uppercase tracking-wide text-muted">{label}</p>
                {errors[i] && (
                  <p id={`ns-err-${k}`} className="text-center text-[10px] leading-tight text-danger">
                    {errors[i]}
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted">Laat een veld leeg om die waarde automatisch te laten berekenen.</p>
        </div>
      )}

      <div className="rounded-xl bg-surface-2 p-3 text-sm" aria-live="polite">
        {preview ? (
          <>
            <p>
              <span className="font-bold tabular-nums">{fmt(preview.kcal)} kcal</span>
              <span className="text-muted">
                {" "}
                · eiwit {fmt(preview.protein)} g · koolh. {fmt(preview.carbs)} g · vet {fmt(preview.fat)} g
              </span>
            </p>
            {preview.bmr && preview.tdee && (
              <p className="mt-1 text-xs text-muted">
                Rustverbruik {fmt(preview.bmr)} kcal · dagelijks verbruik {fmt(preview.tdee)} kcal
              </p>
            )}
          </>
        ) : (
          <p className="text-muted">Vul hierboven je gewicht, lengte, geboortedatum en geslacht in (en sla op) om je dagdoel te zien.</p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <button type="button" className="btn-primary w-full" onClick={save} disabled={busy || invalid}>
        {busy ? "Opslaan…" : saved ? "Opgeslagen" : "Voedingsdoelen opslaan"}
      </button>
    </section>
  );
}
