"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { signOut, useAuth } from "@/components/AuthProvider";
import { usePersonSummary } from "@/components/FriendCard";
import { CheckIcon, ChevronRightIcon, DownloadIcon, UsersIcon } from "@/components/Icons";
import { NutritionSettings } from "@/components/nutrition/NutritionSettings";
import { NotificationSettings } from "@/components/platform/NotificationSettings";
import { StorageSettings } from "@/components/platform/StorageSettings";
import { PushToggle, removePushSubscription } from "@/components/PushToggle";
import { RankBadge } from "@/components/RankBadge";
import { NewPasswordForm } from "@/components/shell/NewPasswordForm";
import { Sheet } from "@/components/Sheet";
import { deleteMyAccount, downloadMyData } from "@/components/social/account";
import { AvatarPicker } from "@/components/social/AvatarPicker";
import { ConfirmSheet } from "@/components/social/ConfirmSheet";
import { DeleteAccountSheet } from "@/components/social/DeleteAccountSheet";
import { FriendCode, showFlashToast, useFlash } from "@/components/social/FriendCode";
import { KeyIcon, LogoutIcon, PhoneIcon, ProgressIcon, RetryIcon } from "@/components/social/icons";
import { Segmented } from "@/components/social/Segmented";
import { toast } from "@/components/ui/Toast";
import { deleteAvatarFiles, removeAvatar } from "@/lib/avatars";
import { ageFrom, toISODate } from "@/lib/dates";
import {
  friendErrorMessage,
  regenerateFriendCode,
  useFriends,
  useFriendsRealtime,
  useMyFriendCode,
  type FriendProfile,
} from "@/lib/friends";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

type Fields = {
  name: string;
  bodyweight: string;
  sex: "male" | "female" | "";
  height: string;
  birthDate: string;
  weeklyGoal: number;
};
type FieldErrors = Partial<Record<"name" | "bodyweight" | "height" | "birthDate" | "form", string>>;

function fromProfile(p: Profile | null): Fields {
  return {
    name: p?.display_name ?? "",
    bodyweight: p?.bodyweight_kg != null ? String(p.bodyweight_kg).replace(".", ",") : "",
    sex: p?.sex ?? "",
    height: p?.height_cm != null ? String(p.height_cm).replace(".", ",") : "",
    birthDate: p?.birth_date ?? "",
    weeklyGoal: p?.weekly_goal ?? 3,
  };
}

/** "78,5" of "78.5" → 78.5; leeg → null; ongeldig → NaN. */
function parseNum(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

export default function ProfilePage() {
  const { session, profile, refreshProfile } = useAuth();
  const router = useRouter();
  const userId = session?.user.id ?? null;
  const me = profile as FriendProfile | null;
  const summary = usePersonSummary(me);
  const friends = useFriends(userId);
  useFriendsRealtime(userId);
  const friendCode = useMyFriendCode(userId, me?.friend_code);

  // Alleen gewijzigde velden staan in `draft`; de rest volgt het (op de achtergrond verversende) profiel.
  const base = fromProfile(profile);
  const [draft, setDraft] = useState<Partial<Fields>>({});
  const f: Fields = { ...base, ...draft };
  const dirty = (Object.keys(draft) as (keyof Fields)[]).some((k) => draft[k] !== base[k]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saved, showSaved] = useFlash(1800);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  function update<K extends keyof Fields>(key: K, value: Fields[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    if (errors[key as keyof FieldErrors] || errors.form) setErrors((e) => ({ ...e, [key]: undefined, form: undefined }));
  }

  const bw = parseNum(f.bodyweight);
  const h = parseNum(f.height);
  const age = ageFrom(f.birthDate || null);
  const bmi = bw != null && h != null && bw >= 30 && bw <= 300 && h >= 100 && h <= 250 ? bw / (h / 100) ** 2 : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !userId) return;
    const next: FieldErrors = {};
    if (!f.name.trim()) next.name = "Vul je naam in.";
    if (bw !== null && (Number.isNaN(bw) || bw < 30 || bw > 300)) next.bodyweight = "Tussen 30 en 300 kg.";
    if (h !== null && (Number.isNaN(h) || h < 100 || h > 250)) next.height = "Tussen 100 en 250 cm.";
    if (f.birthDate && (age === null || age < 10)) next.birthDate = "Controleer je geboortedatum.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: f.name.trim(),
          bodyweight_kg: bw,
          sex: f.sex || null,
          height_cm: h,
          birth_date: f.birthDate || null,
          weekly_goal: f.weeklyGoal,
        })
        .eq("id", userId);
      if (error) throw error;
      await refreshProfile();
      setDraft({});
      showSaved({ text: "Opgeslagen" });
    } catch (err) {
      setErrors({ form: `Opslaan lukte niet: ${errorMessage(err)}` });
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await removePushSubscription();
    // Werkt ook zonder verbinding (valt terug op uitloggen op dit apparaat) en wist de cache.
    await signOut();
    router.replace("/login");
  }

  async function exportData() {
    if (!userId || exporting) return;
    setExporting(true);
    try {
      await downloadMyData(userId, session?.user.email);
      toast.success("Je gegevens zijn gedownload");
    } catch (err) {
      toast.error(`Downloaden lukte niet. ${errorMessage(err)}`);
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    // Profielfoto eerst opruimen, nu het account (en de sessie) nog bestaat. Altijd, ook zonder
    // huidige foto: er kunnen bestanden over zijn van een eerder mislukte opruiming. Eerst de
    // kolom leeg, zodat een mislukte verwijdering initialen toont in plaats van een dode link.
    if (userId) {
      await removeAvatar(userId).catch(() => {});
      await deleteAvatarFiles(userId);
    }
    await deleteMyAccount();
    // Account is weg: meldingen op dit toestel uitzetten en lokaal uitloggen (wist ook de cache).
    await removePushSubscription();
    await signOut();
    router.replace("/login");
  }

  async function newFriendCode() {
    if (!userId) return;
    try {
      await regenerateFriendCode(userId);
    } catch (err) {
      throw new Error(friendErrorMessage(err));
    }
    // Oudere database bewaart de code nog in het profiel.
    await refreshProfile().catch(() => {});
    setCodeOpen(false);
    toast.success("Nieuwe code gemaakt. Je oude link en QR-code werken niet meer.");
  }

  const ranks = summary?.ranks;
  const incoming = friends?.incoming.length ?? 0;
  const displayName = profile?.display_name || "Jij";

  return (
    <AppShell title="Profiel" back>
      <div className="space-y-6">
        {/* Wie ben je */}
        <section className="card animate-scale-in relative space-y-4 overflow-hidden">
          {ranks?.overall && (
            <div
              className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full opacity-20 blur-3xl"
              style={{ background: ranks.overall.tier.from }}
            />
          )}
          <AvatarPicker
            userId={userId ?? ""}
            name={displayName}
            src={profile?.avatar_url}
            ring={ranks?.overall?.tier.from}
            onChanged={refreshProfile}
          >
            <h2 className="truncate text-xl font-extrabold">{displayName}</h2>
            <p className="truncate text-sm text-muted">{session?.user.email}</p>
          </AvatarPicker>
          <div className="relative">
            <FriendCode code={friendCode} onMessage={showFlashToast} />
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <p className="min-w-0 text-xs text-muted">Met je code of link word je direct vrienden.</p>
              <button
                type="button"
                className="-my-2 flex min-h-11 shrink-0 items-center gap-1 text-xs font-semibold text-muted transition hover:text-ink disabled:opacity-50"
                onClick={() => setCodeOpen(true)}
                disabled={!friendCode}
                aria-haspopup="dialog"
              >
                <RetryIcon size={12} /> Nieuwe code
              </button>
            </div>
          </div>
        </section>

        <Link href="/ranks" className="card flex items-center gap-4 hover:border-muted">
          {ranks?.overall ? (
            <RankBadge tierIndex={summary!.tierIndex!} size={56} glow />
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

        <div className="grid grid-cols-3 gap-2">
          <MiniStat value={summary?.sessions} label="trainingen" />
          <MiniStat value={summary?.sets} label="sets gelogd" />
          <MiniStat value={summary?.streak} label={summary?.streak === 1 ? "week reeks" : "weken reeks"} />
        </div>

        <div className="card divide-y divide-line p-0">
          <Link href="/friends" className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/40">
            <UsersIcon size={18} className="text-muted" />
            <span className="flex-1 font-semibold">Vrienden</span>
            {incoming > 0 ? (
              <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink">
                {incoming} {incoming === 1 ? "verzoek" : "verzoeken"}
              </span>
            ) : friends ? (
              <span className="text-sm tabular-nums text-muted">{friends.friends.length}</span>
            ) : null}
            <ChevronRightIcon size={16} className="text-muted" />
          </Link>
          <Link href="/progress" className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/40">
            <ProgressIcon size={18} className="text-muted" />
            <span className="flex-1 font-semibold">Progressie</span>
            <ChevronRightIcon size={16} className="text-muted" />
          </Link>
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Profiel</h2>
          <form onSubmit={save} className="card space-y-3" noValidate>
            <div>
              <label className="label" htmlFor="dn">
                Naam (zien je vrienden)
              </label>
              <input
                id="dn"
                className={`input ${errors.name ? "border-danger" : ""}`}
                value={f.name}
                maxLength={40}
                autoComplete="nickname"
                onChange={(e) => update("name", e.target.value)}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? "dn-err" : undefined}
              />
              <FieldError id="dn-err" text={errors.name} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="bw">
                  Gewicht (kg)
                </label>
                <input
                  id="bw"
                  className={`input ${errors.bodyweight ? "border-danger" : ""}`}
                  inputMode="decimal"
                  value={f.bodyweight}
                  onChange={(e) => update("bodyweight", e.target.value)}
                  placeholder="bijv. 78"
                  aria-invalid={!!errors.bodyweight}
                  aria-describedby={errors.bodyweight ? "bw-err" : undefined}
                />
                <FieldError id="bw-err" text={errors.bodyweight} />
              </div>
              <div>
                <span className="label" id="sex-label">
                  Geslacht
                </span>
                <Segmented
                  labelledBy="sex-label"
                  value={f.sex}
                  onChange={(v) => update("sex", v)}
                  options={[
                    { value: "male" as const, label: "Man" },
                    { value: "female" as const, label: "Vrouw" },
                  ]}
                  className="grid grid-cols-2 gap-1"
                  itemClassName="font-medium"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="height">
                  Lengte (cm)
                </label>
                <input
                  id="height"
                  className={`input ${errors.height ? "border-danger" : ""}`}
                  inputMode="decimal"
                  value={f.height}
                  onChange={(e) => update("height", e.target.value)}
                  placeholder="bijv. 182"
                  aria-invalid={!!errors.height}
                  aria-describedby={errors.height ? "height-err" : undefined}
                />
                <FieldError id="height-err" text={errors.height} />
              </div>
              <div>
                <label className="label" htmlFor="birth">
                  Geboren{age != null && age >= 10 && <span className="normal-case"> · {age} jaar</span>}
                </label>
                <input
                  id="birth"
                  type="date"
                  className={`input ${errors.birthDate ? "border-danger" : ""}`}
                  value={f.birthDate}
                  max={toISODate()}
                  onChange={(e) => update("birthDate", e.target.value)}
                  aria-invalid={!!errors.birthDate}
                  aria-describedby={errors.birthDate ? "birth-err" : undefined}
                />
                <FieldError id="birth-err" text={errors.birthDate} />
              </div>
            </div>
            {bmi != null && (
              <p className="text-xs text-muted">
                BMI: <span className="tabular-nums text-ink">{bmi.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}</span> (bij
                gespierde sporters zegt BMI weinig)
              </p>
            )}
            <div>
              <span className="label" id="goal-label">
                Weekdoel (trainingen per week)
              </span>
              <Segmented
                labelledBy="goal-label"
                value={f.weeklyGoal}
                onChange={(n) => update("weeklyGoal", n)}
                options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: n, ariaLabel: `${n} per week` }))}
                className="grid grid-cols-7 gap-1"
                itemClassName="font-semibold tabular-nums"
              />
            </div>
            <p className="text-xs text-muted">
              Gewicht, geslacht en leeftijd worden gebruikt voor je ranks: je kracht wordt vergeleken met mensen van hetzelfde
              geslacht, gewicht en dezelfde leeftijd. Groepsleden en vrienden zien je rang.
            </p>
            {errors.form && (
              <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {errors.form}
              </p>
            )}
            <button className="btn-primary w-full" disabled={saving || (!dirty && !saved)} aria-busy={saving}>
              {saving ? (
                "Opslaan…"
              ) : saved ? (
                <span className="animate-fade-in flex items-center gap-1.5">
                  <CheckIcon size={16} /> Opgeslagen
                </span>
              ) : dirty ? (
                "Wijzigingen opslaan"
              ) : (
                "Opslaan"
              )}
            </button>
          </form>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Voorkeuren</h2>
          <NutritionSettings />
          <PushToggle />
          <NotificationSettings />
          <StorageSettings />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">App</h2>
          <div className="card divide-y divide-line p-0">
            <div className="flex gap-3 px-4 py-3 text-sm text-muted">
              <PhoneIcon size={18} className="mt-0.5 shrink-0" />
              <div className="space-y-1.5">
                <p className="font-semibold text-ink">Als app op je telefoon</p>
                <p>iPhone en iPad: open de app in Safari, tik op de deelknop en kies “Zet op beginscherm”.</p>
                <p>Android: open het menu in Chrome en kies “App installeren” of “Toevoegen aan startscherm”.</p>
              </div>
            </div>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold transition hover:bg-surface-2/40"
              onClick={() => setPwOpen(true)}
              aria-haspopup="dialog"
            >
              <KeyIcon size={18} className="text-muted" />
              <span className="flex-1">Wachtwoord wijzigen</span>
              <ChevronRightIcon size={16} className="text-muted" />
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold transition hover:bg-surface-2/40 disabled:opacity-60"
              onClick={exportData}
              disabled={exporting || !userId}
              aria-busy={exporting}
            >
              <DownloadIcon size={18} className={`text-muted ${exporting ? "animate-pulse" : ""}`} />
              <span className="flex-1">{exporting ? "Gegevens verzamelen…" : "Mijn gegevens downloaden"}</span>
              <span className="text-xs font-normal text-muted">JSON</span>
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-danger transition hover:bg-danger/5"
              onClick={() => setLogoutOpen(true)}
              aria-haspopup="dialog"
            >
              <LogoutIcon size={18} />
              Uitloggen
            </button>
          </div>
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-center text-xs font-semibold text-muted transition hover:text-danger"
            onClick={() => setDeleteOpen(true)}
            aria-haspopup="dialog"
          >
            Account verwijderen
          </button>
        </section>
      </div>

      <ConfirmSheet
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        title="Uitloggen"
        body="Je logt uit op dit apparaat. Meldingen op dit apparaat gaan ook uit; je gegevens blijven bewaard."
        confirmLabel="Uitloggen"
        busyLabel="Uitloggen…"
        danger
        onConfirm={logout}
      />

      <ConfirmSheet
        open={codeOpen}
        onClose={() => setCodeOpen(false)}
        title="Nieuwe vriendcode"
        body={
          <>
            Je krijgt een nieuwe code, link en QR-code. De oude werken daarna niet meer, handig als je link bij de verkeerde
            persoon terecht is gekomen. <span className="font-semibold text-ink">Je bestaande vrienden blijven vrienden.</span>
          </>
        }
        confirmLabel="Nieuwe code maken"
        busyLabel="Bezig…"
        onConfirm={newFriendCode}
      />

      <DeleteAccountSheet open={deleteOpen} onClose={() => setDeleteOpen(false)} name={displayName} onConfirm={deleteAccount} />

      <Sheet open={pwOpen} onClose={() => setPwOpen(false)} title="Wachtwoord wijzigen">
        <NewPasswordForm
          onDone={() => {
            setPwOpen(false);
            toast.success("Wachtwoord gewijzigd");
          }}
        />
      </Sheet>
    </AppShell>
  );
}

function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return (
    <p id={id} className="animate-fade-in mt-1 text-xs text-danger">
      {text}
    </p>
  );
}

function MiniStat({ value, label }: { value: number | undefined; label: string }) {
  return (
    <div className="card px-3 py-3">
      {value === undefined ? (
        <span className="skeleton block h-8 w-12" />
      ) : (
        <p className="text-2xl font-extrabold tabular-nums text-accent">{value}</p>
      )}
      <p className="truncate text-xs text-muted">{label}</p>
    </div>
  );
}
