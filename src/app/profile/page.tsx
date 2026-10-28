"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { ChevronRightIcon } from "@/components/Icons";
import { PushToggle } from "@/components/PushToggle";
import { RankBadge } from "@/components/RankBadge";
import { TIERS } from "@/lib/ranks";
import { useRanks } from "@/lib/useRanks";
import { errorMessage, supabase } from "@/lib/supabase";
import { ageFrom } from "@/lib/dates";

export default function ProfilePage() {
  const { session, profile, refreshProfile } = useAuth();
  const router = useRouter();
  const [name, setName] = useState(profile?.display_name ?? "");
  const [bodyweight, setBodyweight] = useState(profile?.bodyweight_kg?.toString() ?? "");
  const [sex, setSex] = useState<"male" | "female" | "">(profile?.sex ?? "");
  const [height, setHeight] = useState(profile?.height_cm?.toString() ?? "");
  const [birthDate, setBirthDate] = useState(profile?.birth_date ?? "");
  const [weeklyGoal, setWeeklyGoal] = useState(profile?.weekly_goal ?? 3);
  const ranks = useRanks(session?.user.id ?? null, profile?.bodyweight_kg ?? null, profile?.sex ?? null, ageFrom(profile?.birth_date));
  const [saved, setSaved] = useState(false);
  const [stats, setStats] = useState<{ sets: number; sessions: number } | null>(null);

  useEffect(() => {
    if (!session) return;
    supabase
      .from("set_logs")
      .select("workout_exercise_id, workout_exercises(workout_id)")
      .eq("user_id", session.user.id)
      .then(({ data }) => {
        const rows = (data ?? []) as unknown as { workout_exercises: { workout_id: string } | null }[];
        setStats({
          sets: rows.length,
          sessions: new Set(rows.map((r) => r.workout_exercises?.workout_id)).size,
        });
      });
  }, [session]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const bw = bodyweight.trim() ? Number(bodyweight.replace(",", ".")) : null;
    if (bw !== null && (Number.isNaN(bw) || bw < 30 || bw > 300)) return alert("Vul een lichaamsgewicht tussen 30 en 300 kg in.");
    const h = height.trim() ? Number(height.replace(",", ".")) : null;
    if (h !== null && (Number.isNaN(h) || h < 100 || h > 250)) return alert("Vul een lengte tussen 100 en 250 cm in.");
    const age = ageFrom(birthDate || null);
    if (birthDate && (age === null || age < 10)) return alert("Controleer je geboortedatum.");
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: name.trim(), bodyweight_kg: bw, sex: sex || null, height_cm: h, birth_date: birthDate || null, weekly_goal: weeklyGoal })
      .eq("id", session!.user.id);
    if (error) return alert(errorMessage(error));
    await refreshProfile();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <AppShell title="Profiel">
      <div className="space-y-5">
        <Link href="/ranks" className="card flex items-center gap-4 hover:border-muted">
          {ranks?.overall ? (
            <RankBadge tierIndex={TIERS.indexOf(ranks.overall.tier)} size={56} glow />
          ) : (
            <RankBadge tierIndex={0} size={56} className="opacity-30 grayscale" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Totaalrang</p>
            <p className="text-xl font-bold" style={ranks?.overall ? { color: ranks.overall.tier.to } : undefined}>
              {ranks?.overall?.tier.name ?? (profile?.bodyweight_kg && profile.sex ? "Nog geen rang" : "Vul je profiel aan")}
            </p>
            {ranks && ranks.ranks.length > 0 && <p className="text-xs text-muted">{ranks.ranks.length} oefeningen met een rang</p>}
          </div>
          <ChevronRightIcon className="text-muted" />
        </Link>

        <div className="grid grid-cols-2 gap-2">
          <Link href="/progress" className="btn-ghost justify-between">
            Progressie <ChevronRightIcon size={16} className="text-muted" />
          </Link>
          <Link href="/templates" className="btn-ghost justify-between">
            Mijn schema&apos;s <ChevronRightIcon size={16} className="text-muted" />
          </Link>
        </div>

        {stats && (
          <div className="grid grid-cols-2 gap-3">
            <div className="card">
              <p className="text-3xl font-extrabold text-accent tabular-nums">{stats.sessions}</p>
              <p className="text-sm text-muted">trainingen</p>
            </div>
            <div className="card">
              <p className="text-3xl font-extrabold text-accent tabular-nums">{stats.sets}</p>
              <p className="text-sm text-muted">sets gelogd</p>
            </div>
          </div>
        )}

        <form onSubmit={save} className="card space-y-3">
          <div>
            <label className="label" htmlFor="dn">Naam (zien je vrienden)</label>
            <input id="dn" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="bw">Lichaamsgewicht (kg)</label>
              <input
                id="bw"
                className="input"
                inputMode="decimal"
                value={bodyweight}
                onChange={(e) => setBodyweight(e.target.value)}
                placeholder="bijv. 78"
              />
            </div>
            <div>
              <span className="label">Geslacht</span>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-2 p-1">
                {(["male", "female"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setSex(v)}
                    className={`rounded-lg py-1.5 text-sm font-medium transition ${sex === v ? "bg-accent text-accent-ink" : "text-muted"}`}
                  >
                    {v === "male" ? "Man" : "Vrouw"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="height">Lengte (cm)</label>
              <input
                id="height"
                className="input"
                inputMode="decimal"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                placeholder="bijv. 182"
              />
            </div>
            <div>
              <label className="label" htmlFor="birth">
                Geboortedatum{ageFrom(birthDate || null) != null && <span className="normal-case"> · {ageFrom(birthDate)} jaar</span>}
              </label>
              <input
                id="birth"
                type="date"
                className="input"
                value={birthDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </div>
          </div>
          {bodyweight && height && Number(height) > 0 && (
            <p className="text-xs text-muted">
              BMI:{" "}
              <span className="text-ink">
                {(Number(bodyweight.replace(",", ".")) / (Number(height.replace(",", ".")) / 100) ** 2).toLocaleString("nl-NL", {
                  maximumFractionDigits: 1,
                })}
              </span>{" "}
              (bij gespierde sporters zegt BMI weinig)
            </p>
          )}
          <div>
            <span className="label">Weekdoel (trainingen per week)</span>
            <div className="grid grid-cols-7 gap-1 rounded-xl border border-line bg-surface-2 p-1">
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setWeeklyGoal(n)}
                  className={`rounded-lg py-1.5 text-sm font-semibold tabular-nums transition ${weeklyGoal === n ? "bg-accent text-accent-ink" : "text-muted"}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted">
            Gewicht, geslacht en leeftijd worden gebruikt voor je ranks: je kracht wordt vergeleken met mensen van
            hetzelfde geslacht, gewicht en dezelfde leeftijd. Groepsleden zien je rang op de ranglijst.
          </p>
          <p className="text-sm text-muted">{session?.user.email}</p>
          <button className="btn-primary w-full" disabled={!name.trim()}>
            {saved ? "Opgeslagen" : "Opslaan"}
          </button>
        </form>

        <PushToggle />

        <div className="card space-y-2 text-sm text-muted">
          <p className="font-semibold text-ink">Als app op je telefoon</p>
          <p>iPhone: open de app in Safari, tik op de deelknop en kies “Zet op beginscherm”.</p>
          <p>Android: open het menu in Chrome en kies “App installeren” of “Toevoegen aan startscherm”.</p>
        </div>

        <button className="btn-danger w-full" onClick={logout}>
          Uitloggen
        </button>
      </div>
    </AppShell>
  );
}
